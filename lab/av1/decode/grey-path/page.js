// One browser's share of a grey path round: every arm over every set, one frame at a time through a decoder worker,
// timed by the product's decodeStart→decodeEnd and checked twice. README.md here
import { order } from "../../../order.mjs";
import { built } from "/client/decode/wasm-glue.js";

const W = { codec: "av1", ...(await built("dav1d")), onePass: false };
const DEFAULT = { ...W, onePass: true };
const PRODUCT = "/client/decode";

/** name → its decoder config; W′ is W again in a worker of its own, the A/A. */
export const ARMS = {
  W,
  "W′": W,
  W2: DEFAULT,
  R: { ...DEFAULT, reuseCopyBuffer: true },
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
    async decode(bytes, index) {
      const done = next();
      const copy = bytes.slice();
      const posted = now();
      worker.postMessage({ kind: "decode", index, gen: 0, key: true, bytes: copy, stamps: {} }, [copy.buffer]);
      return { ...(await done), posted };
    },
    close: () => { worker.terminate(); port2.close(); },
  };
}

const frameBytes = (dir, set, i) =>
  fetch(`/${dir}/${set}/${String(i).padStart(3, "0")}.av1`).then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b));

/** The frame's checks; exact: first time on WebCodecs, so a frame the fallback rescued, or one off WebCodecs, does not count. */
async function checks(f, truth, mutate) {
  const c = { digest: f.exact === true, sha: (await sha256(f.pixels, mutate)) === truth, path: f.path, mismatchOn: f.mismatchOn };
  return { ...c, exact: c.digest && c.sha && !c.mismatchOn && c.path === "av1-webcodecs" };
}

/**
 * rows: { set, arm, frames: [{ decode, ms, ...checks }], warm: checks, exact, n,
 * error? }; `decode` is decodeStart→decodeEnd, `ms` the page's post → the consumer port's receipt. `products`
 * overrides an arm's directory.
 */
export async function run({ frames: dir, products = {}, round: r, mutate = false, only, sets }) {
  const all = await (await fetch(`/${dir}/manifest.json`)).json();
  const rows = [];
  for (const set of order(all.filter((s) => !sets || sets.includes(s.name)), r)) {
    const n = set.frames.length;
    const truths = set.frames.map((f) => f.truth);
    const digests = set.frames.map((f) => (mutate ? f.xxh3_flipped : f.xxh3));
    const bytes = await Promise.all(set.frames.map((_, i) => frameBytes(dir, set.name, i)));
    // The warm-up frame is frame 0 again, at index n so that its digest is checked too.
    digests.push(digests[0]);
    for (const arm of order(Object.keys(ARMS).filter((a) => !only || only.includes(a)), r)) {
      const row = { set: set.name, arm, frames: [], exact: 0, n };
      try {
        const dec = await start(products[arm] ?? PRODUCT, ARMS[arm], digests);
        const w = await dec.decode(bytes[0], n);
        row.warm = await checks(w, truths[0], mutate);
        for (let i = 0; i < n; i++) {
          const f = await dec.decode(bytes[i], i);
          const c = await checks(f, truths[i], mutate);
          row.frames.push({ decode: f.stamps.decodeEnd - f.stamps.decodeStart, ms: f.receipt - f.posted, ...c });
          if (c.exact) row.exact++;
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
