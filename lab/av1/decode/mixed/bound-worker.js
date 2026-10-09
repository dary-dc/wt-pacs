// MIXDEC's bound: one split payload's two streams through dav1d-WASM, as the client decodes them today, each
// stream's decode timed apart and the merged frame checked against its source. lab/av1/decode/mixed/README.md
import { parsePayload, units } from "/client/decode/av1-payload.js";
import { begin, end } from "/client/decode/av1-frame.js";
import * as dav1d from "/client/decode/av1-dav1d.js";

async function sha256(sab) {
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timed(bytes) {
  const payload = parsePayload(bytes);
  const [top, low] = units(payload.frames[0], payload.split);
  const t0 = performance.now();
  const f = begin(dav1d.picture(top), payload);
  const t1 = performance.now();
  const l = dav1d.picture(low);
  const t2 = performance.now();
  const out = end(f, l);
  return { top: t1 - t0, low: t2 - t1, merge: performance.now() - t2, out };
}

onmessage = async ({ data: { kind, decoder, payloads, truth } }) => {
  if (kind === "init") return dav1d.init(decoder).then(() => postMessage({ kind: "ready" }));
  timed(payloads[0]);  // the warm-up frame
  const rows = { top: [], low: [], merge: [], exact: 0 };
  for (let i = 0; i < payloads.length; i++) {
    const { out, ...ms } = timed(payloads[i]);
    for (const k of ["top", "low", "merge"]) rows[k].push(ms[k]);
    if ((await sha256(out.sab)) === truth[i]) rows.exact++;
  }
  postMessage({ kind: "done", rows });
};
