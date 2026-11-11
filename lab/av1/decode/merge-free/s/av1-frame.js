/**
 * S, the merge-free protocol's arm: the product's av1-frame.js with a split frame merged by a WASM SIMD kernel
 * (merge.c) out of the kernel's own memory, which av1-webcodecs.js copies each stream into.
 * lab/av1/decode/merge-free/README.md
 */

const kernel = await (async () => {
  const bytes = await (await fetch(new URL("./merge.wasm", import.meta.url))).arrayBuffer();
  const module = await WebAssembly.compile(bytes);
  const imports = {};
  for (const { module: m, name } of WebAssembly.Module.imports(module)) (imports[m] ??= {})[name] = () => 0;
  return (await WebAssembly.instantiate(module, imports)).exports;
})();

// Regions start above the kernel's own data and stack, inside its first MiB.
const BASE = 1 << 20;
let free = BASE;
const regions = {};
let copying = 0;
const idle = [];

/** `size` bytes of the kernel's memory for `name`, kept until a larger size is asked; grown only while no copy is pending. */
export async function region(name, size) {
  if (regions[name]?.size >= size) return regions[name];
  while (copying) await new Promise((r) => idle.push(r));
  return reserve(name, size);
}

function reserve(name, size) {
  if (regions[name]?.size >= size) return regions[name];
  const at = free;
  free += Math.ceil(size / 65536) * 65536;
  const pages = free / 65536 - kernel.memory.buffer.byteLength / 65536;
  if (pages > 0) kernel.memory.grow(pages);
  return (regions[name] = { at, size });
}

/** Around a copy into a region: the memory is not grown while one is pending, so its destination stays attached. */
export const copy = {
  begin: () => copying++,
  end() {
    if (--copying) return;
    for (const r of idle.splice(0)) r();
  },
  view: (at, size) => new Uint8Array(kernel.memory.buffer, at, size),
};

const refuse = (why) => {
  throw new Error(`undecodable: av1 payload: ${why}`);
};

/** Whether every sample of `planes` is `mid`: a grey stream's chroma when it is coded 4:2:0. */
export function neutral(planes, width, height, mid) {
  for (const { heap, offset, stride } of planes) {
    for (let y = 0; y < height; y++) {
      for (let s = offset + y * stride, x = 0; x < width; x++, s++) if (heap[s] !== mid) return false;
    }
  }
  return true;
}

/** The top picture checked against the payload's header and placed. */
export function begin(pic, payload) {
  const f = output(pic, payload);
  if (payload.rct) unrct(f, pic);
  else place(f, pic, payload.split, !payload.split);
  return f;
}

/** The contract's return, the low picture OR-ed in first when the frame is split. */
export function end(f, low) {
  if (low) place(f, lowChecked(f, low), 0, true);
  return result(f);
}

/** begin() and end() of a split frame in the kernel: each plane's `at` is its byte address in the kernel's memory. */
export function merge(pic, low, payload) {
  const f = output(pic, payload);
  const [t] = pic.planes;
  const [b] = lowChecked(f, low).planes;
  if (f.mask !== 0xffff) refuse(`a split frame of ${f.bits} bits, not over 8`);
  const n = pic.width * pic.height;
  const { at } = reserve("out", 2 * n);
  (pic.bits > 8 ? kernel.merge16 : kernel.merge8)(t.at, t.stride, b.at, b.stride, at, pic.width, pic.height, payload.split, f.offset);
  new Uint16Array(f.sab).set(new Uint16Array(kernel.memory.buffer, at, n));
  f.range.min = kernel.range_min();
  f.range.max = kernel.range_max();
  return result(f);
}

function output(pic, payload) {
  const components = pic.planes.length;
  if (pic.bits !== payload.depth) refuse(`top stream ${pic.bits}-bit, header says ${payload.depth}`);
  if (payload.rct && components !== 3) refuse(`top stream of ${components} planes under rct, not three`);
  const plainRgb = payload.bits === 8 && payload.depth === 8 && !payload.split && !payload.signed;
  if (!payload.rct && components === 3 && !plainRgb) refuse("three planes without rct");
  const { bits, signed } = payload;
  const wide = bits > 8;
  const sab = new SharedArrayBuffer(pic.width * pic.height * components * (wide ? 2 : 1));
  const out = wide ? (signed ? new Int16Array(sab) : new Uint16Array(sab)) : signed ? new Int8Array(sab) : new Uint8Array(sab);
  const mask = wide ? 0xffff : 0xff;
  return { pic, out, sab, components, bits, signed, mask, offset: payload.offset, range: { min: Infinity, max: -Infinity } };
}

function lowChecked(f, low) {
  if (low.bits !== 8) refuse(`low stream ${low.bits}-bit, not 8`);
  if (low.planes.length !== 1 || low.width !== f.pic.width || low.height !== f.pic.height) {
    refuse(`a low picture of ${low.width}x${low.height}x${low.planes.length} under ${f.pic.width}x${f.pic.height}`);
  }
  return low;
}

function result(f) {
  const { width, height } = f.pic;
  const info = { width, height, bitsPerSample: f.bits, componentCount: f.components, isSigned: f.signed };
  // As decoder.js's unranged(): an 8-bit colour frame's window is its sample type's.
  const range = f.components === 3 && f.bits === 8 && !f.signed ? { min: 0, max: 255 } : f.range;
  return { info, sab: f.sab, byteCount: f.sab.byteLength, range };
}

/** R, G, B out of planes G, B, R, shifted and OR-ed in; the last placement undoes the offset and takes the range. */
function place(f, pic, shift, last) {
  const { out, components, mask, offset, range } = f;
  const { width, height } = pic;
  for (let c = 0; c < components; c++) {
    const { heap, offset: base, stride } = pic.planes[components === 1 ? 0 : (c + 2) % 3];
    for (let y = 0; y < height; y++) {
      let s = base + y * stride;
      let o = y * width * components + c;
      if (!last) {
        for (let x = 0; x < width; x++, s++, o += components) out[o] = heap[s] << shift;
        continue;
      }
      for (let x = 0; x < width; x++, s++, o += components) {
        // A signed output holds the unsigned coded value wrapped until here; the mask unwraps it.
        const v = ((out[o] & mask) | heap[s]) - offset;
        out[o] = v;
        if (v < range.min) range.min = v;
        if (v > range.max) range.max = v;
      }
    }
  }
}

/** JPEG 2000's reversible colour transform undone: planes Y, B − G + 256, R − G + 256 to R, G, B. lab/av1/bytes/represented */
function unrct(f, pic) {
  const { out } = f;
  const { width, height, planes: [y, cb, cr] } = pic;
  for (let r = 0, o = 0; r < height; r++) {
    for (let x = 0, sy = y.offset + r * y.stride, sb = cb.offset + r * cb.stride, sr = cr.offset + r * cr.stride; x < width; x++, o += 3) {
      const b = cb.heap[sb + x] - 256;
      const red = cr.heap[sr + x] - 256;
      const g = y.heap[sy + x] - ((b + red) >> 2);
      out[o] = red + g;
      out[o + 1] = g;
      out[o + 2] = b + g;
    }
  }
}
