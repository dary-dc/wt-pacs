// A remapped plane back to the source frame: the map's outliers or the palette's high parts, then the
// source's offset taken off. remap.py writes both maps; lab/av1/bytes/remap/README.md.
export const MUTATE = { restore: false };

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function varint(raw, at) {
  let x = 0;
  for (let shift = 0; ; shift += 7) {
    const c = raw[at.i++];
    x += (c & 0x7f) * 2 ** shift;
    if (c < 0x80) return x;
  }
}

/** `restore(pixels, i, ms)` for one arm: `side` is remap.json, `maps[i]` frame i's map bytes. */
export function restorer({ side, signed, maps }) {
  const Out = signed ? Int16Array : Uint16Array;
  const off = side.source_offset;
  const lut = side.mode === "palette" ? paletteLut(side) : null;
  return async (pixels, i, ms) => {
    const t0 = performance.now();
    const plane = new Uint16Array(pixels);
    const out = new Out(plane.length);
    if (lut) {
      for (let j = 0; j < plane.length; j++) out[j] = lut[plane[j]];
    } else {
      const shift = side.low - off;
      for (let j = 0; j < plane.length; j++) out[j] = plane[j] + shift;
      const raw = await inflate(maps[i]);
      const view = new DataView(raw.buffer);
      const runs = view.getUint32(0, true);
      const at = { i: 4 };
      const spans = Array.from({ length: 2 * runs }, () => varint(raw, at));
      let v = at.i;
      for (let r = 0, j = 0; r < runs; r++) {
        j += spans[2 * r];
        const end = j + spans[2 * r + 1] - (MUTATE.restore && r === runs - 1 ? 1 : 0);
        for (; j < end; j++, v += 2) out[j] = view.getUint16(v, true) - off;
        if (MUTATE.restore && r === runs - 1) j++;
      }
    }
    return { ms: ms + performance.now() - t0, pixels: out.buffer };
  };
}

function paletteLut({ low_bits: b, highs, source_offset: off }) {
  const lut = new Int32Array(highs.length << b);
  for (let p = 0; p < lut.length; p++) lut[p] = ((highs[p >> b] << b) | (p & ((1 << b) - 1))) - off;
  if (MUTATE.restore) lut[lut.length - 1] ^= 1;
  return lut;
}
