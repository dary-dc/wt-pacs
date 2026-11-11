// node client/viewer/pair-source.test.mjs — an exact series is accepted only when it is shown to be this series' source, read as this series is read.
import assert from "node:assert/strict";
import { checkPair } from "./pair.js";

const source = { frameCount: 3, width: 4, height: 2, bitsStored: 12, signed: false };
const lossy = { ...source, codec: "av1", lossy: { q: 8, g: 8, depth: 10, bitsStored: 12 }, exactSeries: "1.2.840.5" };
const exact = { ...source, digests: { algorithm: "xxh3-64", frames: ["a", "b", "c"] } };
const failures = [];
const claim = (what, fn) => {
  try {
    fn();
  } catch (e) {
    failures.push(`${what}: ${e.message}`);
  }
};

/**
 * Finding: `checkPair` compares `framesSha256` only when both series carry it, and no ingest on the demo tip writes
 * it, so an HTJ2K series of another source with the same frame count, size, depth and sign is accepted as exact and
 * its frames, matching their own digests, are labelled *Lossless* over this series' optimal quality.
 */
claim("a pair that names no shared source is refused", () => {
  assert.throws(() => checkPair(lossy, exact), /source/);
  assert.throws(() => checkPair({ ...lossy, framesSha256: "f00d" }, exact), /source/);
  assert.throws(() => checkPair(lossy, { ...exact, framesSha256: "f00d" }), /source/);
});

/**
 * Finding: the controller paints the exact frame through the optimal-quality series' metadata (photometric, rescale,
 * per-frame rescale), but `checkPair` compares none of them, so a frame labelled *Lossless* can be shown inverted or
 * at other modality values than its own series states.
 */
claim("an exact series read otherwise than this series is refused", () => {
  const named = { ...lossy, framesSha256: "f00d" };
  const same = { ...exact, framesSha256: "f00d" };
  for (const bad of [
    { photometric: "MONOCHROME1" },
    { rescale: { slope: 2, intercept: 0 } },
    { perFrame: { rescale: [{ slope: 1, intercept: -1024 }, { slope: 1, intercept: -1024 }, { slope: 1, intercept: -1024 }] } },
  ]) assert.throws(() => checkPair(named, { ...same, ...bad }), Error, JSON.stringify(bad));
});

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log("pair-source: ok");
