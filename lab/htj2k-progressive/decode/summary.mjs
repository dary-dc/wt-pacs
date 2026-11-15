/**
 * Stage 2's table from run.mjs's rows: ms a frame, the median over rounds of each round's median; each arm over A, the
 * median of round-paired ratios [range]; pictures exact over every round. lab/htj2k-progressive/README.md §Stage 2
 *
 *   node lab/htj2k-progressive/decode/summary.mjs ROWS.json [--json OUT]
 */
import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const ARMS = ["A", "A2", "p1", "p2", "p3", "p4", "p5", "f1", "f2", "f3", "f4", "f5", "s10", "s20", "s210", "s543210"];
const sets = [...new Set(rows.map((r) => r.set))];
const out = [];
console.log(`Chromium ${[...new Set(rows.map((r) => r.version))].join(", ")}; rounds ${new Set(rows.map((r) => r.round)).size}`);
console.log(`| set | CPU | A ms | ${ARMS.slice(1).join(" | ")} | exact |`);
console.log(`| --- | --: | --: | ${ARMS.slice(1).map(() => "--:").join(" | ")} | --: |`);
for (const throttle of [...new Set(rows.map((r) => r.throttle))].sort()) {
  for (const set of sets) {
    const of = (arm) => new Map(rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm).map((r) => [r.round, med(r.ms)]));
    const a = of("A");
    const cells = ARMS.slice(1).map((arm) => {
      const q = [...of(arm)].filter(([k]) => a.has(k)).map(([k, x]) => x / a.get(k));
      out.push({ set, throttle, arm, ms: med([...of(arm).values()]), vsA: med(q), min: Math.min(...q), max: Math.max(...q) });
      return `×${med(q).toFixed(2)} [${Math.min(...q).toFixed(2)}–${Math.max(...q).toFixed(2)}]`;
    });
    const all = rows.filter((r) => r.throttle === throttle && r.set === set);
    console.log(`| \`${set}\` | ${throttle}× | ${med([...a.values()]).toFixed(1)} | ${cells.join(" | ")} | ` +
      `${all.reduce((n, r) => n + r.exact, 0)}/${all.reduce((n, r) => n + r.pictures, 0)} |`);
  }
}
const i = process.argv.indexOf("--json");
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 1));
