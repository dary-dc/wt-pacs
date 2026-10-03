/**
 * An AV1 frame's decoded pictures as decoder.js's contract, whichever decoder made them. A picture is
 * `{ width, height, bits, planes: [{ heap, offset, stride }] }` in samples: one plane for grey, G, B, R
 * for colour. A series' `split` and `offset` are undone here. docs/av1/adr-unit.md §2
 */

/** A split frame is `[u32le top length][top unit][low unit]`. */
export function units(bytes) {
  const n = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) : -1;
  if (n < 1 || 4 + n >= bytes.length) throw new Error(`undecodable: not a split frame (${bytes.length} bytes)`);
  return [bytes.subarray(4, 4 + n), bytes.subarray(4 + n)];
}

export function begin(pic, d) {
  const components = pic.planes.length;
  const split = d.split ?? 0;
  const bits = pic.bits + split;
  const signed = d.offset !== undefined;
  if (bits > 16) throw new Error(`undecodable: ${bits} bits`);
  const wide = bits > 8;
  const sab = new SharedArrayBuffer(pic.width * pic.height * components * (wide ? 2 : 1));
  const out = wide ? (signed ? new Int16Array(sab) : new Uint16Array(sab)) : signed ? new Int8Array(sab) : new Uint8Array(sab);
  const f = { pic, out, sab, components, bits, signed, mask: 2 ** bits - 1, offset: d.offset ?? 0, range: { min: Infinity, max: -Infinity } };
  place(f, pic, split, !split);
  return f;
}

/** The contract's return, the low picture OR-ed in first when the frame is split. */
export function end(f, low) {
  if (low) {
    if (low.planes.length !== 1 || low.width !== f.pic.width || low.height !== f.pic.height) {
      throw new Error(`undecodable: a low picture of ${low.width}x${low.height}x${low.planes.length} under ${f.pic.width}x${f.pic.height}`);
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
