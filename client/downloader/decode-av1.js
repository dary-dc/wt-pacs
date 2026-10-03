/**
 * AV1 behind decoder.js's contract, G = 1: every frame is one temporal unit that decodes alone.
 * The build is lab/av1/dav1d-wasm; the seam is docs/av1/adr-unit.md §2.
 */
let M = null;
let ptr = 0;
let cap = 0;

export async function init(d) {
  // The glue is a classic script, as OpenJPH's is: decoder.js says why it is evaluated this way.
  const src = await (await fetch(d.glue)).text();
  const factory = new Function(`${src}\nreturn Dav1dModule;`).call(self);
  const opts = { locateFile: (f) => d.dir + "/" + f };
  if (!d.streaming) opts.wasmBinary = await (await fetch(d.wasm)).arrayBuffer();
  M = await factory(opts);
  const opened = M._av1_open(1);
  if (opened < 0) throw new Error(`dav1d_open: ${opened}`);
}

export function decodeFrame(bytes) {
  if (bytes.length > cap) {
    if (ptr) M._free(ptr);
    cap = bytes.length;
    ptr = M._malloc(cap);
  }
  M.HEAPU8.set(bytes, ptr);
  // Without its own sequence header and keyframe a unit has nothing to decode against, so a frame
  // of a group fails here instead of decoding against the previous frame's references.
  M._av1_flush();
  const r = M._av1_decode(ptr, bytes.length);
  if (r < 0) throw new Error(`undecodable: dav1d ${r}`);

  const width = M._av1_width();
  const height = M._av1_height();
  const bits = M._av1_bits();
  const layout = M._av1_layout();
  // Grey is 4:0:0; colour is lossless only as 4:4:4 with the identity matrix (0), planes G, B, R.
  const componentCount = layout === 0 ? 1 : 3;
  if (layout !== 0 && !(layout === 3 && M._av1_matrix() === 0)) {
    throw new Error(`undecodable: layout ${layout}, matrix ${M._av1_matrix()} is neither grey nor RGB`);
  }

  const wide = bits > 8;
  const sab = new SharedArrayBuffer(width * height * componentCount * (wide ? 2 : 1));
  const out = wide ? new Uint16Array(sab) : new Uint8Array(sab);
  const heap = wide ? M.HEAPU16 : M.HEAPU8;
  const shift = wide ? 1 : 0;
  let min = Infinity;
  let max = -Infinity;
  for (let c = 0; c < componentCount; c++) {
    // R, G, B out of planes G, B, R.
    const plane = componentCount === 1 ? 0 : (c + 2) % 3;
    const base = M._av1_plane(plane) >> shift;
    const stride = Number(M._av1_stride(plane)) >> shift;
    for (let y = 0; y < height; y++) {
      let s = base + y * stride;
      let o = y * width * componentCount + c;
      for (let x = 0; x < width; x++, s++, o += componentCount) {
        const v = heap[s];
        out[o] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  const info = { width, height, bitsPerSample: bits, componentCount, isSigned: false };
  // As decoder.js's unranged(): an 8-bit colour frame's window is its sample type's.
  const range = componentCount === 3 && !wide ? { min: 0, max: 255 } : { min, max };
  return { info, sab, byteCount: sab.byteLength, range };
}
