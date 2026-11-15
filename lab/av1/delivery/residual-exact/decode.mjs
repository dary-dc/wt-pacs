// RESIDEXACT's client side (docs/av1/residual-exact.md §2): one cell's units through one decoder, every luma
// sample compared with native dav1d's, which streams.py wrote beside them as NNN.y.
import { codecString, sequence } from "../../../../client/decode/av1-payload.js";
import { built, instantiate } from "../../../../client/decode/wasm-glue.js";

const bytes = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};

const hex = async (a) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(a.buffer, a.byteOffset, a.byteLength))),
    (b) => b.toString(16).padStart(2, "0")).join("");

/** The luma rows of a picture, packed: `w` samples a row of `wide` (16-bit LE) or 8-bit samples. */
function packed(heap, offset, stride, w, h, wide) {
  const row = w * (wide ? 2 : 1);
  const out = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) out.set(heap.subarray(offset + y * stride, offset + y * stride + row), y * row);
  return wide ? new Uint16Array(out.buffer) : out;
}

async function dav1dWasm() {
  const M = await instantiate(await built("dav1d"), "Dav1dModule");
  if (M._av1_open(1) < 0) throw new Error("dav1d_open");
  let ptr = 0;
  let cap = 0;
  return {
    name: "dav1d-wasm",
    async decode(u) {
      if (u.length > cap) {
        if (ptr) M._free(ptr);
        ptr = M._malloc((cap = u.length));
      }
      M.HEAPU8.set(u, ptr);
      const r = M._av1_decode(ptr, u.length);
      if (r < 0) throw new Error(`dav1d ${r}`);
      const p = { w: M._av1_width(), h: M._av1_height(), bits: M._av1_bits(), format: `layout ${M._av1_layout()}` };
      p.luma = packed(M.HEAPU8, M._av1_plane(0), Number(M._av1_stride(0)), p.w, p.h, p.bits > 8);
      return p;
    },
    close: () => M._av1_close(),
  };
}

const STALL_MS = 30000;

async function webcodecs(first, accel) {
  const config = { codec: codecString(sequence(first)), hardwareAcceleration: accel, optimizeForLatency: true };
  const support = await VideoDecoder.isConfigSupported(config);
  let wake = null;
  let got = null;
  let failed = null;
  let stamp = 0;
  const vd = new VideoDecoder({ output: (f) => ((got = f), wake?.()), error: (e) => ((failed = e), wake?.()) });
  vd.configure(config);
  return {
    name: `webcodecs-${accel}`,
    config: { ...config, supported: support.supported },
    async decode(u) {
      const out = new Promise((r) => (wake = r));
      vd.decode(new EncodedVideoChunk({ type: sequence(u) ? "key" : "delta", timestamp: stamp++, data: u }));
      let stall;
      await Promise.race([out, new Promise((r) => (stall = setTimeout(r, STALL_MS)))]);
      clearTimeout(stall);
      if (!got && !failed && vd.state === "configured") await vd.flush().catch((e) => (failed = e));
      wake = null;
      if (failed) throw failed;
      if (!got) throw new Error(`no frame in ${STALL_MS} ms`);
      const f = got;
      got = null;
      const { width: w, height: h } = f.visibleRect;
      const wide = /P1[02]$/.test(f.format);
      const buf = new Uint8Array(f.allocationSize());
      const [luma] = await f.copyTo(buf);
      const p = { w, h, bits: wide ? (f.format.endsWith("P12") ? 12 : 10) : 8, format: f.format };
      p.luma = packed(buf, luma.offset, luma.stride, w, h, wide);
      f.close();
      return p;
    },
    close: () => vd.state !== "closed" && vd.close(),
  };
}

/**
 * Every unit of `cell` through `decoder` ("dav1d-wasm", or "webcodecs" with `accel`); per frame the decoded luma
 * against NNN.y — mismatch count, the first eight [frame, y, x, got − ref], the largest |Δ| — and its SHA-256.
 * `mutate` [frame, y, x] flips that sample's low bit after decoding: the comparison must report exactly it.
 */
export async function check({ dir, n, decoder, accel, mutate }) {
  const out = { decoder, frames: 0, samples: 0, differ: 0, frames_differ: 0, max_abs: 0, first: [], sha: [], formats: {} };
  const first = await bytes(`${dir}/000.obu`);
  let d;
  try {
    d = decoder === "dav1d-wasm" ? await dav1dWasm() : await webcodecs(first, accel);
    out.config = d.config;
    for (let i = 0; i < n; i++) {
      const p = await d.decode(i ? await bytes(`${dir}/${String(i).padStart(3, "0")}.obu`) : first);
      const ref = await bytes(`${dir}/${String(i).padStart(3, "0")}.y`);
      const r = p.luma instanceof Uint16Array ? new Uint16Array(ref.buffer) : ref;
      if (mutate && i === mutate[0]) p.luma[mutate[1] * p.w + mutate[2]] ^= 1;
      out.formats[`${p.format} ${p.bits}-bit ${p.w}x${p.h}`] = (out.formats[`${p.format} ${p.bits}-bit ${p.w}x${p.h}`] ?? 0) + 1;
      if (r.length !== p.luma.length) throw new Error(`frame ${i}: ${p.luma.length} samples, reference ${r.length}`);
      let bad = 0;
      for (let k = 0; k < r.length; k++) {
        const dv = p.luma[k] - r[k];
        if (dv) {
          bad++;
          out.max_abs = Math.max(out.max_abs, Math.abs(dv));
          if (out.first.length < 8) out.first.push([i, Math.floor(k / p.w), k % p.w, dv]);
        }
      }
      out.frames++;
      out.samples += r.length;
      out.differ += bad;
      out.frames_differ += bad ? 1 : 0;
      out.sha.push(await hex(p.luma));
    }
  } catch (e) {
    out.error = `${e?.name ?? "Error"}: ${e?.message ?? e}`;
  } finally {
    d?.close();
  }
  return out;
}
