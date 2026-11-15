// The integer steps every PROFILEDECODE arm shares: the split's merge, the depth back-conversion, the residual's add.
// Samples out are the stored values, the layout the fetch checksum covers (lab/av1/fetch_data.py).

/** Top and low stream of a split frame, as av1-frame.js places them: (top << split | low) − offset. */
export function merge(top, low, split, offset) {
  const out = new Uint16Array(top.length);
  if (!low) for (let k = 0; k < top.length; k++) out[k] = top[k] - offset;
  else for (let k = 0; k < top.length; k++) out[k] = ((top[k] << split) | low[k]) - offset;
  return out;
}

/** A lossy frame at the source's depth: the 10-bit top shifted back (p << shift); other forms as decoded. */
export function back(lossy, shift) {
  const out = new Uint16Array(lossy.length);
  for (let k = 0; k < lossy.length; k++) out[k] = lossy[k] << shift;
  return out;
}

/** The exact frame: the lossy frame back at depth, plus its residual, less the residual's and the series' offsets. */
export function add(lossy, residual, shift, offset) {
  const out = new Uint16Array(lossy.length);
  for (let k = 0; k < lossy.length; k++) out[k] = (lossy[k] << shift) + residual[k] - offset;
  return out;
}
