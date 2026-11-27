// add.js's shown() and exact() through add.c's SIMD kernel: the inputs copied into its memory unless already there,
// the frame copied out into a fresh SharedArrayBuffer. README.md here §Lossy pixel work protocol, pre-registered

const PAGE = 65536;
const align = (n) => (n + 15) & ~15;

export async function simd(wasm) {
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const x = instance.exports;
  const base = align(x.__heap_base.value);
  let at = { p: base, r: base, o: base, end: base };

  /** The kernel memory laid out for a preview of `pBytes`, a residual of `rBytes` and an output of `oBytes`. */
  const layout = (pBytes, rBytes, oBytes) => {
    const p = base;
    const r = align(p + pBytes);
    const o = align(r + rBytes);
    const end = o + oBytes;
    const short = end - x.memory.buffer.byteLength;
    if (short > 0) x.memory.grow(Math.ceil(short / PAGE));
    at = { p, r, o, end };
    return at;
  };

  /** A view of kernel memory for copyTo to write a preview of `bytes` into, kept until the next call. */
  const target = (bytes) => new Uint8Array(x.memory.buffer, layout(bytes, 0, 0).p, bytes);

  /** The plane's samples in kernel memory, at its own offset and stride; copied there only if not already. */
  function place(plane, height) {
    const { heap, offset, stride } = plane;
    const bytes = (offset + stride * height) * 2;
    if (heap.buffer === x.memory.buffer && heap.byteOffset === at.p) return { bytes, offset };
    return { bytes, offset, copy: heap.subarray(0, offset + stride * height) };
  }

  function run(kernel, plane, residual, f) {
    const { width, height, shift, bias, signed } = f;
    if (signed || f.bits <= 8) throw new Error("the kernel writes unsigned samples over 8 bits only");
    const n = width * height;
    const pl = place(plane, height);
    const rBytes = residual ? n * residual.BYTES_PER_ELEMENT : 0;
    const { p, r, o } = layout(pl.bytes, rBytes, n * 2);
    const mem = x.memory.buffer;
    if (pl.copy) new Uint16Array(mem, p, pl.copy.length).set(pl.copy);
    if (residual) new residual.constructor(mem, r, n).set(residual.subarray(0, n));
    kernel(p + pl.offset * 2, plane.stride, r, o, width, height, shift, bias);
    const sab = new SharedArrayBuffer(n * 2);
    new Uint16Array(sab).set(new Uint16Array(x.memory.buffer, o, n));
    return { sab, range: { min: x.range_min(), max: x.range_max() } };
  }

  return {
    target,
    shown: (plane, f) => run(x.shown16, plane, null, f),
    exact: (plane, residual, f) => run(residual.BYTES_PER_ELEMENT === 1 ? x.exact8 : x.exact16, plane, residual, f),
  };
}
