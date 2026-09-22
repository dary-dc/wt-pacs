/**
 * What one decoder worker costs, resident. D workers of one arm decode the series — driven
 * straight, under the product's dispatch rule, or through the downloader and a session — and
 * every frame is checked against the fixture's digest. `run.mjs` reads the renderer's RSS beside
 * this and takes the slope in D. docs/decode/README.md §What a decoder worker costs, resident
 */
const q = new URLSearchParams(location.search);
const SERIES = q.get("series") || "decode_g512";
const MUTATE = q.get("mutate") || "";
const BALLAST_MB = Number(q.get("ballast") || 0);
const PATH = q.get("path") === "downloader" ? "downloader" : "direct";
const HOLD = q.get("hold") === "1";

/** The wrapper as delivered — docs/decode/README.md §The build, as delivered. */
const BUILD = {
  glue: "/lab/.openjph-build/deliver/openjphjs.js",
  wasm: "/lab/.openjph-build/deliver/openjphjs.wasm",
  dir: "/lab/.openjph-build/deliver",
};
const PRODUCT = "/client/downloader/decoder.js";
const TWIN = "/lab/decoder-memory/twin.js";
const ARMS = {
  prod: { worker: PRODUCT, per: 2 },
  perdec1: { worker: PRODUCT, per: 1 },
  twin: { worker: TWIN, per: 2, reuse: true, share: false },
  fresh: { worker: TWIN, per: 2, reuse: false, share: false },
  share: { worker: TWIN, per: 2, reuse: true, share: true },
};
const ARM = ARMS[q.get("arm")] ? q.get("arm") : "prod";
const D = Number(q.get("decoders") || 3);
const PER = Number(q.get("perDecoder") || ARMS[ARM].per);

const logEl = document.getElementById("log");
const log = (s) => { logEl.textContent += s + "\n"; };
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function series(withBytes) {
  const meta = await (await fetch(`/lab/fixtures/${SERIES}/metadata.json`)).json();
  const declared = Number(q.get("frames") || meta.frameCount);
  const codestreams = [];
  const digests = [];
  for (let i = 0; i < declared; i++) {
    const name = String(i).padStart(3, "0");
    const frame = await fetch(`/lab/fixtures/${SERIES}/${name}.${withBytes ? "j2c" : "sha256"}`);
    // A generated set on disk can be shorter than the metadata the generator wrote.
    if (!frame.ok) break;
    if (withBytes) codestreams.push(new Uint8Array(await frame.arrayBuffer()));
    digests.push((await (await fetch(`/lab/fixtures/${SERIES}/${name}.sha256`)).text()).trim());
  }
  return { meta, n: digests.length, codestreams, digests };
}

async function main() {
  const result = { arm: ARM, decoders: D, perDecoder: PER, path: PATH, series: SERIES,
    mutate: MUTATE, ballast_mb: BALLAST_MB, hold: HOLD };
  const { meta, n, codestreams, digests } = await series(PATH === "direct");
  result.frames = n;
  const spec = ARMS[ARM];

  const wanted = MUTATE === "skip" ? n - Math.floor(n / 5) : n;
  const scratch = new Uint8Array(meta.width * meta.height * (meta.channels || 1) * 2);
  const held = [];
  let checked = 0;
  let mismatches = 0;
  let failures = 0;
  let chain = Promise.resolve();
  let settle = () => {};
  const decoded = new Promise((r) => { settle = r; });
  // The pixels and the worker's `done` travel on different ports and are not ordered against
  // each other, so the run ends on the last frame checked rather than on the last `done`.
  function check(index, bytes) {
    scratch.set(bytes);
    const view = scratch.subarray(0, bytes.length);
    if (MUTATE === "pixel" && checked === 0) view[0] ^= 1;
    return crypto.subtle.digest("SHA-256", view).then((d) => {
      if (hex(d) !== digests[index]) mismatches += 1;
      if (HOLD) held.push(bytes);
      checked += 1;
      if (checked + failures >= wanted) settle();
    });
  }
  const take = (index, bytes) => { chain = chain.then(() => check(index, bytes)); };
  const done = () => Promise.race([decoded, new Promise((r) => setTimeout(r, 180000))]);

  const t0 = performance.now();
  let heap = null;
  if (PATH === "downloader") {
    const cfg = await (await fetch("/wt/dev-transport.json")).json();
    const { DownloaderClient } = await import("/client/downloader/consumer.js");
    const client = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
      decoders: D,
      perDecoder: PER,
      decoder: BUILD,
      onFrame: (f) => take(f.frameIndex, f.bytes),
      onError: () => { failures += 1; if (checked + failures >= wanted) settle(); },
    });
    globalThis.__wtpacsReady = true;
    client.fill([...Array(n).keys()]);
    await done();
  } else {
    const module = spec.share ? await WebAssembly.compileStreaming(fetch(BUILD.wasm)) : null;
    const workers = [];
    const ready = [];
    for (let i = 0; i < D; i++) {
      const w = new Worker(spec.worker, { type: "module" });
      const d = { worker: w, outstanding: 0 };
      ready.push(new Promise((r) => { d.ready = r; }));
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => take(e.data.index, new Uint8Array(e.data.pixels));
      w.postMessage(
        { kind: "init", toConsumer: ch.port2, decoder: BUILD, reuse: spec.reuse, module, ballastMb: BALLAST_MB },
        [ch.port2],
      );
      w.onmessage = (e) => {
        if (e.data.kind === "ready") d.ready(true);
        else if (e.data.kind === "init-failed") d.ready(false);
        else if (e.data.kind === "heap") d.heap(e.data.bytes);
        else if (e.data.kind === "done") { d.outstanding -= 1; pump(); }
        else if (e.data.kind === "failed") {
          d.outstanding -= 1;
          failures += 1;
          result.decode_error ??= e.data.reason;
          pump();
        }
      };
      workers.push(d);
    }
    result.ready = (await Promise.all(ready)).every(Boolean);
    if (!result.ready) throw new Error(`a decoder failed to init: ${ARM}`);
    // run.mjs reads the renderer's RSS here: what the workers cost before a frame is decoded.
    globalThis.__wtpacsReady = true;

    let next = 0;
    function pump() {
      while (next < n) {
        let best = null;
        for (const d of workers) {
          if (d.outstanding >= PER) continue;
          if (!best || d.outstanding < best.outstanding) best = d;
        }
        if (!best) return;
        const index = next++;
        if (MUTATE === "skip" && index % 5 === 4) continue;
        const bytes = new Uint8Array(codestreams[index]);
        best.outstanding += 1;
        best.worker.postMessage(
          { kind: "decode", index, gen: 0, bytes, stamps: { ask: performance.now() } },
          [bytes.buffer],
        );
      }
      if (next >= n && workers.every((d) => d.outstanding === 0) && checked + failures >= wanted) settle();
    }
    pump();
    await done();
    if (spec.worker === TWIN) {
      heap = await Promise.all(workers.map((d) => new Promise((r) => {
        d.heap = r;
        d.worker.postMessage({ kind: "heap" });
      })));
    }
  }

  await chain;
  result.decode_wall_ms = performance.now() - t0;
  result.checked = checked;
  result.mismatches = mismatches;
  result.failures = failures;
  result.held = held.length;
  result.heap_bytes = heap;
  result.complete = checked === wanted && mismatches === 0;

  globalThis.__wtpacsDecoded = true;
  try {
    // It collects across the agent cluster before it counts, so the settled RSS run.mjs reads
    // after this call is post-GC for the workers too. docs/decode/README.md §Retention, measured
    const mem = await performance.measureUserAgentSpecificMemory();
    result.memory_bytes = mem.bytes;
    const workerEntries = mem.breakdown.filter((b) =>
      b.attribution.some((a) => a.scope === "DedicatedWorkerGlobalScope"));
    result.memory_workers_bytes = workerEntries.reduce((s, b) => s + b.bytes, 0);
    result.memory_worker_entries = workerEntries.length;
  } catch (e) {
    result.memory_error = String(e?.message ?? e);
  }
  log(JSON.stringify(result));
  globalThis.__wtpacsResult = result;
  globalThis.__wtpacsDone = true;
}

main().catch((e) => {
  log("FAILED: " + (e?.stack || e?.message || e));
  globalThis.__wtpacsResult = { arm: ARM, decoders: D, error: String(e?.message ?? e) };
  globalThis.__wtpacsDone = true;
});
