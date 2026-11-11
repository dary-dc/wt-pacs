// One browser's share of a breakdown round: every arm over every set, one frame at a time through the decoder
// worker, each frame's stage stamps kept and the frame checked twice. lab/av1/decode/breakdown/README.md
import { order } from "../../../order.mjs";

const PRODUCT = "/client/decode";
const AV1 = (build) => ({ codec: "av1", glue: `/lab/.av1-build/out/${build}.js`, wasm: `/lab/.av1-build/out/${build}.wasm`, dir: "/lab/.av1-build/out" });
const HTJ2K = { glue: "/client/decode/wasm/vendor/openjph/openjphjs.js", wasm: "/client/decode/wasm/vendor/openjph/openjphjs.wasm", dir: "/client/decode/wasm/vendor/openjph" };

/** name → the worker, its decoder config and the payload's extension; `0` arms are the product unstamped. */
export function arms(stamped) {
  const wc = `${stamped}/decoder.js`;
  const d = `${stamped}/dav1d-worker.js`;
  const out = {
    H: { worker: wc, decoder: HTJ2K, ext: "htj2k" },
    H0: { worker: `${PRODUCT}/decoder.js`, decoder: HTJ2K, ext: "htj2k" },
    D: { worker: d, decoder: AV1("simd"), ext: "av1" },
    D0: { worker: "/lab/av1/bytes/frame-groups/dav1d-worker.js", decoder: AV1("simd"), ext: "av1" },
    W: { worker: wc, decoder: AV1("simd"), ext: "av1" },
    W0: { worker: `${PRODUCT}/decoder.js`, decoder: AV1("simd"), ext: "av1" },
    W1: { worker: wc, decoder: { ...AV1("simd"), lab: { noFlush: true } }, ext: "av1" },
    W2: { worker: wc, decoder: { ...AV1("simd"), lab: { passes: true } }, ext: "av1" },
    W12: { worker: wc, decoder: { ...AV1("simd"), lab: { noFlush: true, passes: true } }, ext: "av1" },
    Z_D: { worker: d, decoder: { ...AV1("simd"), lab: { z: true } }, ext: "z" },
    Z_W: { worker: wc, decoder: { ...AV1("simd"), lab: { z: true } }, ext: "z" },
    T_D: { worker: d, decoder: { ...AV1("simd-mt"), threads: 3 }, ext: "t4" },
    T_W: { worker: wc, decoder: AV1("simd"), ext: "t4" },
  };
  for (const [name, a] of Object.entries(out)) a.path = name.startsWith("H") ? "htj2k" : a.worker.endsWith("dav1d-worker.js") ? "av1-dav1d" : "av1-webcodecs";
  return out;
}

async function sha256(sab, mutate) {
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  if (mutate) copy[copy.length >> 1] ^= 1;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

const now = () => performance.timeOrigin + performance.now();

/** A decoder worker as the downloader drives one: init with the series' digests, then one frame in flight at a time. */
async function start(arm, digests, spin) {
  const worker = new Worker(arm.worker, { type: "module" });
  const { port1, port2 } = new MessageChannel();
  let waiting = null;
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.kind === "ready") waiting.resolve();
    if (m.kind === "init-failed" || m.kind === "failed") waiting.reject(new Error(m.reason));
  };
  port2.onmessage = (e) => e.data.kind === "frame" && !e.data.preview && waiting.resolve({ ...e.data, receipt: now() });
  const next = () => new Promise((resolve, reject) => (waiting = { resolve, reject }));
  const ready = next();
  const decoder = spin ? { ...arm.decoder, lab: { ...arm.decoder.lab, spin } } : arm.decoder;
  worker.postMessage({ kind: "init", toConsumer: port1, decoder, groupLength: 1, digests }, [port1]);
  await ready;
  return {
    async decode(bytes, index, gen) {
      const done = next();
      const copy = bytes.slice();
      worker.postMessage({ kind: "decode", index, gen, key: true, bytes: copy, stamps: {} }, [copy.buffer]);
      return done;
    },
    close: () => { worker.terminate(); port2.close(); },
  };
}

/** Stamps as ms from decodeStart: [[name, t], …]. */
const relative = (f) => (f.stamps.lab ?? []).map(([k, t]) => [k, +(t - f.stamps.decodeStart).toFixed(4)]);

/**
 * rows: { set, arm, frames: [{ ms, stamps, port, exact, path }], exact, n, error? }. `spin` lengthens stages,
 * `count` cuts each run's frames, `sets` and `only` choose.
 */
export async function run({ frames: dir, stamped, round: r, mutate = false, only, sets, spin, count }) {
  const manifest = (await (await fetch(`/${dir}/manifest.json`)).json()).filter((s) => !sets || sets.includes(s.name));
  const all = arms(stamped);
  const rows = [];
  for (const set of order(manifest, r)) {
    const digests = set.frames.map((f) => (mutate ? f.xxh3_flipped : f.xxh3));
    const n = Math.min(count ?? set.frames.length, set.frames.length);
    for (const name of order(Object.keys(all).filter((a) => !only || only.includes(a)), r)) {
      const arm = all[name];
      const bytes = await Promise.all(Array.from({ length: n }, (_, i) =>
        fetch(`/${dir}/${set.name}/${String(i).padStart(3, "0")}.${arm.ext}`).then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b))));
      const row = { set: set.name, arm: name, frames: [], exact: 0, n };
      try {
        const dec = await start(arm, digests, spin);
        await dec.decode(bytes[0], 0, -1);  // the warm-up frame the product decodes at init
        for (let i = 0; i < n; i++) {
          const f = await dec.decode(bytes[i], i, 0);
          // Exact first time on the arm's own path: a frame the product's fallback rescued does not count.
          const exact = f.exact === true && !f.mismatchOn && f.path === arm.path && (await sha256(f.pixels, mutate)) === set.frames[i].truth;
          row.frames.push({ ms: f.stamps.decodeEnd - f.stamps.decodeStart, stamps: relative(f), port: f.receipt - f.stamps.decodeEnd, exact, path: f.path, mismatchOn: f.mismatchOn });
          if (exact) row.exact++;
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
