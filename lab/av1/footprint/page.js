/**
 * FOOTPRINT: what one arm of one set costs the product's decoder workers. `mode=mem` decodes the series on D
 * workers twice over and stops at four checkpoints for run.mjs to read the renderer's RSS beside the page's
 * own measure; `mode=first` times a fresh worker's init and its first frames. Every frame is hashed against
 * the checksum written when the series was fetched. lab/av1/footprint/README.md
 */
const q = new URLSearchParams(location.search);
const DIR = q.get("frames");
const SET = q.get("set");
const ARM = q.get("arm");
const MODE = q.get("mode") === "first" ? "first" : "mem";
const D = Number(q.get("decoders") || 1);
const PER = 2;
const MUTATE = q.get("mutate") || "";
/** htj2k: the package every AV1 row measured against; htj2k4: the adopted wrapper, 4 MB initial heap (docs/decode/README.md §The build, as delivered). */
const OPENJPH = { htj2k: ["/lab/decode-bench/vendor/openjph", "openjphjs"], htj2k4: ["/lab/.openjph-build/wasm", "deliver"] };
const DAV1D = "/lab/.av1-build/out";

const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** The decoder config `connect` would hand the workers for this arm. */
function arm(entry) {
  if (OPENJPH[ARM]) {
    const [dir, name] = OPENJPH[ARM];
    return { ext: "htj2k", decoder: { glue: `${dir}/${name}.js`, wasm: `${dir}/${name}.wasm`, dir } };
  }
  const { ext, group, truth, ...connect } = entry.arms[ARM];
  if (MUTATE === "split" && connect.split) connect.split--;
  return { ext: ext ?? ARM, groupLength: group, decoder: { codec: "av1", glue: `${DAV1D}/simd.js`, wasm: `${DAV1D}/simd.wasm`, dir: DAV1D, ...connect } };
}

/** A frame's pixels, not the worker's `done` on its other port, free its slot: the two are not ordered. */
let wake = null;

/** run.mjs reads the renderer at each checkpoint and resumes the page. */
let resume = null;
globalThis.__resume = () => resume?.();
const checkpoints = {};
const ask = (d, kind) => new Promise((r) => { d.answer = r; d.w.postMessage({ kind }); });
async function checkpoint(name, ds) {
  const heap = await Promise.all(ds.map((d) => ask(d, "heap").then((m) => m.bytes)));
  const mem = await performance.measureUserAgentSpecificMemory();
  const workers = mem.breakdown.filter((b) => b.attribution.some((a) => a.scope === "DedicatedWorkerGlobalScope")).map((b) => b.bytes);
  checkpoints[name] = { heap, bytes: mem.bytes, workers };
  const go = new Promise((r) => (resume = r));
  globalThis.__stage = name;
  await go;
}

function spawn(cfg, onFrame) {
  const w = new Worker("/lab/av1/footprint/worker.js", { type: "module" });
  const { port1, port2 } = new MessageChannel();
  const d = { w, outstanding: 0, waits: [] };
  port2.onmessage = (e) => e.data.kind === "frame" && onFrame(d, e.data);
  const ready = new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "ready") resolve();
      else if (m.kind === "init-failed") reject(new Error(m.reason));
      else if (m.kind === "failed") { d.outstanding--; d.failed = m.reason; d.waits.shift()?.reject(new Error(m.reason)); wake?.(); }
      else if (m.kind === "resources" || m.kind === "heap") d.answer?.(m);
    };
  });
  w.postMessage({ kind: "init", toConsumer: port1, decoder: cfg.decoder, groupLength: cfg.groupLength }, [port1]);
  return { d, ready };
}

async function main() {
  const entry = await (await fetch(`/${DIR}/${SET}/arms.json`)).json();
  const cfg = arm(entry);
  const truth = entry.truth.map((t) => (MUTATE === "truth" ? (t[0] === "0" ? "1" : "0") + t.slice(1) : t));
  const frames = await Promise.all(truth.map((_, i) =>
    fetch(`/${DIR}/${SET}/${String(i).padStart(3, "0")}.${cfg.ext}`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b))));
  const result = { set: SET, arm: ARM, mode: MODE, decoders: D, frames: frames.length, exact: 0, checked: 0 };

  let chain = Promise.resolve();
  const check = (index, pixels) => (chain = chain.then(async () => {
    const copy = new Uint8Array(pixels.byteLength);
    copy.set(new Uint8Array(pixels));
    if (MUTATE === "sample") copy[copy.length >> 1] ^= 1;
    if (hex(await crypto.subtle.digest("SHA-256", copy)) === truth[index]) result.exact++;
    result.checked++;
  }));
  const send = (d, index) => {
    const bytes = frames[index].slice();
    d.outstanding++;
    d.w.postMessage({ kind: "decode", index, gen: 0, key: true, bytes, stamps: { ask: performance.now() } }, [bytes.buffer]);
    return new Promise((resolve, reject) => d.waits.push({ resolve, reject }));
  };
  const onFrame = (d, f) => {
    check(f.index, f.pixels);
    d.outstanding--;
    wake?.();
    d.waits.shift()?.resolve({ at: performance.now(), ms: f.stamps.decodeEnd - f.stamps.decodeStart });
  };

  if (MODE === "first") {
    const t0 = performance.now();
    const { d, ready } = spawn(cfg, onFrame);
    await ready;
    result.init_ms = performance.now() - t0;
    result.decode = [];
    for (let i = 0; i < Math.min(3, frames.length); i++) {
      const t = performance.now();
      const f = await send(d, i);
      result.decode.push({ page_ms: f.at - t, worker_ms: f.ms });
    }
    result.heap = (await ask(d, "heap")).bytes;
    result.resources = (await ask(d, "resources")).entries;
    d.w.terminate();
  } else {
    const workers = Array.from({ length: D }, () => spawn(cfg, onFrame));
    await Promise.all(workers.map((x) => x.ready));
    const ds = workers.map((x) => x.d);
    await checkpoint("ready", ds);
    await Promise.all(ds.map((d, i) => send(d, i % frames.length)));
    await chain;
    await checkpoint("first", ds);
    // The product's rule: the least-loaded worker under its cap takes the next frame.
    const pass = async () => {
      const all = [];
      for (let next = 0; next < frames.length; ) {
        const d = ds.filter((x) => x.outstanding < PER).sort((a, b) => a.outstanding - b.outstanding)[0];
        if (!d) { await new Promise((r) => (wake = r)); continue; }
        all.push(send(d, next++));
      }
      await Promise.all(all);
      await chain;
    };
    await pass();
    await checkpoint("series", ds);
    await pass();
    await checkpoint("again", ds);
    result.failed = ds.map((d) => d.failed).filter(Boolean);
  }
  await chain;
  result.checkpoints = checkpoints;
  globalThis.__result = result;
}

main().catch((e) => { globalThis.__result = { set: SET, arm: ARM, mode: MODE, decoders: D, error: String(e?.message ?? e) }; });
