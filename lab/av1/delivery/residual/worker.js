// One arm of RESID's decode timing in a worker of its own: a series' first frames made exact, in
// order — HTJ2K alone, or a preview group decoded, then each frame's residual decoded and added.
// The clock runs from the first unit handed over to the last frame's samples written. Hashed after.
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

async function loadScript(url, name) {
  const src = await (await fetch(url)).text();
  return new Function(`${src}\nreturn ${name};`).call(self);
}

async function dav1dDecoder(base) {
  const factory = await loadScript(`${base}/lab/.av1-build/out/simd.js`, "Dav1dModule");
  const wasmBinary = await (await fetch(`${base}/lab/.av1-build/out/simd.wasm`)).arrayBuffer();
  return createDecoder(factory, { wasmBinary });
}

async function htj2kDecoder(base) {
  const factory = await loadScript(`${base}/client/decode/wasm/vendor/openjph/openjphjs.js`, "Module");
  const wasmBinary = await (await fetch(`${base}/client/decode/wasm/vendor/openjph/openjphjs.wasm`)).arrayBuffer();
  const M = await factory({ wasmBinary });
  const d = new M.HTJ2KDecoder();
  return (u) => {
    d.getEncodedBuffer(u.length).set(u);
    d.readHeader();
    d.decode();
    return d.getDecodedBuffer();
  };
}

/** A group of preview units in, its frames' planes out (Y alone for grey, Y U V for colour). */
async function previewDecoder(o) {
  if (o.preview === "dav1d") {
    const dec = await dav1dDecoder(o.base);
    return async (units) => units.map((u) => dec.decode(u).planes);
  }
  const frames = [];
  const copies = [];
  let failure = null;
  const decoder = new VideoDecoder({
    output: (f) => {
      const n = o.grey ? 1 : 3;
      const bps = f.format.endsWith("P10") ? 2 : 1;
      const rects = Array.from({ length: n }, (_, p) =>
        p ? [Math.ceil(f.codedWidth / 2), Math.ceil(f.codedHeight / 2)] : [f.codedWidth, f.codedHeight]);
      const buf = new Uint8Array(f.allocationSize());
      copies.push(f.copyTo(buf).then((layout) => {
        f.close();
        frames.push(rects.map(([w, h], p) => {
          const out = new Uint8Array(w * h * bps);
          for (let y = 0; y < h; y++) {
            const s = layout[p].offset + y * layout[p].stride;
            out.set(buf.subarray(s, s + w * bps), y * w * bps);
          }
          return bps === 2 ? new Uint16Array(out.buffer) : out;
        }));
      }));
    },
    error: (e) => (failure = e),
  });
  decoder.configure({ codec: o.codec, hardwareAcceleration: "prefer-software" });
  return async (units) => {
    units.forEach((u, i) => decoder.decode(new EncodedVideoChunk({ type: i ? "delta" : "key", timestamp: i, data: u })));
    await decoder.flush();
    await Promise.all(copies);
    if (failure) throw failure;
    copies.length = 0;
    return frames.splice(0);
  };
}

/** A residual unit in, its samples out as one interleaved typed array (h × w × channels). */
async function residualDecoder(o) {
  if (o.residual === "htj2k") {
    const dec = await htj2kDecoder(o.base);
    return (u) => {
      const b = dec(u);
      return o.residBits > 8 ? new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2) : b;
    };
  }
  const dec = await dav1dDecoder(o.base);
  return (u) => {
    const { planes } = dec.decode(u);
    if (o.grey) return planes[0];
    const [g, b, r] = planes;
    const out = new Uint16Array(r.length * 3);
    for (let k = 0; k < r.length; k++) {
      out[3 * k] = r[k];
      out[3 * k + 1] = g[k];
      out[3 * k + 2] = b[k];
    }
    return out;
  };
}

function storedArray(o, n) {
  return o.bits <= 8 ? new Uint8Array(n) : o.signed ? new Int16Array(n) : new Uint16Array(n);
}

/** Preview + residual − offsets, in the stored layout; the colour preview in 16-bit fixed point. */
function add(o, planes, res) {
  const { width: w, height: h } = o;
  const out = storedArray(o, w * h * o.channels);
  const bias = o.residOffset + o.offset;
  if (o.grey) {
    const p = planes[0];
    for (let k = 0; k < w * h; k++) out[k] = (p[k] << o.greyShift) + res[k] - bias;
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

async function htj2kAlone(o, units) {
  const dec = await htj2kDecoder(o.base);
  const run = (us) => us.map((u) => {
    const b = dec(u);
    if (o.bits <= 8) return b.slice();
    const v = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
    const out = storedArray(o, v.length);
    for (let k = 0; k < v.length; k++) out[k] = v[k] - o.htj2kShift;
    return out;
  });
  run(units.slice(0, 1));
  const t0 = performance.now();
  const frames = run(units);
  return { ms: performance.now() - t0, frames, previews: [] };
}

async function withResidual(o, units, resids) {
  const preview = await previewDecoder(o);
  const residual = await residualDecoder(o);
  const run = async (n) => {
    const frames = [];
    const previews = [];
    for (let g = 0; g < n; g += o.group) {
      const planes = await preview(units.slice(g, Math.min(g + o.group, n)));
      planes.forEach((p, j) => {
        previews.push(p);
        frames.push(add(o, p, residual(resids[g + j])));
      });
    }
    return { frames, previews };
  };
  await run(Math.min(o.group, units.length));
  const t0 = performance.now();
  const got = await run(units.length);
  return { ms: performance.now() - t0, ...got };
}

onmessage = async ({ data: o }) => {
  try {
    const units = await Promise.all(o.urls.map(fetchBytes));
    const resids = o.residUrls ? await Promise.all(o.residUrls.map(fetchBytes)) : null;
    const got = resids ? await withResidual(o, units, resids) : await htj2kAlone(o, units);
    const hashes = [];
    for (const f of got.frames) hashes.push(await hex(f));
    const previewHashes = [];
    for (const p of got.previews) previewHashes.push(await hex(packed(p)));
    postMessage({ ms: got.ms, hashes, previewHashes });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
