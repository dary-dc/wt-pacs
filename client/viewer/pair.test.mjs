// node client/viewer/pair.test.mjs — a lossy series paired with its exact series, and every malformed pair refused by name.
import assert from "node:assert/strict";
import { checkPair, pairOf } from "./pair.js";

const source = { frameCount: 3, width: 4, height: 2, bitsStored: 10, signed: false, framesSha256: "f00d" };
const lossy = { ...source, codec: "av1", lossy: { q: 30, g: 8, depth: 10 }, exactSeries: "1.2.840.5" };
const exact = { ...source, digests: { algorithm: "xxh3-64", frames: ["a", "b", "c"] } };

/** A series without `lossy` is not paired: today's path, untouched. */
assert.equal(pairOf({ frameCount: 3 }), null);
assert.equal(pairOf({ frameCount: 3, codec: "av1" }), null);

/** A lossy series names where its exact series' metadata and transport file are served, by its id. */
assert.deepEqual(pairOf(lossy), { id: "1.2.840.5", metadata: "/series/1.2.840.5/metadata", transport: "/wt/1.2.840.5/dev-transport.json" });

/** A lossy series that is not AV1, has a malformed `lossy`, or names no exact series by a plain id is refused. */
for (const [bad, why] of [
  [{ codec: "htj2k" }, /codec "htj2k"/],
  [{ lossy: { q: 30, g: 0, depth: 10 } }, /g ≥ 1/],
  [{ lossy: { q: 30, depth: 10 } }, /g ≥ 1/],
  [{ lossy: null }, /lossy null/],
  [{ exactSeries: undefined }, /exactSeries undefined/],
  [{ exactSeries: "../x" }, /exactSeries "\.\.\/x"/],
]) assert.throws(() => pairOf({ ...lossy, ...bad }), why);

/** The exact series must be HTJ2K, of the same source, and carry the digests a "Lossless" label needs. */
checkPair(lossy, exact);
checkPair({ ...lossy, framesSha256: undefined }, exact);
for (const [bad, why] of [
  [{ codec: "av1" }, /not an HTJ2K series/],
  [{ lossy: { q: 1, g: 1, depth: 8 } }, /not an HTJ2K series/],
  [{ frameCount: 4 }, /4 frames, not 3/],
  [{ width: 5 }, /is 5×2, not 4×2/],
  [{ height: 3 }, /is 4×3, not 4×2/],
  [{ bitsStored: 12 }, /bitsStored 12, not 10/],
  [{ signed: true }, /signed true, not false/],
  [{ framesSha256: "beef" }, /another source: framesSha256/],
  [{ digests: undefined }, /no xxh3-64 frame digests/],
  [{ digests: { algorithm: "sha256", frames: [] } }, /no xxh3-64 frame digests/],
]) assert.throws(() => checkPair(lossy, { ...exact, ...bad }), why);

console.log("pair: ok");
