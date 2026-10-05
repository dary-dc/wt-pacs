/**
 * An AV1 item's decoded pictures as decoder.js's contract, whichever decoder made them. A picture is
 * `{ width, height, bits, planes: [{ heap, offset, stride }] }` in samples: one plane for grey, the
 * coded planes for colour. The item's split, colour transform and offset are undone here.
 * docs/av1/item-format.md
 */

const refuse = (why) => {
  throw new Error(`undecodable: av1 item: ${why}`);
};

/** The top picture checked against the item's header and placed. */
export function begin(pic, item) {
  const components = pic.planes.length;
  if (pic.bits !== item.depth) refuse(`top stream ${pic.bits}-bit, header says ${item.depth}`);
  if (item.rct && components !== 3) refuse(`top stream of ${components} planes under rct, not three`);
  const plainRgb = item.bits === 8 && item.depth === 8 && !item.split && !item.signed;
  if (!item.rct && components === 3 && !plainRgb) refuse("three planes without rct");
  const { bits, signed } = item;
  const wide = bits > 8;
  const sab = new SharedArrayBuffer(pic.width * pic.height * components * (wide ? 2 : 1));
  const out = wide ? (signed ? new Int16Array(sab) : new Uint16Array(sab)) : signed ? new Int8Array(sab) : new Uint8Array(sab);
  const mask = 2 ** (item.depth + item.split) - 1;
  const f = { pic, out, sab, components, bits, signed, mask, offset: item.offset, range: { min: Infinity, max: -Infinity } };
  if (item.rct) unrct(f, pic);
  else place(f, pic, item.split, !item.split);
  return f;
}

/** The contract's return, the low picture OR-ed in first when the frame is split. */
export function end(f, low) {
  if (low) {
    if (low.bits !== 8) refuse(`low stream ${low.bits}-bit, not 8`);
    if (low.planes.length !== 1 || low.width !== f.pic.width || low.height !== f.pic.height) {
      refuse(`a low picture of ${low.width}x${low.height}x${low.planes.length} under ${f.pic.width}x${f.pic.height}`);
    }
    place(f, low, 0, true);
  }
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

/** JPEG 2000's reversible colour transform undone: planes Y, B − G + 256, R − G + 256 to R, G, B. lab/av1/llsize */
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
