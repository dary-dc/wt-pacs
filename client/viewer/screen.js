/** What the page writes of a shown frame: its mark, the overlay's line and the status line's error. client/README.md §The page */

/** The mark beside a frame `s` as the controller's `shown` event gives it, `{ className, text }`; a labelled frame unchecked has none. */
export const markOf = (s) =>
  s.exact === true || (s.quality && s.exact !== false) ? { className: "", text: "" }
  : s.exact === false ? { className: "inexact", text: `NOT EXACT — ${s.reason ?? ""}` }
  : { className: "unchecked", text: "unchecked" };

/** The overlay's line: the route, the wire bytes and the decode time of `about`, then, on its own frames, the optimal-quality series `lossy`'s parameters. */
export function overlayText(about, quality, lossy) {
  const kb = about.wireBytes === undefined ? "?" : (about.wireBytes / 1024).toFixed(1);
  const ms = about.decodeMs === undefined ? "?" : about.decodeMs.toFixed(1);
  const cut = lossy?.bitsStored ? ` depth cut of ${lossy.bitsStored}` : "";
  const series = lossy && quality !== "lossless" ? ` · Q ${lossy.q} · G ${lossy.g} · ${lossy.depth}-bit${cut}` : "";
  const route = about.refusal ? `${about.path} after WebCodecs refused: ${about.refusal}` : about.path ?? "?";
  return `${route} · ${kb} KB · decode ${ms} ms${series}`;
}

/** The overlay's word on optimal-quality frame `shown.i`'s reconstruction check and coding error, under `slope`, the rescale's; empty without the check. docs/av1/payload-format.md §Integrity */
export function integrityText({ i, about, quality, window }, lossy, slope = 1) {
  if (!lossy?.reconstruction || quality === "lossless") return "";
  const check = about.asCoded ? `as coded${about.mismatchOn ? ` after ${about.mismatchOn} did not match` : ""}` : "unchecked";
  const e = lossy.codingError;
  if (!e) return check;
  const linear = /^LINEAR/.test(window?.function ?? "") && window.width > 1;
  const levels = linear ? ` (${((e.rms[i] * Math.abs(slope) * 255) / (window.width - 1)).toFixed(2)} levels at W ${window.width})` : "";
  const ratio = e.noiseBandRatio[i] === null ? "—" : e.noiseBandRatio[i].toFixed(2);
  return `${check} · error RMS ${e.rms[i].toFixed(2)}${levels} · e_N ÷ σ ${ratio} · max |Δ| ${e.max[i]}`;
}

/** The error the status line ends with, of `errors` as the page collected them, while `shown` is painted: not a lossless check its frame has since passed. */
export const lastError = (errors, shown) =>
  errors.findLast((e) => !(shown?.quality === "lossless" && e.startsWith(`frame ${shown.i}: lossless: `)));
