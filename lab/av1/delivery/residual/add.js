// The lossy designs' pixel work after decode, each into a fresh SharedArrayBuffer with its range, as decoder.js
// hands a frame on. Grey and over 8 bits only. README.md here §Lossy pixel work protocol, pre-registered

const output = ({ width, height, bits, signed }) => {
  if (bits <= 8) throw new Error(`a ${bits}-bit frame: only over 8 bits`);
  const sab = new SharedArrayBuffer(width * height * 2);
  return { sab, out: signed ? new Int16Array(sab) : new Uint16Array(sab) };
};

/** The preview shown: `(p << shift) − bias` from a plane `{ heap, offset, stride }`, in one pass with its range. */
export function shown(plane, f) {
  const { sab, out } = output(f);
  const { heap, offset, stride } = plane;
  const { width, height, shift, bias } = f;
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0, s = offset + y * stride; x < width; x++, s++, o++) {
      const v = (heap[s] << shift) - bias;
      out[o] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { sab, range: { min, max } };
}

/** The exact frame: `(p << shift) + r − bias`, `residual` dense; `onePass` takes the range in the add, not after it. */
export function exact(plane, residual, f, onePass = false) {
  const { sab, out } = output(f);
  const { heap, offset, stride } = plane;
  const { width, height, shift, bias } = f;
  if (residual.length < width * height) throw new Error(`a residual of ${residual.length} samples under ${width}x${height}`);
  if (!onePass) {
    for (let y = 0, o = 0; y < height; y++) {
      for (let x = 0, s = offset + y * stride; x < width; x++, s++, o++) out[o] = (heap[s] << shift) + residual[o] - bias;
    }
    return { sab, range: rangeOf(out) };
  }
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0, s = offset + y * stride; x < width; x++, s++, o++) {
      // The range is of v before it is stored: the same as the stored range when the frame matches its digest.
      const v = (heap[s] << shift) + residual[o] - bias;
      out[o] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { sab, range: { min, max } };
}

/** The read-only range pass, client/decode/htj2k.js `finish()` without its sign extension. */
function rangeOf(view) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < view.length; i++) {
    const v = view[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}
