// Stands in for the decoders: checked frames posted to the view worker as shared memory, at a rate or on credit.
import { hasher } from "../../client/decode/xxh3.js";

const FIELDS = 4;
let port = null;
let fields = [];

function field(w, h, k) {
  const v = new Uint16Array(w * h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) v[i] = (x * 7 + y * 13 + k * 1009) & 0xffff;
  return v;
}

function frame(index, { w, h }) {
  const f = fields[index % FIELDS];
  const pixels = new SharedArrayBuffer(w * h * 2);
  new Uint16Array(pixels).set(f.samples);
  return { index, info: { width: w, height: h, bits: 16, components: 1, signed: false, pixels, min: f.min, max: f.max, exact: true } };
}

async function prepare(c) {
  const xxh3 = await hasher();
  fields = [...Array(FIELDS).keys()].map((k) => {
    const samples = field(c.w, c.h, k);
    let min = 65535, max = 0;
    for (const s of samples) (min = Math.min(min, s)), (max = Math.max(max, s));
    return { samples, min, max, digest: xxh3.init().update(new Uint8Array(samples.buffer)).digest("hex") };
  });
  return [...Array(c.n).keys()].map((i) => fields[i % FIELDS].digest);
}

/** From `from` to `to`: frame j is due at start + (j − from) × frameBytes / bytesPerMs, or, with `credits`, when one is free. */
function go(c, { from, to, bytesPerMs, credits }) {
  let next = from;
  let free = credits ?? Infinity;
  const t0 = performance.now();
  const post = () => {
    const f = frame(next++, c);
    port.postMessage({ kind: "frame", postedAt: performance.timeOrigin + performance.now(), ...f });
  };
  if (credits) {
    port.addEventListener("message", ({ data }) => {
      if (data.kind !== "credit") return;
      free++;
      while (free > 0 && next < to) free--, post();
    });
    while (free > 0 && next < to) free--, post();
    return;
  }
  const tick = () => {
    const due = from + Math.floor(((performance.now() - t0) * bytesPerMs) / (c.w * c.h * 2)) + 1;
    while (next < Math.min(due, to)) post();
    if (next < to) setTimeout(tick, Math.max(0, t0 + ((next - from) * c.w * c.h * 2) / bytesPerMs - performance.now()));
  };
  tick();
}

onmessage = async ({ data }) => {
  port = data.port;
  const c = data.config;
  port.onmessage = ({ data: m }) => {
    if (m.kind === "go") go(c, m);
    if (m.kind === "send") for (let i = m.from; i < m.to; i++) port.postMessage({ kind: "frame", ...frame(i, c) });
  };
  port.postMessage({ kind: "digests", digests: await prepare(c) });
};
