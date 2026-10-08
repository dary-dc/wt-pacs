/**
 * The DICOM grayscale pipeline as a table indexed by stored code: rescale, VOI LUT function,
 * presentation. client/paint/README.md §The pipeline (PS3.3 2026d C.11.1, C.11.2.1.2, C.7.6.3.1.2).
 */

export const FUNCTIONS = ["LINEAR", "LINEAR_EXACT", "SIGMOID"];

/** A missing, zero or non-finite slope is 1, a non-finite intercept 0 (C.11.1). */
export function rescale({ slope, intercept } = {}) {
  return {
    slope: Number.isFinite(slope) && slope !== 0 ? slope : 1,
    intercept: Number.isFinite(intercept) ? intercept : 0,
  };
}

/** y in [0, 255] for a modality value x; C.11.2.1.2.1, C.11.2.1.3.2, C.11.2.1.3.1. */
export function voi(fn, center, width) {
  const c = center;
  const w = width;
  if (fn === "LINEAR") {
    if (!(w >= 1)) throw new Error(`LINEAR needs a window width ≥ 1, got ${w}`);
    const lo = c - 0.5 - (w - 1) / 2;
    const hi = c - 0.5 + (w - 1) / 2;
    return (x) => (x <= lo ? 0 : x > hi ? 255 : ((x - (c - 0.5)) / (w - 1) + 0.5) * 255);
  }
  if (fn === "LINEAR_EXACT") {
    if (!(w > 0)) throw new Error(`LINEAR_EXACT needs a window width > 0, got ${w}`);
    return (x) => (x <= c - w / 2 ? 0 : x > c + w / 2 ? 255 : ((x - c) / w + 0.5) * 255);
  }
  if (fn === "SIGMOID") {
    if (!(w > 0)) throw new Error(`SIGMOID needs a window width > 0, got ${w}`);
    return (x) => 255 / (1 + Math.exp((-4 * (x - c)) / w));
  }
  throw new Error(`VOI LUT function ${fn} is not one of ${FUNCTIONS.join(", ")}`);
}

/** The one rounding both renderers use: half up, then clamped to a byte. */
export const toCode = (y) => Math.min(255, Math.max(0, Math.floor(y + 0.5)));

export const PHOTOMETRIC = ["MONOCHROME1", "MONOCHROME2", "RGB"];

/** Where stored code `s` sits in a table: 256 entries up to 8 bits, else 65 536; signed codes offset by half. */
export function tableShape({ bits, signed }) {
  const entries = bits > 8 ? 65536 : 256;
  return { entries, offset: signed ? entries / 2 : 0 };
}

/**
 * The table a frame is painted through: entry `s + offset` is stored code `s`'s byte. Grey
 * applies rescale and VOI; RGB is shown as stored, so its table is the identity (inverted if asked).
 */
export function windowTable(frame, display) {
  const { photometric = "MONOCHROME2", invert = false } = display;
  if (!PHOTOMETRIC.includes(photometric)) throw new Error(`photometric interpretation ${photometric} is not painted`);
  if ((photometric === "RGB") !== (frame.components === 3)) {
    throw new Error(`${photometric} with ${frame.components} component(s) is not painted`);
  }
  const { entries, offset } = tableShape(frame);
  const flip = (photometric === "MONOCHROME1") !== Boolean(invert);
  const table = new Uint8Array(entries);
  if (photometric === "RGB") {
    for (let i = 0; i < entries; i++) table[i] = flip ? 255 - (i & 255) : i & 255;
    return table;
  }
  const { slope, intercept } = rescale(display.rescale);
  const { center, width, function: fn = "LINEAR" } = display.voi;
  const y = voi(fn, center, width);
  for (let i = 0; i < entries; i++) {
    const code = toCode(y((i - offset) * slope + intercept));
    table[i] = flip ? 255 - code : code;
  }
  return table;
}
