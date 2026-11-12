/** An optimal-quality series and the HTJ2K series its exact frames come from: client/README.md §Optimal quality, exact on request */

export const CUT_DEPTH = 10;

/** D − 10 for an optimal-quality series coded as its depth cut, else 0: docs/av1/payload-format.md §Depth cut */
export const depthCut = (meta) => (meta.lossy?.bitsStored === undefined ? 0 : meta.lossy.bitsStored - meta.lossy.depth);

/** Where the exact series of `meta` is served, or null when `meta` is not an optimal-quality series; a malformed one is refused by name. */
export function pairOf(meta) {
  if (meta.lossy === undefined) return null;
  const { q, g, depth, bitsStored } = meta.lossy ?? {};
  if (meta.codec !== "av1") throw new Error(`refused: an optimal-quality series of codec ${JSON.stringify(meta.codec)} — av1`);
  if (![q, g, depth].every(Number.isInteger) || g < 1 || depth < 8) {
    throw new Error(`refused: lossy ${JSON.stringify(meta.lossy)} — whole q, g ≥ 1 and depth ≥ 8`);
  }
  if (bitsStored !== undefined && !(depth === CUT_DEPTH && bitsStored > CUT_DEPTH && bitsStored <= 16 && bitsStored === meta.bitsStored)) {
    throw new Error(`refused: a depth cut ${JSON.stringify(meta.lossy)} of bitsStored ${meta.bitsStored} — depth ${CUT_DEPTH} from the series' bitsStored, over ${CUT_DEPTH}`);
  }
  const id = meta.exactSeries;
  if (typeof id !== "string" || !/^[\w.-]+$/.test(id) || /^\.\.?$/.test(id)) throw new Error(`refused: exactSeries ${JSON.stringify(id)} — a series id`);
  return { id, metadata: `/series/${id}/metadata`, transport: `/wt/${id}/dev-transport.json` };
}

/** What the controller reads the exact frame through: the optimal-quality series' own. */
const READ_AS = ["photometric", "rescale", "perFrame"];
const wholeDigests = (frames, n) => Array.isArray(frames) && frames.length === n && frames.every((d) => /^[0-9a-f]{16}$/.test(d));

/** Refuses an exact series that is not this optimal-quality series' source, or that could never show a frame as lossless. */
export function checkPair(optimal, exact) {
  const readOtherwise = READ_AS.find((k) => JSON.stringify(exact[k]) !== JSON.stringify(optimal[k]));
  const why = (exact.codec ?? "htj2k") !== "htj2k" || exact.lossy !== undefined ? "is not an HTJ2K series"
    : exact.frameCount !== optimal.frameCount ? `has ${exact.frameCount} frames, not ${optimal.frameCount}`
    : exact.width !== optimal.width || exact.height !== optimal.height ? `is ${exact.width}×${exact.height}, not ${optimal.width}×${optimal.height}`
    : exact.bitsStored !== optimal.bitsStored ? `has bitsStored ${exact.bitsStored}, not ${optimal.bitsStored}`
    : exact.signed !== optimal.signed ? `is signed ${exact.signed}, not ${optimal.signed}`
    : readOtherwise ? `is read otherwise: its ${readOtherwise} differs`
    : !/^[0-9a-f]{16}$/.test(optimal.sourceFingerprint) || exact.sourceFingerprint !== optimal.sourceFingerprint ? `is not shown to be of this source: sourceFingerprint ${exact.sourceFingerprint}, not ${optimal.sourceFingerprint}`
    : exact.digests?.algorithm !== "xxh3-64" ? "has no xxh3-64 frame digests, so no frame of it could be shown as lossless"
    : !wholeDigests(exact.digests.frames, exact.frameCount) ? `has no 16-hex digest for each of its ${exact.frameCount} frames, so not every frame could be shown as lossless`
    : null;
  if (why) throw new Error(`refused: exact series ${JSON.stringify(optimal.exactSeries)} ${why}`);
}
