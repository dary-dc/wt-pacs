/**
 * Cuts each frame of make_frames.py's sets at the smallest prefix that decodes to its level exactly, and writes the
 * `res` arm: entry i < F is frame i's prefix, entry F + i the rest of its codestream. The shipped OpenJPH package
 * decodes, clamped by level.js; the level's truth is OpenJPEG's, and OpenJPEG must decode the prefix to it as well. lab/av1/decode/resolution-level/README.md
 *
 *   node lab/av1/decode/resolution-level/prefix.mjs BUILD WORK [--mutate prefix|truth]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { instance } from "../../../decode-bench/decoder.mjs";
import { decodeLevel } from "./level.js";

const [BUILD, WORK] = process.argv.slice(2);
const MUTATE = process.argv.includes("--mutate") ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const M = (await instance()).module;

/** The decode at `level` (0 is the whole frame), or null where the decoder refuses the bytes. */
function decode(bytes, level) {
  const d = new M.HTJ2KDecoder();
  try {
    if (level) return decodeLevel(d, bytes, level).out.slice();
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

const matches = (bytes, level, want) => { const px = decode(bytes, level); return px !== null && sha256(px) === want; };

/** Binary search, sound only where a longer prefix never loses the level: the boundary is checked after. */
function smallest(bytes, level, want) {
  let lo = 1;
  let hi = bytes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches(bytes.subarray(0, mid), level, want)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function openjpeg(bytes, level) {
  const j2c = path.join(WORK, ".prefix.j2c");
  const out = path.join(WORK, ".prefix.rawl");
  writeFileSync(j2c, bytes);
  execFileSync(path.join(BUILD, "openjpeg-native/bin/opj_decompress"), ["-i", j2c, "-o", out, "-r", String(level), "-allow-partial", "-quiet"], { stdio: "ignore" });
  return sha256(readFileSync(out));
}

let failed = 0;
for (const name of readdirSync(WORK).filter((d) => existsSync(path.join(WORK, d, "arms.json")))) {
  const dir = path.join(WORK, name);
  const set = JSON.parse(readFileSync(path.join(dir, "arms.json"), "utf8"));
  const { frames: F, level } = set;
  const cuts = [];
  for (let i = 0; i < F; i++) {
    const n = String(i).padStart(3, "0");
    const cs = readFileSync(path.join(dir, `${n}.htj2k`));
    const truth = MUTATE === "truth" ? sha256(Buffer.from(set.reducedTruth[i])) : set.reducedTruth[i];
    const checks = {
      full: matches(cs, 0, set.truth[i]),
      level: matches(cs, level, truth),
    };
    let cut = smallest(cs, level, truth);
    if (MUTATE === "prefix") cut -= 1;
    checks.prefix = matches(cs.subarray(0, cut), level, truth);
    checks.short = !matches(cs.subarray(0, cut - 1), level, truth);
    checks.openjpeg = openjpeg(cs.subarray(0, cut), level) === truth;
    const bad = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    if (bad.length) { failed++; console.error(`${name} ${i}: not ${bad.join(", ")}`); }
    writeFileSync(path.join(dir, `${n}.res`), cs.subarray(0, cut));
    writeFileSync(path.join(dir, `${String(F + i).padStart(3, "0")}.res`), cs.subarray(cut));
    cuts.push({ prefix: cut, whole: cs.length });
  }
  set.arms.res = { codec: "htj2k", layers: 2, level, worker: "/lab/av1/decode/resolution-level/decoder.js", previewTruth: set.reducedTruth };
  set.prefix = cuts;
  set.bytes.prefix = cuts.reduce((s, c) => s + c.prefix, 0);
  writeFileSync(path.join(dir, "arms.json"), JSON.stringify(set, null, 1));
  const share = cuts.map((c) => (100 * c.prefix) / c.whole);
  console.log(`${name}: level ${level}, prefix ${Math.min(...share).toFixed(1)}–${Math.max(...share).toFixed(1)} % of the frame, ` +
    `${set.bytes.prefix} of ${set.bytes.htj2k} B`);
}
if (failed) { console.error(`${failed} frames failed a check`); process.exit(1); }
