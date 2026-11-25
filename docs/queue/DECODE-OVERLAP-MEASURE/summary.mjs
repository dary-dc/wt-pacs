/**
 * rows.jsonl as one table: per (set, throttle, cell), each arm's median ms over rounds, the A/A ratio first, then the
 * branch over the tip with the range of its per-round ratios.  node summary.mjs [rows.jsonl]
 */
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2] ?? new URL("rows.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
const cells = [...new Set(rows.map((r) => `${r.set}|${r.throttle}|${r.cell}`))];
const bad = rows.filter((r) => !r.sameSamples || r.failures.length || r.routes.some((x) => x !== "av1-webcodecs"));
console.log(`${rows.length} rows, rounds ${Math.min(...rows.map((r) => r.round))}-${Math.max(...rows.map((r) => r.round))}; ${bad.length} with a differing sample, a failure or another route`);
console.log("| series | × | cell | n | tip ms | tip-aa / tip | branch ms | branch / tip | per round |");
console.log("| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |");
for (const c of cells) {
  const [set, throttle, cell] = c.split("|");
  const of = (arm) => rows.filter((r) => `${r.set}|${r.throttle}|${r.cell}` === c && r.arm === arm);
  const byRound = (arm) => Object.fromEntries(of(arm).map((r) => [r.round, r.ms]));
  const [tip, aa, br] = ["tip", "tip-aa", "branch"].map((a) => median(of(a).map((r) => r.ms)));
  const t = byRound("tip"), b = byRound("branch");
  const ratios = Object.keys(t).filter((k) => b[k]).map((k) => b[k] / t[k]);
  console.log(`| ${set} | ${throttle} | ${cell} | ${ratios.length} | ${tip.toFixed(0)} | ${(aa / tip).toFixed(3)} | ${br.toFixed(0)} | ${(br / tip).toFixed(3)} | ${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)} |`);
}
