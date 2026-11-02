// One arm of RESIDAPART in a worker of its own: H (HTJ2K whole frames), R (the residual decoded alone),
// RA (residual decoded and added) or P (the preview decoded). The client's OpenJPH and dav1d builds,
// refused unless the decoder manifest pins them. Arms and clocks: lab/av1/delivery/residual/README.md
import { codecString, sequence } from "../../../../client/decode/av1-payload.js";
import { built, instantiate } from "../../../../client/decode/wasm-glue.js";
import { createDecoder } from "../../../../client/decode/wasm/dav1d/dav1d.mjs";

const fetchBytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

async function hex(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function packed(planes) {
  const out = new Uint8Array(planes.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of planes) {
    out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at);
    at += p.byteLength;
  }
  return out;
}

/** A codestream in, a view of OpenJPH's output buffer out, valid until the next call. */
async function openjph() {
  const M = await instantiate(await built("openjph"), "OpenJPHModule");
  const d = new M.HTJ2KDecoder();
  return (u) => {
    d.getEncodedBuffer(u.length).set(u);
    d.readHeader();
    d.decode();
    return d.getDecodedBuffer();
  };
}

/** A group of preview units in, each frame's planes out, copied (Y alone for grey, Y U V for colour). */
async function previewDecoder(o, units) {
  if (o.preview === "dav1d") {
    const d = await built("dav1d");
    const M = await instantiate(d, "Dav1dModule");
    const dec = await createDecoder(async () => M);
    return async (group) => group.map((u) => dec.decode(u).planes);
  }
  const frames = [];
  const copies = [];
  let failure = null;
  const decoder = new VideoDecoder({
    output: (f) => {
      const { width, height } = f.visibleRect;
      const rects = o.grey ? [[width, height]] : [[width, height], [(width + 1) >> 1, (height + 1) >> 1], [(width + 1) >> 1, (height + 1) >> 1]];
      const bps = f.format.endsWith("P10") ? 2 : 1;
      const buf = new Uint8Array(f.allocationSize());
      copies.push(f.copyTo(buf).then((layout) => {
        f.close();
        frames.push(rects.map(([w, h], p) => {
          const out = new Uint8Array(w * h * bps);
          for (let y = 0; y < h; y++) out.set(buf.subarray(layout[p].offset + y * layout[p].stride, layout[p].offset + y * layout[p].stride + w * bps), y * w * bps);
          return bps === 2 ? new Uint16Array(out.buffer) : out;
        }));
      }));
    },
    error: (e) => (failure = e),
  });
  // The client's configuration: client/decode/av1-webcodecs.js
  decoder.configure({ codec: codecString(sequence(units[0])), hardwareAcceleration: "prefer-software", optimizeForLatency: true });
  return async (group) => {
    group.forEach((u, i) => decoder.decode(new EncodedVideoChunk({ type: i ? "delta" : "key", timestamp: i, data: u })));
    await decoder.flush();
    await Promise.all(copies);
    if (failure) throw failure;
    copies.length = 0;
    return frames.splice(0);
  };
}

async function previews(o, units) {
  const decode = await previewDecoder(o, units);
  const out = [];
  for (let g = 0; g < units.length; g += o.group) out.push(...(await decode(units.slice(g, g + o.group))));
  return out;
}

const stored = (o, n) => (o.bits <= 8 ? new Uint8Array(n) : o.signed ? new Int16Array(n) : new Uint16Array(n));

const samples = (o, b, bits) => (bits > 8 ? new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2) : b);

/** Preview + residual − offsets, in the stored layout; colour back from 4:2:0 in 16-bit fixed point (encode.py preview_rgb). */
function add(o, planes, res) {
  const { width: w, height: h } = o;
  const out = stored(o, w * h * o.channels);
  const bias = o.residOffset + o.offset + (o.mutate === "offset" ? 1 : 0);
  if (o.grey) {
    const p = planes[0];
    for (let k = 0; k < w * h; k++) out[k] = (p[k] << o.previewShift) + res[k] - bias;
    return out;
  }
  const [Y, U, V] = planes;
  const cw = (w + 1) >> 1;
  const clamp = (x) => (x < 0 ? 0 : x > 255 ? 255 : x);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const c = (y >> 1) * cw + (x >> 1);
      const yy = Y[k];
      const cb = U[c] - 128;
      const cr = V[c] - 128;
      out[3 * k] = clamp(yy + ((91881 * cr + 32768) >> 16)) + res[3 * k] - bias;
      out[3 * k + 1] = clamp(yy + ((-22554 * cb - 46802 * cr + 32768) >> 16)) + res[3 * k + 1] - bias;
      out[3 * k + 2] = clamp(yy + ((116130 * cb + 32768) >> 16)) + res[3 * k + 2] - bias;
    }
  }
  return out;
}

async function whole(o, units) {
  const dec = await openjph();
  const write = (u) => {
    const v = samples(o, dec(u), o.bits);
    if (o.bits <= 8) return v.slice();
    const out = stored(o, v.length);
    for (let k = 0; k < v.length; k++) out[k] = v[k] - o.htj2kShift;
    return out;
  };
  write(units[0]);
  let ms = 0;
  const frames = units.map((u) => {
    const t0 = performance.now();
    const f = write(u);
    ms += performance.now() - t0;
    return f;
  });
  return { ms, frames };
}

/** R and RA: the previews decoded first, off the clock; RA adds on the clock, R after it. */
async function residual(o, units, resids) {
  const pv = await previews(o, units);
  const dec = await openjph();
  add(o, pv[0], samples(o, dec(resids[0]), o.residBits));
  let ms = 0;
  const frames = [];
  const residuals = [];
  for (let i = 0; i < resids.length; i++) {
    const t0 = performance.now();
    const r = samples(o, dec(resids[i]), o.residBits);
    if (o.arm === "RA") frames.push(add(o, pv[i], r));
    ms += performance.now() - t0;
    if (o.arm === "R") {
      residuals.push(r.slice());
      frames.push(add(o, pv[i], r));
    }
  }
  return { ms, frames, previews: pv, residuals };
}

async function preview(o, units) {
  const decode = await previewDecoder(o, units);
  await decode(units.slice(0, o.group));
  const out = [];
  const t0 = performance.now();
  for (let g = 0; g < units.length; g += o.group) out.push(...(await decode(units.slice(g, g + o.group))));
  return { ms: performance.now() - t0, previews: out };
}

const run = { H: (o, u) => whole(o, u), R: residual, RA: residual, P: (o, u) => preview(o, u) };

onmessage = async ({ data: o }) => {
  try {
    const units = await Promise.all(o.urls.map(fetchBytes));
    const resids = o.residUrls ? await Promise.all(o.residUrls.map(fetchBytes)) : null;
    const got = await run[o.arm](o, units, resids);
    const hashes = async (list) => { const h = []; for (const v of list ?? []) h.push(await hex(v)); return h; };
    postMessage({
      ms: got.ms,
      frames: await hashes(got.frames),
      previews: await hashes((got.previews ?? []).map(packed)),
      residuals: await hashes(got.residuals),
    });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
