/** The spike's series, shared by its maker, its page and its runner. */
export const W = 128, H = 96, SLICES = 24, SPACING = [0.5, 0.5];
/** The marker column: one bright column, so the lag measurement can find the image on a screenshot. */
export const MARK = 64;
/** A ramp in i, j and the slice, so a one-pixel shift or a wrong slice moves the windowed code past the checks' tolerance. */
export const sample = (i, j, k) => (i === MARK ? 60000 : 2000 + 20 * i + 10 * j + 1000 * k);
