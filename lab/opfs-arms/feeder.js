// Stands in for one of the decoders: checked frames posted to the view worker as shared memory, at a rate or on
// credit; under arm D it first writes each frame to its own file, as the decoder would from its heap.
import { hasher } from "../../client/decode/xxh3.js";

const FIELDS = 4;
const now = () => performance.timeOrigin + performance.now();
let port = null;
let fields = [];
let dir = null;

function field(w, h, k) {
  const v = new Uint16Array(w * h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) v[i] = (x * 7 + y * 13 + k * 1009) & 0xffff;
  return v;
}

/** Arm D: a file per frame through its own sync handle, timed on this thread; the handle pair and the write apart. */
async function writeFile(index, c) {
  const t0 = now();
  const h = await (await dir.getFileHandle(String(index), { create: true })).createSyncAccessHandle();
  const t1 = now();
  if (c.mutant !== "drop-writes") h.write(new Uint8Array(fields[index % FIELDS].samples.buffer), { at: 0 });
  h.close();
  return { handleMs: t1 - t0, writeMs: now() - t1 };
}

async function frame(index, c) {
  const f = fields[index % FIELDS];
  const decoder = c.arm === "D" ? await writeFile(index, c) : null;
  const pixels = new SharedArrayBuffer(c.w * c.h * 2);
  new Uint16Array(pixels).set(f.samples);
  return { index, decoder, info: { width: c.w, height: c.h, bits: 16, components: 1, signed: false, pixels, min: f.min, max: f.max, exact: true } };
}

async function prepare(c) {
  const xxh3 = await hasher();
  if (c.arm === "D") dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("opfs-arms", { create: true })).getDirectoryHandle("frames", { create: true });
  fields = [...Array(FIELDS).keys()].map((k) => {
    const samples = field(c.w, c.h, k);
    let min = 65535, max = 0;
    for (const s of samples) (min = Math.min(min, s)), (max = Math.max(max, s));
    return { samples, min, max, digest: xxh3.init().update(new Uint8Array(samples.buffer)).digest("hex") };
  });
  return [...Array(c.n).keys()].map((i) => fields[i % FIELDS].digest);
}

/** This decoder's share of `from`…`to`, every `stride`-th frame from `first`: frame j is due at
 *  start + (j − from) × frameBytes / bytesPerMs, or, with `credits`, when one is free. One frame at a time. */
function go(c, { from, to, first, stride, bytesPerMs, credits }) {
  let next = first;
  let free = credits ?? Infinity;
  let busy = Promise.resolve();
  const t0 = performance.now();
  const post = (i) => (busy = busy.then(async () => {
    const f = await frame(i, c);
    port.postMessage({ kind: "frame", postedAt: now(), ...f });
  }));
  if (credits) {
    port.addEventListener("message", ({ data }) => {
      if (data.kind !== "credit") return;
      free++;
      while (free > 0 && next < to) free--, post(next), (next += stride);
    });
    while (free > 0 && next < to) free--, post(next), (next += stride);
    return;
  }
  const dueMs = (i) => ((i - from) * c.w * c.h * 2) / bytesPerMs;
  const tick = () => {
    while (next < to && dueMs(next) <= performance.now() - t0) post(next), (next += stride);
    if (next < to) setTimeout(tick, Math.max(0, t0 + dueMs(next) - performance.now()));
  };
  tick();
}

onmessage = async ({ data }) => {
  port = data.port;
  const c = data.config;
  port.onmessage = ({ data: m }) => {
    if (m.kind === "go") go(c, m);
    if (m.kind === "send") (async () => { for (let i = m.from; i < m.to; i++) port.postMessage({ kind: "frame", ...(await frame(i, c)) }); })();
  };
  port.postMessage({ kind: "digests", digests: await prepare(c) });
};
