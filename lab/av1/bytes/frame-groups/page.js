// One browser's share of a GOPMEASURE round: every arm over every set, each run's frames asked in order through the
// product's decoder worker, timed by its own stamps and checked against the truth. lab/av1/bytes/frame-groups/README.md
import { order } from "../../../order.mjs";

const AV1 = (dir) => ({ codec: "av1", glue: `${dir}/simd.js`, wasm: `${dir}/simd.wasm`, dir });
const HTJ2K = (dir) => ({ glue: `${dir}/openjphjs.js`, wasm: `${dir}/openjphjs.wasm`, dir });

/** name → the worker, the decoder config, the file extension and the group length. */
function arms(base, groups) {
  const out = { htj2k: { worker: "/client/decode/decoder.js", decoder: HTJ2K(`${base}/client/decode/wasm/vendor/openjph`), ext: "htj2k", g: 1 } };
  for (const g of groups) {
    out[`webcodecs-g${g}`] = { worker: "/client/decode/decoder.js", decoder: AV1(`${base}/lab/.av1-build/out`), ext: `g${g}`, g };
    out[`dav1d-g${g}`] = { worker: "/lab/av1/bytes/frame-groups/dav1d-worker.js", decoder: AV1(`${base}/lab/.av1-build/out`), ext: `g${g}`, g };
  }
  return out;
}

async function sha256(sab, mutate) {
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  if (mutate) copy[copy.length >> 1] ^= 1;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A decoder worker as the downloader drives one: init with the group length, then one frame in flight at a time. */
async function start(arm) {
  const worker = new Worker(arm.worker, { type: "module" });
  const { port1, port2 } = new MessageChannel();
  let waiting = null;
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.kind === "ready") waiting.resolve();
    if (m.kind === "init-failed" || m.kind === "failed") waiting.reject(new Error(m.reason));
  };
  port2.onmessage = (e) => e.data.kind === "frame" && !e.data.preview && waiting.resolve(e.data);
  const next = () => new Promise((resolve, reject) => (waiting = { resolve, reject }));
  const ready = next();
  worker.postMessage({ kind: "init", toConsumer: port1, decoder: arm.decoder, groupLength: arm.g }, [port1]);
  await ready;
  return {
    async decode(bytes, index, gen) {
      const done = next();
      const copy = bytes.slice();
      worker.postMessage({ kind: "decode", index, gen, key: index % arm.g === 0, bytes: copy, stamps: {} }, [copy.buffer]);
      const f = await done;
      return { ms: f.stamps.decodeEnd - f.stamps.decodeStart, pixels: f.pixels };
    },
    close: () => { worker.terminate(); port2.close(); },
  };
}

/** rows: { set, arm, g, ms[] per frame in order, exact, frames, error? } */
export async function run({ frames: dir, round: r, mutate = false, only }) {
  const base = location.origin;
  const manifest = await (await fetch(`${base}/${dir}/manifest.json`)).json();
  const rows = [];
  for (const set of order(manifest, r)) {
    const all = arms(base, set.groups);
    for (const name of order(Object.keys(all).filter((n) => !only || only.includes(n)), r)) {
      const arm = all[name];
      const bytes = await Promise.all(set.frames.map((_, i) =>
        fetch(`${base}/${dir}/${set.name}/${String(i).padStart(3, "0")}.${arm.ext}`).then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b))));
      const row = { set: set.name, arm: name, g: arm.g, ms: [], exact: 0, frames: bytes.length };
      try {
        const dec = await start(arm);
        await dec.decode(bytes[0], 0, -1);  // the warm-up frame the product decodes at init, a group of its own
        for (let i = 0; i < bytes.length; i++) {
          const { ms, pixels } = await dec.decode(bytes[i], i, 0);
          row.ms.push(ms);
          if ((await sha256(pixels, mutate)) === set.frames[i].truth) row.exact++;
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
