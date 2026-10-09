/**
 * Each mutation of the derivation (client/decode/av1-payload.js's `sequence` and `codecString`) applied in turn,
 * av1.test.mjs and check.mjs run against it, the file restored: each must fail at least one. Queue row 67; README.md
 *
 *   node lab/av1/exact/codec-string/mutate.mjs DIR...      the directories check.mjs reads
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../../../../client/decode/av1-payload.js", import.meta.url);
const MUTATIONS = [
  ["decoder model flag read without timing info", "const decoderModel = timing && f(1);", "const decoderModel = f(1);"],
  ["tier read only above level 8", "const t = l > 7 ? f(1) : 0;", "const t = l > 8 ? f(1) : 0;"],
  ["the last operating point's level", "if (i === 0) [level, tier] = [l, t];", "[level, tier] = [l, t];"],
  ["profile 2 high bit depth as 10", "(f(1) ? 12 : 10)", "(f(1), 10)"],
  ["mono read in profile 1", "const mono = profile === 1 ? 0 : f(1);", "const mono = f(1);"],
  ["colour description absent as BT.709", ": [2, 2, 2];", ": [1, 1, 1];"],
  ["sRGB identity's range as limited", "[range, ss] = [1, [0, 0]]", "[range, ss] = [0, [0, 0]]"],
  ["the reduced header's level one bit short", "if (reduced) level = f(5);", "if (reduced) level = f(4);"],
  ["the profile one bit short", "const profile = f(3);", "const profile = f(2);"],
  ["frame id fields skipped", "if (!reduced && f(1)) f(4 + 3);", "if (!reduced) f(1);"],
  ["tier letters swapped", 's.tier ? "H" : "M"', 's.tier ? "M" : "H"'],
  ["level one digit", "${two(s.level)}${tier}", "${s.level}${tier}"],
  ["mono field left out", ".${s.mono}.${chroma}", ".${chroma}"],
];
const original = readFileSync(FILE, "utf8");
const run = (args) => spawnSync("node", args, { encoding: "utf8" }).status;
let survived = 0;
try {
  for (const [what, from, to] of MUTATIONS) {
    if (!original.includes(from)) throw new Error(`${what}: "${from}" not in av1-payload.js`);
    writeFileSync(FILE, original.replace(from, to));
    const test = run([new URL("../../../../client/decode/av1.test.mjs", import.meta.url).pathname]);
    const check = run([new URL("check.mjs", import.meta.url).pathname, ...process.argv.slice(2)]);
    if (!test && !check) survived++;
    console.log(`${!test && !check ? "SURVIVED" : "caught  "} ${what}: av1.test.mjs ${test ? "failed" : "passed"}, check.mjs ${check ? "failed" : "passed"}`);
  }
} finally {
  writeFileSync(FILE, original);
}
console.log(`${MUTATIONS.length - survived}/${MUTATIONS.length} mutations caught`);
process.exit(survived ? 1 : 0);
