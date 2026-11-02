// One browser's share of a merge-free round: every arm over every set, one frame at a time through a decoder worker,
// each frame timed from the page's post to the consumer port's receipt and checked twice. README.md here
import { order } from "../../../order.mjs";
import { built } from "/client/decode/wasm-glue.js";

const DEFAULT = { codec: "av1", ...(await built("dav1d")) };
const ONE_PASS = { ...DEFAULT, onePass: true };
const PRODUCT = "/client/decode";

/** name → its decoder config and the directory its worker loads; W′ is W again in a worker of its own, the A/A. */
export const ARMS = {
  W: { config: DEFAULT, product: PRODUCT },
  "W′": { config: DEFAULT, product: PRODUCT },
  W2: { config: ONE_PASS, product: PRODUCT },
  R: { config: { ...ONE_PASS, reuseCopyBuffer: true }, product: PRODUCT },
  S: { config: ONE_PASS, product: "/lab/.av1-work/merge-free/products/S/client/decode" },
};

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

const frameBytes = (dir, set, i) =>
  fetch(`/${dir}/${set}/${String(i).padStart(3, "0")}.av1`).then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b));

/**
 * rows: { set, arm, frames: [{ ms, stamps, exact, path, mismatchOn }], exact, n, error? }. `products` overrides an
 * arm's directory; `warmFrom` takes the warm-up frame from another set (a smaller frame before the timed ones).
 */
export async function run({ frames: dir, products = {}, round: r, mutate = false, only, sets, warmFrom }) {
  const all = await (await fetch(`/${dir}/manifest.json`)).json();
  const manifest = all.filter((s) => !sets || sets.includes(s.name));
  const warmSet = warmFrom && all.find((s) => s.name === warmFrom);
  const rows = [];
  for (const set of order(manifest, r)) {
    const n = set.frames.length;
    const digests = set.frames.map((f) => (mutate ? f.xxh3_flipped : f.xxh3));
    const bytes = await Promise.all(set.frames.map((_, i) => frameBytes(dir, set.name, i)));
    const warm = warmSet ? await frameBytes(dir, warmSet.name, 0) : bytes[0];
    digests.push(warmSet ? warmSet.frames[0].xxh3 : digests[0]);
    for (const arm of order(Object.keys(ARMS).filter((a) => !only || only.includes(a)), r)) {
      const row = { set: set.name, arm, frames: [], exact: 0, n };
      try {
        const dec = await start(products[arm] ?? ARMS[arm].product, ARMS[arm].config, digests);
        await dec.decode(warm, n, -1); // the warm-up frame, not timed
        for (let i = 0; i < n; i++) {
          const f = await dec.decode(bytes[i], i, 0);
          // Exact first time on the arm's own path: a frame the product's fallback rescued does not count.
          const exact = f.exact === true && !f.mismatchOn && f.path === "av1-webcodecs" && (await sha256(f.pixels, mutate)) === set.frames[i].truth;
          row.frames.push({ ms: f.receipt - f.posted, decode: f.stamps.decodeEnd - f.stamps.decodeStart, exact, path: f.path, mismatchOn: f.mismatchOn });
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
