// MIXDEC's bound: one split item's two streams through dav1d-WASM, as the client decodes them today, each
// stream's decode timed apart and the merged frame checked against its source. lab/av1/decode/mixed/README.md
import { parseItem, units } from "/client/downloader/av1-item.js";
import { begin, end } from "/client/downloader/av1-frame.js";
import * as dav1d from "/client/downloader/decode-av1.js";

async function sha256(sab) {
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timed(bytes) {
  const item = parseItem(bytes);
  const [top, low] = units(item.frames[0], item.split);
  const t0 = performance.now();
  const f = begin(dav1d.picture(top), item);
  const t1 = performance.now();
  const l = dav1d.picture(low);
  const t2 = performance.now();
  const out = end(f, l);
  return { top: t1 - t0, low: t2 - t1, merge: performance.now() - t2, out };
}

onmessage = async ({ data: { kind, decoder, items, truth } }) => {
  if (kind === "init") return dav1d.init(decoder).then(() => postMessage({ kind: "ready" }));
  timed(items[0]);  // the warm-up frame
  const rows = { top: [], low: [], merge: [], exact: 0 };
  for (let i = 0; i < items.length; i++) {
    const { out, ...ms } = timed(items[i]);
    for (const k of ["top", "low", "merge"]) rows[k].push(ms[k]);
    if ((await sha256(out.sab)) === truth[i]) rows.exact++;
  }
  postMessage({ kind: "done", rows });
};
