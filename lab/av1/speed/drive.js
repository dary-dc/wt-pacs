// One process's share of a SPEED round, the same in Node and in a page: every arm over every set,
// frames asked one at a time, each timed by its decoder's own stamps and checked against the truth.
import { order } from "../../order.mjs";

const MUTATE = { sample: false, truth: false };

// A browser MessagePort delivers nothing to addEventListener until start(); onmessage starts it.
const on = (target, fn) => (target.on ? target.on("message", fn) : (target.onmessage = (e) => fn(e.data)));

async function sha256(sab) {
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  if (MUTATE.sample) copy[copy.length >> 1] ^= 1;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A decoder worker as the downloader drives one: init, then one frame in flight at a time. */
async function start(env, kind, decoder) {
  const worker = env.worker(kind);
  const { port1, port2 } = env.channel();
  let waiting = null;
  on(worker, (m) => {
    if (m.kind === "ready") waiting.resolve();
    if (m.kind === "init-failed" || m.kind === "failed") waiting.reject(new Error(m.reason));
  });
  on(port2, (m) => m.kind === "frame" && waiting.resolve(m));
  const next = () => new Promise((resolve, reject) => (waiting = { resolve, reject }));
  const ready = next();
  worker.postMessage({ kind: "init", toConsumer: port1, decoder }, [port1]);
  await ready;
  return {
    async decode(bytes, index) {
      const done = next();
      const copy = bytes.slice();
      worker.postMessage({ kind: "decode", index, gen: 0, bytes: copy, stamps: {} }, [copy.buffer]);
      const f = await done;
      return { ms: f.stamps.decodeEnd - f.stamps.decodeStart, pixels: f.pixels };
    },
    close: () => { worker.terminate(); port2.close(); },
  };
}

export const ARMS = {
  htj2k: (base) => ({ kind: "product", ext: "htj2k", decoder: {
    glue: `${base}/lab/decode-bench/vendor/openjph/openjphjs.js`,
    wasm: `${base}/lab/decode-bench/vendor/openjph/openjphjs.wasm`,
    dir: `${base}/lab/decode-bench/vendor/openjph` } }),
  av1: (base) => ({ kind: "product", ext: "av1", decoder: {
    codec: "av1", glue: `${base}/lab/.av1-build/out/simd.js`,
    wasm: `${base}/lab/.av1-build/out/simd.wasm`, dir: `${base}/lab/.av1-build/out` } }),
  webcodecs: (base, set) => set.webcodecs && ({ kind: "webcodecs", ext: "av1", decoder: { codec: set.webcodecs } }),
};

/** rows: { set, arm, ms[], exact, frames }. A frame that fails to decode is a row with an error. */
export async function round(env, { base, frames: dir, arms, round: r, mutate = [] }, kinds = ARMS) {
  for (const k of mutate) MUTATE[k] = true;
  const manifest = await (await fetch(`${base}/${dir}/manifest.json`)).json();
  const rows = [];
  for (const set of order(manifest, r)) {
    const truth = set.frames.map((f) => (MUTATE.truth ? f.truth.replace(/^./, (c) => (c === "0" ? "1" : "0")) : f.truth));
    for (const name of order(arms, r)) {
      const arm = kinds[name](base, set);
      if (!arm) continue;
      const bytes = await Promise.all(set.frames.map((_, i) =>
        fetch(`${base}/${dir}/${set.name}/${String(i).padStart(3, "0")}.${arm.ext}`)
          .then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b))));
      const row = { set: set.name, arm: name, ms: [], exact: 0, frames: bytes.length };
      try {
        const dec = await start(env, arm.kind, arm.decoder);
        await dec.decode(bytes[0], -1);  // the warm-up frame the product decodes at init
        for (let i = 0; i < bytes.length; i++) {
          const { ms, pixels } = await dec.decode(bytes[i], i);
          row.ms.push(ms);
          if ((await sha256(pixels)) === truth[i]) row.exact++;
        }
        dec.close();
      } catch (e) {
        row.error = String(e?.message ?? e);
      }
      rows.push(row);
    }
  }
  return rows;
}
