// node client/viewer/pair.test.mjs — an optimal-quality series paired with its exact series, and every malformed pair refused by name.
import assert from "node:assert/strict";
import { checkPair, depthCut, pairOf } from "./pair.js";

const source = { frameCount: 3, width: 4, height: 2, bitsStored: 10, signed: false, framesSha256: "f00d" };
const lossy = { ...source, codec: "av1", lossy: { q: 30, g: 8, depth: 10 }, exactSeries: "1.2.840.5" };
const exact = { ...source, digests: { algorithm: "xxh3-64", frames: ["0123456789abcdef", "123456789abcdef0", "23456789abcdef01"] } };

/** A series without `lossy` is not paired: today's path, untouched. */
assert.equal(pairOf({ frameCount: 3 }), null);
assert.equal(pairOf({ frameCount: 3, codec: "av1" }), null);

/** An optimal-quality series names where its exact series' metadata and transport file are served, by its id. */
assert.deepEqual(pairOf(lossy), { id: "1.2.840.5", metadata: "/series/1.2.840.5/metadata", transport: "/wt/1.2.840.5/dev-transport.json" });

/** An optimal-quality series that is not AV1, has a malformed `lossy`, or names no exact series by a plain id is refused. */
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
assert.throws(() => checkPair({ ...lossy, framesSha256: undefined }, exact), /not shown to be of this source/);
for (const [bad, why] of [
  [{ codec: "av1" }, /not an HTJ2K series/],
  [{ lossy: { q: 1, g: 1, depth: 8 } }, /not an HTJ2K series/],
  [{ frameCount: 4 }, /4 frames, not 3/],
  [{ width: 5 }, /is 5×2, not 4×2/],
  [{ height: 3 }, /is 4×3, not 4×2/],
  [{ bitsStored: 12 }, /bitsStored 12, not 10/],
  [{ signed: true }, /signed true, not false/],
  [{ framesSha256: "beef" }, /this source: framesSha256 beef, not f00d/],
  [{ framesSha256: undefined }, /this source: framesSha256 undefined/],
  [{ digests: undefined }, /no xxh3-64 frame digests/],
  [{ digests: { algorithm: "sha256", frames: [] } }, /no xxh3-64 frame digests/],
]) assert.throws(() => checkPair(lossy, { ...exact, ...bad }), why);

/** A depth cut is 10-bit codes of the series' own bitsStored, over 10: its shift is D − 10, and a lossy form uncut is 0. */
const cut = { ...lossy, bitsStored: 12, lossy: { q: 8, g: 16, depth: 10, bitsStored: 12 } };
assert.equal(pairOf(cut).id, "1.2.840.5");
assert.equal(depthCut(cut), 2);
assert.equal(depthCut({ ...cut, bitsStored: 16, lossy: { ...cut.lossy, bitsStored: 16 } }), 6);
assert.equal(depthCut(lossy), 0);
assert.equal(depthCut({ frameCount: 3 }), 0);

/** A D ≤ 10 series is never cut, and a cut not to 10 bits or not of the series' bitsStored is refused. */
for (const [bad, why] of [
  [{ bitsStored: 10, lossy: { ...cut.lossy, bitsStored: 10 } }, /over 10/],
  [{ bitsStored: 9, lossy: { ...cut.lossy, bitsStored: 9 } }, /over 10/],
  [{ lossy: { ...cut.lossy, depth: 12 } }, /depth 10/],
  [{ lossy: { ...cut.lossy, bitsStored: 14 } }, /bitsStored 12/],
  [{ bitsStored: 17, lossy: { ...cut.lossy, bitsStored: 17 } }, /depth cut/],
]) assert.throws(() => pairOf({ ...cut, ...bad }), why);

console.log("pair: ok");
