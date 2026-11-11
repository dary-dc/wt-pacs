/** What the page writes of a shown frame: its mark, the overlay's line and the status line's error. client/README.md §The page */

/** The mark beside a frame `s` as the controller's `shown` event gives it, `{ className, text }`; a labelled frame unchecked has none. */
export const markOf = (s) =>
  s.exact === true || (s.quality && s.exact !== false) ? { className: "", text: "" }
  : s.exact === false ? { className: "inexact", text: `NOT EXACT — ${s.reason ?? ""}` }
  : { className: "unchecked", text: "unchecked" };

/** The overlay's line: the route, the wire bytes and the decode time of `about`, then the optimal-quality series `lossy`'s parameters. */
export function overlayText(about, quality, lossy) {
  const kb = about.wireBytes === undefined ? "?" : (about.wireBytes / 1024).toFixed(1);
  const ms = about.decodeMs === undefined ? "?" : about.decodeMs.toFixed(1);
  const cut = lossy?.bitsStored ? ` depth cut of ${lossy.bitsStored}` : "";
  const series = lossy ? ` · Q ${lossy.q} · G ${lossy.g} · ${lossy.depth}-bit${cut}` : "";
  const route = about.refusal ? `${about.path} after WebCodecs refused: ${about.refusal}` : about.path ?? "?";
  return `${route} · ${kb} KB · decode ${ms} ms${series}`;
}

/** The error the status line ends with, of `errors` as the page collected them, while `shown` is painted. */
export const lastError = (errors, shown) => errors.at(-1);
