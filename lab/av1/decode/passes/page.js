// One browser's share of a passes round: every arm over every set, one frame at a time through a worker of the
// product's decoder, each frame timed by the product's own stamps and checked twice. lab/av1/decode/passes/README.md
import { order } from "../../../order.mjs";
import { built } from "/client/decode/wasm-glue.js";

/** The viewer's AV1 decoder config (client/viewer/viewer.js). */
const DEFAULT = { codec: "av1", ...(await built("dav1d")) };

/** name → its decoder config; W′ is W again in a worker of its own, the A/A. */
export const ARMS = { W: DEFAULT, "W′": DEFAULT, W2: { ...DEFAULT, onePass: true } };

async function sha256(sab, mutate) {
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  if (mutate) copy[copy.length >> 1] ^= 1;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

const now = () => performance.timeOrigin + performance.now();

/** A decoder worker as the downloader drives one: init with the series' digests, then one frame in flight at a time. */
async function start(product, decoder, digests) {
  const worker = new Worker(`${product}/decoder.js`, { type: "module" });
  const { port1, port2 } = new MessageChannel();
  let waiting = null;
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.kind === "ready") waiting.resolve();
    if (m.kind === "init-failed" || m.kind === "failed") waiting.reject(new Error(m.reason));
  };
  worker.onerror = (e) => waiting.reject(new Error(`worker: ${e.message ?? "failed to load"}`));
  port2.onmessage = (e) => e.data.kind === "frame" && !e.data.preview && waiting.resolve({ ...e.data, receipt: now() });
  const next = () => new Promise((resolve, reject) => (waiting = { resolve, reject }));
  const ready = next();
  worker.postMessage({ kind: "init", toConsumer: port1, decoder, groupLength: 1, digests }, [port1]);
  await ready;
  return {
    async decode(bytes, index, gen) {
      const done = next();
      const copy = bytes.slice();
      const posted = now();
      worker.postMessage({ kind: "decode", index, gen, key: true, bytes: copy, stamps: {} }, [copy.buffer]);
      return { ...(await done), posted };
    },
    close: () => { worker.terminate(); port2.close(); },
  };
}

/** rows: { set, arm, frames: [{ ms, post, exact, path, mismatchOn }], exact, n, error? }; `product` is the decoder's directory. */
export async function run({ frames: dir, product = "/client/decode", round: r, mutate = false, only, sets }) {
  const manifest = (await (await fetch(`/${dir}/manifest.json`)).json()).filter((s) => !sets || sets.includes(s.name));
  const rows = [];
  for (const set of order(manifest, r)) {
    const digests = set.frames.map((f) => (mutate ? f.xxh3_flipped : f.xxh3));
    const n = set.frames.length;
    const bytes = await Promise.all(set.frames.map((_, i) =>
      fetch(`/${dir}/${set.name}/${String(i).padStart(3, "0")}.av1`).then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b))));
    for (const arm of order(Object.keys(ARMS).filter((a) => !only || only.includes(a)), r)) {
      const row = { set: set.name, arm, frames: [], exact: 0, n };
      try {
        const dec = await start(product, ARMS[arm], digests);
        await dec.decode(bytes[0], 0, -1); // the warm-up frame, not timed
        for (let i = 0; i < n; i++) {
          const f = await dec.decode(bytes[i], i, 0);
          // Exact first time on WebCodecs: a frame the product's fallback rescued does not count.
          const exact = f.exact === true && !f.mismatchOn && f.path === "av1-webcodecs" && (await sha256(f.pixels, mutate)) === set.frames[i].truth;
          row.frames.push({ ms: f.stamps.decodeEnd - f.stamps.decodeStart, post: f.receipt - f.posted, exact, path: f.path, mismatchOn: f.mismatchOn });
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
