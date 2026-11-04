/**
 * Stage 2's table for the quality shapes from run.mjs's rows: A's ms a frame, the median over rounds of each round's
 * median; each arm over A, the median of round-paired ratios [range]; a sequence's second step (the whole layered
 * codestream, from scratch) as `.whole`; pictures exact over every round. layers/README.md, §Quality layers, measured
 *
 *   node lab/htj2k-progressive/layers/decode/summary.mjs ROWS.json [--json OUT]
 */
import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const SHAPES = ["oneset", ...[1, 2, 3, 4, 5, 6, 7].map((p) => `twosets${p}`)];
const ARMS = ["A2", ...SHAPES.flatMap((s) => [`${s}.l1`, `${s}.seq`, `${s}.whole`])];
const sets = [...new Set(rows.map((r) => r.set))];
const out = [];
const per = (r, arm) => (arm.endsWith(".whole") ? r.steps.map((s) => s[1]) : r.ms);
console.log(`Chromium ${[...new Set(rows.map((r) => r.version))].join(", ")}; rounds ${new Set(rows.map((r) => r.round)).size}`);
console.log(`| set | CPU | A ms | ${ARMS.join(" | ")} | exact |`);
console.log(`| --- | --: | --: | ${ARMS.map(() => "--:").join(" | ")} | --: |`);
for (const throttle of [...new Set(rows.map((r) => r.throttle))].sort()) {
  for (const set of sets) {
    const of = (arm) => {
      const src = arm.endsWith(".whole") ? arm.replace(".whole", ".seq") : arm;
      return new Map(rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === src).map((r) => [r.round, med(per(r, arm))]));
    };
    const a = of("A");
    const cells = ARMS.map((arm) => {
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
