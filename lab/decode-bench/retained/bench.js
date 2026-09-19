// What a viewer that keeps every frame it decoded costs in memory. docs/decode/README.md
const SERIES = ["decode_c512", "decode_g512", "decode_g2048"];
const BUILDS = {
  package: {
    glue: "/lab/decode-bench/vendor/openjph/openjphjs.js",
    wasm: "/lab/decode-bench/vendor/openjph/openjphjs.wasm",
    dir: "/lab/decode-bench/vendor/openjph",
  },
  source4: {
    glue: "/lab/.openjph-build/wasm/plain.js",
    wasm: "/lab/.openjph-build/wasm/plain.wasm",
    dir: "/lab/.openjph-build/wasm",
  },
};
const CELLS = [
  { arrangement: "plain", lifetime: "perframe" },
  { arrangement: "plain", lifetime: "reused" },
  { arrangement: "shared", lifetime: "perframe" },
  { arrangement: "shared", lifetime: "reused" },
  { arrangement: "heap", lifetime: "perframe" },
];

const log = (s) => { document.getElementById("log").textContent += s + "\n"; };
const MB = (b) => (b / 1048576).toFixed(1);
const ua = async () => (await performance.measureUserAgentSpecificMemory()).bytes;

async function loadSeries(name) {
  const meta = await (await fetch(`/lab/fixtures/${name}/metadata.json`)).json();
  const frames = [];
  const truth = [];
  for (let i = 0; i < meta.frameCount; i++) {
    const n = String(i).padStart(3, "0");
    frames.push(new Uint8Array(await (await fetch(`/lab/fixtures/${name}/${n}.j2c`)).arrayBuffer()));
    truth.push((await (await fetch(`/lab/fixtures/${name}/${n}.sha256`)).text()).trim());
  }
  return { name, meta, frames, truth };
}

function spawn(build) {
  return new Promise((resolve) => {
    const w = new Worker("./worker.js");
    w.onmessage = (e) => { if (e.data.kind === "ready") resolve(w); };
    w.postMessage({ kind: "init", ...BUILDS[build] });
  });
}

const ask = (w, msg) => new Promise((r) => { w.onmessage = (e) => r(e.data); w.postMessage(msg); });

async function cell(series, build, arrangement, lifetime, pool, mutate) {
  const workers = [];
  for (let i = 0; i < pool; i++) workers.push(await spawn(build));
  const seqs = workers.map(() => []);
  const t0 = performance.now();
  const base = await ua();
  let wasmPeak = 0;
  let uaPeak = base;
  const heaps = new Array(pool).fill(0);
  let decodeMs = 0;
  let uaMs = 0;
  const n = series.frames.length;
  const marks = new Set([Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4)]);

  for (let i = 0; i < n; i++) {
    const k = i % pool;
    seqs[k].push(i);
    // The mutant makes the retained arrangement reuse one decoder, so every frame aliases the last.
    const lt = mutate === "heap-reused" && arrangement === "heap" ? "reused" : lifetime;
    const r = await ask(workers[k], { kind: "decode", seq: i, bytes: series.frames[i], arrangement, lifetime: lt });
    heaps[k] = r.heap;
    decodeMs += r.ms;
    wasmPeak = Math.max(wasmPeak, heaps.reduce((a, b) => a + b, 0));
    if (marks.has(i)) { const t = performance.now(); uaPeak = Math.max(uaPeak, await ua()); uaMs += performance.now() - t; }
  }

  const uaEnd = await ua();
  uaPeak = Math.max(uaPeak, uaEnd);
  const wasmEnd = heaps.reduce((a, b) => a + b, 0);
  const ms = performance.now() - t0;

  let bad = 0;
  for (const [k, w] of workers.entries()) {
    const v = await ask(w, { kind: "verify", seqs: seqs[k] });
    for (const [seq, hash] of v.hashes) if (hash !== series.truth[seq]) bad++;
  }
  for (const w of workers) w.terminate();

  return {
    series: series.name, build, arrangement, lifetime, pool, n,
    uaBase: base, uaEnd, uaPeak, retained: uaEnd - base,
    wasmEnd, wasmPeak, ms, decodeMs, uaMs, bad,
  };
}

async function main() {
  const q = new URLSearchParams(location.search);
  const pools = (q.get("pools") || "1,2,3,4").split(",").map(Number);
  const only = q.get("series");
  const onlyBuild = q.get("build");
  const mutate = q.get("mutate") || "";

  log(`COI=${globalThis.crossOriginIsolated} cores=${navigator.hardwareConcurrency} measureUserAgentSpecificMemory=${typeof performance.measureUserAgentSpecificMemory}`);
  if (!globalThis.crossOriginIsolated) { log("FATAL: not cross-origin isolated"); globalThis.__wtpacsDone = true; return; }
  if (mutate) log(`MUTANT: ${mutate}`);

  const out = [];
  for (const name of only ? [only] : SERIES) {
    const series = await loadSeries(name);
    log(`\n=== ${name}: ${series.meta.frameCount} x ${series.meta.width}x${series.meta.height}x${series.meta.channels}, max ${series.meta.maxValue} ===`);
    for (const build of onlyBuild ? [onlyBuild] : Object.keys(BUILDS)) {
      for (const c of CELLS) {
        for (const pool of pools) {
          const r = await cell(series, build, c.arrangement, c.lifetime, pool, mutate);
          out.push(r);
          log(`${build.padEnd(8)} ${c.arrangement.padEnd(6)} ${c.lifetime.padEnd(8)} pool=${pool}  retained=${MB(r.retained).padStart(7)} MB  wasm=${MB(r.wasmEnd).padStart(7)} MB  peak=${MB(r.uaPeak).padStart(7)} MB  ${r.ms.toFixed(0).padStart(6)} ms  ${r.bad ? "MISMATCH x" + r.bad : "ok"}`);
        }
      }
    }
    series.frames.length = 0;
  }
  globalThis.__wtpacsResult = out;
  log("\n--JSON--\n" + JSON.stringify(out));
  globalThis.__wtpacsDone = true;
}

main().catch((e) => { log("FAILED: " + e.message); globalThis.__wtpacsDone = true; });
