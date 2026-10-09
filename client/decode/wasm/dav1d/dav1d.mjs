/**
 * dav1d's WASM build behind the shape decoder.js needs: one temporal unit's bytes in, the frame's
 * planes out, tightly packed. One decoder per group: its reference state carries frame to frame.
 */
export async function createDecoder(factory, { threads = 1, ...moduleOptions } = {}) {
  const M = await factory(moduleOptions);
  const opened = M._av1_open(threads);
  if (opened < 0) throw new Error(`dav1d_open: ${opened}`);
  let ptr = 0;
  let cap = 0;

  function decode(bytes) {
    if (bytes.length > cap) {
      if (ptr) M._free(ptr);
      cap = bytes.length;
      ptr = M._malloc(cap);
    }
    M.HEAPU8.set(bytes, ptr);
    const r = M._av1_decode(ptr, bytes.length);
    if (r < 0) throw new Error(`dav1d: ${r}`);

    const width = M._av1_width();
    const height = M._av1_height();
    const bits = M._av1_bits();
    const layout = M._av1_layout();
    const sampleBytes = bits > 8 ? 2 : 1;
    // Dav1dPixelLayout: 0 is 4:0:0, 1 is 4:2:0, 2 is 4:2:2, 3 is 4:4:4.
    const cw = layout === 3 ? width : (width + 1) >> 1;
    const ch = layout === 1 ? (height + 1) >> 1 : height;
    const dims = layout === 0 ? [[width, height]] : [[width, height], [cw, ch], [cw, ch]];
    // Read after the call: a grown heap replaces HEAPU8's buffer.
    const heap = M.HEAPU8;
    const planes = dims.map(([w, h], i) => {
      const src = M._av1_plane(i);
      const stride = Number(M._av1_stride(i));
      const row = w * sampleBytes;
      const out = new Uint8Array(row * h);
      for (let y = 0; y < h; y++) out.set(heap.subarray(src + y * stride, src + y * stride + row), y * row);
      return sampleBytes === 2 ? new Uint16Array(out.buffer) : out;
    });
    return { width, height, bits, layout, matrix: M._av1_matrix(), planes };
  }

  return { decode, close: () => { if (ptr) M._free(ptr); M._av1_close(); } };
}

/** An IVF file's frames, each one temporal unit. */
export function* ivfFrames(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0) !== 0x444b4946) throw new Error("not IVF");
  let at = view.getUint16(6, true);
  while (at + 12 <= buf.length) {
    const size = view.getUint32(at, true);
    yield buf.subarray(at + 12, at + 12 + size);
    at += 12 + size;
  }
}
