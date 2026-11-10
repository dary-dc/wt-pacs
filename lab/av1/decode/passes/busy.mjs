/**
 * The host's load in each browser of a run: busy.sh's samples cut at run.mjs's "done" lines, as the share of every
 * CPU busy, the browser's mean and its busiest second. README.md here
 *
 *   node lab/av1/decode/passes/busy.mjs busy.log run.log
 */
import { readFileSync } from "node:fs";

const samples = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
const ends = readFileSync(process.argv[3], "utf8").split("\n")
  .map((l) => l.match(/^round (\d+) (\d+)x done (\S+)/)).filter(Boolean)
  .map(([, round, t, at]) => ({ round: Number(round), t: Number(t), end: Date.parse(at) / 1000 }));

const by = new Map();
for (let i = 1; i < ends.length; i++) {
  const { t } = ends[i];
  const inside = samples.filter(([s]) => s > ends[i - 1].end && s <= ends[i].end);
  const share = inside.slice(1).map(([, b, n], j) => (b - inside[j][1]) / (n - inside[j][2]));
  if (!share.length) continue;
  const mean = share.reduce((a, b) => a + b, 0) / share.length;
  (by.get(t) ?? by.set(t, []).get(t)).push({ mean, peak: Math.max(...share) });
}
const pct = (x) => `${(100 * x).toFixed(0)} %`;
for (const [t, v] of [...by].sort(([a], [b]) => a - b)) {
  const means = v.map((x) => x.mean).sort((a, b) => a - b);
  const peaks = v.map((x) => x.peak);
  console.log(`${t}×: ${v.length} browsers; mean busy ${pct(means[0])}–${pct(means.at(-1))} (median ${pct(means[means.length >> 1])}); busiest second ${pct(Math.max(...peaks))}; browsers with a second at ≥ 95 %: ${v.filter((x) => x.peak >= 0.95).length}`);
}
