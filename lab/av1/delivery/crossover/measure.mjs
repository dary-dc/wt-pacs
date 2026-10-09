/**
 * Row CROSSMEASURE: docs/av1/crossover-protocol.md's cells through row TOTAL's run.mjs, one series at a time, its
 * engine × CPU groups in a Williams order, the series' order rotating by round. lab/av1/delivery/crossover/README.md §Measured
 *
 *   FIREFOX_PATH=... NODE_PATH=$(npm root -g) node lab/av1/delivery/crossover/measure.mjs --frames DIR --out rows.jsonl
 *     [--rounds 10] [--first-round 0] [--sets a,b] [--only c1,c4,f1,f4]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { order } from "../../../order.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const FIRST = Number(arg("--first-round", 0));
const FRAMES = arg("--frames");
const OUT = arg("--out");

/** The protocol's fixed links per series and group, each beside lte-good, the rule's cell. */
const CELLS = {
  dbts_a5: { c1: "r5000,r100000", c4: "r5000,r30000", f1: "r10000,r50000", f4: "r10000" },
  dbts_b2: { c1: "r5000,r100000", c4: "r5000,r30000", f1: "r10000,r50000", f4: "r10000" },
  dbts_b4: { c1: "r20000", c4: "r20000,r100000", f1: "r20000", f4: "r10000,r50000" },
  ffdms_c1: { c1: "r20000", c4: "r10000", f1: "r20000", f4: "r10000" },
  syn2ds_a3: { c1: "r5000,r30000", c4: "r10000", f1: "r20000", f4: "r10000" },
  syn2ds_b3: { c1: "r5000,r100000", c4: "r5000,r30000", f1: "r30000", f4: "r10000" },
};
const ENGINE = { c: "chromium", f: "firefox" };
const SETS = arg("--sets", Object.keys(CELLS).join(",")).split(",");
const GROUPS = arg("--only", "c1,c4,f1,f4").split(",");

/** Steal is the eighth field of /proc/stat's cpu line. */
const cpu = () => readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
async function stealPercent() {
  const a = cpu();
  await new Promise((r) => setTimeout(r, 10000));
  const d = cpu().map((v, i) => v - a[i]);
  return (100 * d[7]) / d.reduce((s, v) => s + v, 0);
}

for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (let s; (s = await stealPercent()) > 2; ) console.log(`round ${round}: steal ${s.toFixed(1)} %, waiting`);
  const sets = SETS.map((_, i) => SETS[(i + round) % SETS.length]);
  for (const set of sets) {
    for (const g of order(GROUPS, round)) {
      execFileSync("taskset", ["-c", "0-2", "node", "lab/av1/delivery/total-time/run.mjs", "--frames", FRAMES, "--out", OUT,
        "--rounds", "1", "--first-round", String(round), "--sets", set, "--variants", "htj2k,k2", "--engines", ENGINE[g[0]],
        "--throttles", g.slice(1), "--links", `${CELLS[set][g]},lte-good`], { stdio: "inherit" });
    }
  }
}
