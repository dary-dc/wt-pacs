/**
 * FIT's series, prefix.mjs's layout (lab/av1/decode/resolution-level/): entry i < F is frame i's smallest prefix that
 * decodes at the fit level to fit_truth.py's picture, entry F + i the rest of its codestream. Each frame checked: whole
 * by its digest, its level from the whole and from the prefix equal to the truth, the prefix one byte short not.
 * docs/client/evidence/delivery-comparison.md A2.2, A2.8
 *
 *   node lab/delivery/fit.mjs DIR ID TRUTH [--frames N] [--pack target/release/pack-series]
 *     → DIR/ID-fit[-pN]/, DIR/ID-fit[-pN].metadata.json (the page's: F frames, `fit`), DIR/ID-fit[-pN].sbnd (2F entries)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { instance } from "../decode-bench/decoder.mjs";
import { decodeLevel } from "../av1/decode/resolution-level/level.js";
import { xxh3 } from "./predict.mjs";

const argv = process.argv.slice(2);
const [DIR, ID, TRUTH] = argv;
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const meta = JSON.parse(readFileSync(path.join(DIR, ID, "metadata.json"), "utf8"));
const { level, size } = JSON.parse(readFileSync(path.join(TRUTH, "level.json"), "utf8"));
if (!level) throw new Error(`${ID}: the fit is level 0, so FIT is the exact series`);
const F = Number(arg("--frames", meta.frameCount));
const hash = await xxh3();
const M = (await instance()).module;

/** The samples at `level` (0, the whole frame), or null where the decoder refuses the bytes. */
function decode(bytes, at) {
  const d = new M.HTJ2KDecoder();
  try {
    if (at) return new Uint8Array(decodeLevel(d, bytes, at).out).slice();
    d.getEncodedBuffer(bytes.length).set(bytes);
    d.readHeader();
    d.decode();
    return d.getDecodedBuffer().slice();
  } catch {
    return null;
  } finally {
    d.delete();
  }
}
const same = (a, b) => a !== null && a.length === b.length && a.every((x, k) => x === b[k]);

const name = `${ID}-fit${F < meta.frameCount ? `-p${F}` : ""}`;
const out = path.join(DIR, name);
mkdirSync(out, { recursive: true });
const fit = { level, size, frames: F, prefixes: [], rests: [], levelDigests: [] };
for (let i = 0; i < F; i++) {
  const n = String(i).padStart(3, "0");
  const cs = readFileSync(path.join(DIR, ID, `${n}.htj2k`));
  const truth = new Uint8Array(readFileSync(path.join(TRUTH, `${n}.rawl`)));
  if (hash(decode(cs, 0)) !== meta.digests.frames[i]) throw new Error(`${ID} ${i}: the whole frame is not its digest`);
  if (!same(decode(cs, level), truth)) throw new Error(`${ID} ${i}: level ${level} of the whole codestream is not ll.py's`);
  // Binary search, sound only where a longer prefix never loses the level: the boundary is checked after.
  let [lo, hi] = [1, cs.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (same(decode(cs.subarray(0, mid), level), truth)) hi = mid;
    else lo = mid + 1;
  }
  if (same(decode(cs.subarray(0, lo - 1), level), truth)) throw new Error(`${ID} ${i}: a prefix one byte short is still exact`);
  writeFileSync(path.join(out, `${n}.htj2k`), cs.subarray(0, lo));
  writeFileSync(path.join(out, `${String(F + i).padStart(3, "0")}.htj2k`), cs.subarray(lo));
  fit.prefixes.push(lo);
  fit.rests.push(cs.length - lo);
  fit.levelDigests.push(hash(truth));
}
const page = { ...meta, frameCount: F, digests: { ...meta.digests, frames: meta.digests.frames.slice(0, F) }, fit };
writeFileSync(path.join(DIR, `${name}.metadata.json`), JSON.stringify(page, null, 1));
writeFileSync(path.join(out, "metadata.json"), JSON.stringify({ ...page, frameCount: 2 * F }, null, 1));
execFileSync(arg("--pack", "target/release/pack-series"), ["--metadata", path.join(out, "metadata.json"), "--frames", out, "--output", path.join(DIR, `${name}.sbnd`)], { stdio: "ignore" });
const share = fit.prefixes.map((p, i) => p / (p + fit.rests[i]));
console.log(`${name}: level ${level} (${size.join("×")}), ${F} prefixes ${(100 * Math.min(...share)).toFixed(1)}–${(100 * Math.max(...share)).toFixed(1)} % of a frame`);
