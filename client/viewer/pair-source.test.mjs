// node client/viewer/pair-source.test.mjs — an exact series is accepted only when it is shown to be this series' source, read as this series is read.
import assert from "node:assert/strict";
import { checkPair, pairOf } from "./pair.js";

const source = { frameCount: 3, width: 4, height: 2, bitsStored: 12, signed: false };
const lossy = { ...source, codec: "av1", lossy: { q: 8, g: 8, depth: 10, bitsStored: 12 }, exactSeries: "1.2.840.5" };
const exact = { ...source, digests: { algorithm: "xxh3-64", frames: ["0123456789abcdef", "123456789abcdef0", "23456789abcdef01"] } };
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

/**
 * Finding: `pairOf`'s id rule `/^[\w.-]+$/` admits "." and "..", which the browser resolves to other paths:
 * "/series/./metadata" is "/series/metadata", this series' own metadata on `dev-server.py`. `checkPair` refuses
 * that one as AV1 today; the id should be refused by name before anything is fetched.
 */
claim("an exactSeries of dot segments is not a series id", () => {
  for (const id of [".", ".."]) assert.throws(() => pairOf({ ...lossy, exactSeries: id }), /exactSeries/, id);
});

/**
 * Finding: `checkPair` says it refuses an exact series "that could never show a frame as lossless", but it reads only
 * `digests.algorithm`: `frames` empty, short or not of 16 hex digits passes, the lossless button is offered, and every
 * press ends in *Lossless check failed*.
 */
claim("an exact series without a digest for every frame is refused", () => {
  const named = { ...lossy, framesSha256: "f00d" };
  const same = { ...exact, framesSha256: "f00d" };
  for (const frames of [[], ["a", "b"], [1, 2, 3], ["0123456789abcdef", "0123456789abcdef", ""]]) {
    assert.throws(() => checkPair(named, { ...same, digests: { algorithm: "xxh3-64", frames } }), /digest/, JSON.stringify(frames));
  }
});

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log("pair-source: ok");
