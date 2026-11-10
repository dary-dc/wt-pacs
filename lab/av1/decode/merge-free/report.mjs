/**
 * The merge-free protocol's reading of run.mjs's rows: ms a frame per arm and cell, every arm ÷ W and ÷ W2 as the
 * median of round-paired ratios with a distribution-free 95 % interval, and the decision rule applied. README.md here
 *
 *   node lab/av1/decode/merge-free/report.mjs rows.json > report.md
 */
import { readFileSync } from "node:fs";
import { effect, median } from "../passes/report.mjs";

const SMALL = "mr_ispy1";
const ARMS = ["W", "W′", "W2", "R", "S"];

/** cell ("throttle|set") → arm → round → the median of its frames' ms. */
export function rounds(rows) {
  const cells = new Map();
  for (const r of rows) {
    const key = `${r.throttle}|${r.set}`;
    if (!cells.has(key)) cells.set(key, {});
    (cells.get(key)[r.arm] ??= new Map()).set(r.round, median(r.frames.map((f) => f.ms)));
  }
  return new Map([...cells].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
}

/** arm ÷ ref in one cell: each round's log ratio, paired in that round's browser. */
export function ratio(c, arm, ref) {
  return effect([...c[arm].keys()].filter((r) => c[ref]?.has(r)).map((r) => Math.log(c[arm].get(r) / c[ref].get(r))));
}

const contains1 = (e) => e.lo <= 1 && e.hi >= 1;

export function decide(cells) {
  const lines = [];
  for (const [key, c] of cells) {
    const [t, set] = key.split("|");
    const aa = ratio(c, "W′", "W");
    const r = ratio(c, "R", "W2");
    const s = ratio(c, "S", "W2");
    const small = set === SMALL;
    const rWhy = small
      ? [r.hi > 1.02 && `upper end ${r.hi.toFixed(3)} > 1.02`]
      : [r.hi >= 1 && `upper end ${r.hi.toFixed(3)} ≥ 1.00`, r.ratio > 0.97 && `median ${r.ratio.toFixed(3)} > 0.97`];
    const sWhy = small ? [] : [s.hi >= 0.9 && `upper end ${s.hi.toFixed(3)} ≥ 0.90`];
    lines.push({ t: Number(t), set, aa, aaMiss: !contains1(aa), r, rWhy: rWhy.filter(Boolean), s, sWhy: sWhy.filter(Boolean) });
  }
  const aaMisses = lines.filter((l) => l.aaMiss).length;
  return { lines, aaMisses, aaVoid: aaMisses >= 2, rDefault: lines.every((l) => !l.rWhy.length), sProposed: lines.every((l) => !l.sWhy.length) };
}

const f3 = (x) => x.toFixed(3);
const show = (e) => `${f3(e.ratio)} [${f3(e.lo)}–${f3(e.hi)}]`;
const range = (v) => `${median(v).toFixed(1)} [${Math.min(...v).toFixed(1)}–${Math.max(...v).toFixed(1)}]`;

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const frames = rows.reduce((a, r) => a + r.n, 0);
  const exact = rows.reduce((a, r) => a + r.exact, 0);
  const errors = rows.filter((r) => r.error);
  const browsers = new Set(rows.map((r) => `${r.round}:${r.throttle}`)).size;
  const list = (k) => [...new Set(rows.map((r) => r[k]))].join(", ");
  console.log(`Chromium ${list("chromium")}; WebGL2 renderer ${list("renderer")}; ${browsers} browsers; ${rows.length} runs; **${exact} of ${frames} frames exact**${errors.length ? `; ${errors.length} runs failed` : ""}.\n`);
  const off = rows.flatMap((r) => r.frames).filter((f) => f.mismatchOn || f.path !== "av1-webcodecs").length;
  console.log(`Frames off WebCodecs or rescued by the fallback: ${off}.\n`);
  const cells = rounds(rows);
  console.log("**ms a frame**, the page's post → the consumer port's receipt (the median over rounds of each round's median of 16 frames [range]):\n");
  console.log(`| throttle | set | rounds | ${ARMS.join(" | ")} |\n| --- | --- | --: |${" --: |".repeat(ARMS.length)}`);
  for (const [key, c] of cells) {
    const [t, set] = key.split("|");
    console.log(`| ${t}× | \`${set}\` | ${c.W.size} | ${ARMS.map((a) => range([...c[a].values()])).join(" | ")} |`);
  }
  console.log("\n**Each arm ÷ W and ÷ W2** (round-paired: the median [95 % interval]):\n");
  console.log("| throttle | set | W′ ÷ W | W2 ÷ W | R ÷ W | S ÷ W | R ÷ W2 | S ÷ W2 |\n| --- | --- | --: | --: | --: | --: | --: | --: |");
  for (const [key, c] of cells) {
    const [t, set] = key.split("|");
    const cols = [["W′", "W"], ["W2", "W"], ["R", "W"], ["S", "W"], ["R", "W2"], ["S", "W2"]].map(([a, b]) => show(ratio(c, a, b)));
    console.log(`| ${t}× | \`${set}\` | ${cols.join(" | ")} |`);
  }
  const d = decide(cells);
  console.log("\n**The rule**:\n");
  console.log("| throttle | set | A/A contains 1 | R ÷ W2 | R's condition | met | S ÷ W2 | S's condition | met |\n| --- | --- | --- | --: | --- | --- | --: | --- | --- |");
  for (const l of d.lines) {
    const small = l.set === SMALL;
    console.log(`| ${l.t}× | \`${l.set}\` | ${l.aaMiss ? "**miss**" : "yes"} | ${show(l.r)} | ${small ? "upper ≤ 1.02" : "upper < 1.00, median ≤ 0.97"} | ${l.rWhy.length ? `**no**: ${l.rWhy.join(", ")}` : "yes"} | ${show(l.s)} | ${small ? "—" : "upper < 0.90"} | ${small ? "—" : l.sWhy.length ? `**no**: ${l.sWhy.join(", ")}` : "yes"} |`);
  }
  const allExact = exact === frames && !errors.length;
  const verdict = !allExact ? "void: not every frame exact"
    : d.aaVoid ? `void: the A/A missed in ${d.aaMisses} cells`
    : `${d.rDefault ? "R becomes the default with `onePass`" : "R does not become the default"}; ${d.sProposed ? "S is proposed for building" : "S is not proposed for building"}; G was not run`;
  console.log(`\nA/A misses: ${d.aaMisses} of ${d.lines.length} cells (void at 2). **Verdict: ${verdict}.**`);
}
