// The decoders every PROFILEDECODE harness drives, as §6 configures them: dav1d-WASM, WebCodecs, OpenJPH-WASM.
import { codecString, sequence } from "../../../client/decode/av1-payload.js";
import { built, instantiate } from "../../../client/decode/wasm-glue.js";

export const fetchBytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
export const sleepUntil = (t) => new Promise((r) => setTimeout(r, Math.max(0, t - performance.now())));
export const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

export async function hex(a) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(a.buffer, a.byteOffset, a.byteLength)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** dav1d-WASM, one thread, max_frame_delay 1 (dav1d_wrap.c); `fresh()` closes the decoder and opens a new one. */
export async function dav1d() {
  const M = await instantiate(await built("dav1d"), "Dav1dModule");
  if (M._av1_open(1) < 0) throw new Error("dav1d_open");
  let ptr = 0;
  let cap = 0;
  return {
    async decode(u) {
      if (u.length > cap) {
        if (ptr) M._free(ptr);
        ptr = M._malloc((cap = u.length));
      }
      M.HEAPU8.set(u, ptr);
      const r = M._av1_decode(ptr, u.length);
      if (r < 0) throw new Error(`dav1d ${r}`);
      const [w, h, wide] = [M._av1_width(), M._av1_height(), M._av1_bits() > 8];
      const row = w * (wide ? 2 : 1);
      const src = M._av1_plane(0);
      const stride = Number(M._av1_stride(0));
      const out = new Uint8Array(row * h);
      for (let y = 0; y < h; y++) out.set(M.HEAPU8.subarray(src + y * stride, src + y * stride + row), y * row);
      return wide ? new Uint16Array(out.buffer) : out;
    },
    async flush() {},
    async fresh() {
      M._av1_close();
      if (M._av1_open(1) < 0) throw new Error("dav1d_open");
    },
  };
}

/** A unit with no frame by then is reported, not waited on. */
const STALL_MS = 20000;

/** WebCodecs as §6 configures it, one unit in flight, its luma copied out. */
export async function webcodecs(first) {
  const config = { codec: codecString(sequence(first)), hardwareAcceleration: "prefer-software", optimizeForLatency: true };
  let vd;
  let wake = null;
  let got = null;
  let failed = null;
  let stamp = 0;
  const open = () => {
    vd = new VideoDecoder({ output: (f) => ((got = f), wake?.()), error: (e) => ((failed = e), wake?.()) });
    vd.configure(config);
  };
  open();
  return {
    async decode(u) {
      const out = new Promise((r) => (wake = r));
      vd.decode(new EncodedVideoChunk({ type: sequence(u) ? "key" : "delta", timestamp: stamp++, data: u }));
      let stall;
      await Promise.race([out, new Promise((_, no) => (stall = setTimeout(() => no(new Error(`no frame in ${STALL_MS} ms (${vd.state}, queue ${vd.decodeQueueSize})`)), STALL_MS)))]);
      clearTimeout(stall);
      wake = null;
      if (failed) throw failed;
      const f = got;
      got = null;
      const { width: w, height: h } = f.visibleRect;
      const wide = f.format.endsWith("P10");
      const buf = new Uint8Array(f.allocationSize());
      const [luma] = await f.copyTo(buf);
      f.close();
      const row = w * (wide ? 2 : 1);
      const px = new Uint8Array(row * h);
      for (let y = 0; y < h; y++) px.set(buf.subarray(luma.offset + y * luma.stride, luma.offset + y * luma.stride + row), y * row);
      return wide ? new Uint16Array(px.buffer) : px;
    },
    async flush() {
      await vd.flush();
      if (failed) throw failed;
    },
    async fresh() {
      if (vd.state !== "closed") vd.close();
      failed = null;
      open();
    },
  };
}

/** OpenJPH-WASM, one thread: a codestream in, its samples copied out. */
export async function openjph() {
  const M = await instantiate(await built("openjph"), "OpenJPHModule");
  const d = new M.HTJ2KDecoder();
  return (u, wide) => {
    d.getEncodedBuffer(u.length).set(u);
    d.readHeader();
    d.decode();
    const b = d.getDecodedBuffer();
    return wide ? new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : b.slice();
  };
}
