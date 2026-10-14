// A slice pair through the product's HTJ2K decoder: mode "two" decodes the two served frames, mode "lift"
// the low and high band and inverts the 5/3 step — lab/av1/decode/inter-slice/README.md.
import { decodeFrame, init } from "../../../../client/decode/htj2k.js";

const views = { true: [Int8Array, Int16Array], false: [Uint8Array, Uint16Array] };
const view = (f) => new views[f.info.isSigned][f.info.bitsPerSample > 8 ? 1 : 0](f.sab);

function unlift(low, high) {
  const n = low.length;
  const make = () => new low.constructor(new SharedArrayBuffer(n * low.BYTES_PER_ELEMENT));
  const a = make();
  const b = make();
  let aMin = Infinity;
  let aMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const h = high[i];
    const x0 = low[i] - ((h + 1) >> 1);
    const x1 = x0 + h;
    a[i] = x0;
    b[i] = x1;
    if (x0 < aMin) aMin = x0;
    if (x0 > aMax) aMax = x0;
    if (x1 < bMin) bMin = x1;
    if (x1 > bMax) bMax = x1;
  }
  return [{ sab: a.buffer, range: { min: aMin, max: aMax } }, { sab: b.buffer, range: { min: bMin, max: bMax } }];
}

function pair(mode, first, second) {
  const f = decodeFrame(first);
  const g = decodeFrame(second);
  return mode === "two" ? [f, g] : unlift(view(f), view(g));
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    try {
      await init(m.decoder);
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  try {
    const t0 = performance.now();
    const out = pair(m.mode, m.first, m.second);
    const ms = performance.now() - t0;
    postMessage({ kind: "pair", ms, frames: out.map(({ sab, range }) => ({ sab, min: range.min, max: range.max })) });
  } catch (err) {
    postMessage({ kind: "failed", reason: String(err?.message ?? err) });
  }
};
