/** An optimal-quality series coded as its depth cut: docs/av1/payload-format.md §Depth cut */

export const CUT_DEPTH = 10;

/** D − 10 for an optimal-quality series coded as its depth cut, else 0. */
export const cutShift = (meta) => (meta.lossy?.bitsStored === undefined ? 0 : meta.lossy.bitsStored - meta.lossy.depth);
