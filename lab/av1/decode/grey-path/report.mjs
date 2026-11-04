/**
 * The grey path protocol's reading of run.mjs's rows: ms a frame per arm and cell, M (W2 ÷ W), R (R ÷ W2) and the A/A
 * (W′ ÷ W) as the median of round-paired ratios with passes/report.mjs's 95 % interval, each read as a speed-up, a
 * cost or not resolved. README.md here
 *
 *   node lab/av1/decode/grey-path/report.mjs rows.json > report.md
 */
import { readFileSync } from "node:fs";
import { effect, median } from "../passes/report.mjs";

/** The levers: name → [arm, reference]. */
export const LEVERS = { "A/A": ["W′", "W"], M: ["W2", "W"], R: ["R", "W2"] };

/** cell ("throttle|set") → arm → round → the median of its frames' decodeStart→decodeEnd, ms. */
export function rounds(rows) {
  const cells = new Map();
  for (const r of rows) {
    const key = `${r.throttle}|${r.set}`;
    if (!cells.has(key)) cells.set(key, {});
    (cells.get(key)[r.arm] ??= new Map()).set(r.round, median(r.frames.map((f) => f.decode)));
  }
  return cells;
}

function paired(c, arm, ref) {
  return [...c[arm].keys()].filter((r) => c[ref].has(r)).map((r) => Math.log(c[arm].get(r) / c[ref].get(r)));
}

/** A speed-up when the interval lies entirely below 1, a cost when entirely above, not resolved otherwise. */
export const reading = (e) => (e.hi < 1 ? "speed-up" : e.lo > 1 ? "cost" : "not resolved");

export function read(cells, allExact) {
  const lines = [...cells].map(([key, c]) => {
    const [t, set] = key.split("|");
    const e = Object.fromEntries(Object.entries(LEVERS).map(([k, [a, ref]]) => [k, effect(paired(c, a, ref))]));
    return { t: Number(t), set, ...e, aaMiss: !(e["A/A"].lo <= 1 && e["A/A"].hi >= 1) };
  });
  const aaMisses = lines.filter((l) => l.aaMiss).length;
  const mCosts = lines.filter((l) => reading(l.M) === "cost").map((l) => `${l.set} at ${l.t}×`);
  const verdict = !allExact ? "void: not every frame exact" : aaMisses >= 2 ? `void: the A/A missed in ${aaMisses} cells` : "read";
  return { lines, aaMisses, mCosts, verdict };
}

const f3 = (x) => x.toFixed(3);
const range = (v) => `${median(v).toFixed(1)} [${Math.min(...v).toFixed(1)}–${Math.max(...v).toFixed(1)}]`;
const ARMS = ["W", "W′", "W2", "R"];

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const frames = rows.reduce((a, r) => a + r.n, 0);
  const exact = rows.reduce((a, r) => a + r.exact, 0);
  const errors = rows.filter((r) => r.error);
  const browsers = new Set(rows.map((r) => `${r.round}:${r.throttle}`)).size;
  console.log(`Chromium ${[...new Set(rows.map((r) => r.chromium))].join(", ")}; ${browsers} browsers; ${rows.length} arm runs; **${exact} of ${frames} frames exact**${errors.length ? `; ${errors.length} runs failed` : ""}.\n`);
  const off = rows.flatMap((r) => r.frames).filter((f) => f.mismatchOn || f.path !== "av1-webcodecs").length;
  console.log(`Frames off WebCodecs or rescued by the fallback: ${off}. Warm-up frames exact: ${rows.filter((r) => r.warm?.exact).length} of ${rows.length}.\n`);
  const cells = new Map([...rounds(rows)].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  console.log("**ms a frame**, `decodeStart`→`decodeEnd` (the median over rounds of each round's median of 16 [range of round medians]):\n");
  console.log(`| throttle | set | rounds | ${ARMS.join(" | ")} |\n| --- | --- | --: | ${ARMS.map(() => "--:").join(" | ")} |`);
  for (const [key, c] of cells) {
    const [t, set] = key.split("|");
    console.log(`| ${t}× | \`${set}\` | ${c.W.size} | ${ARMS.map((a) => range([...c[a].values()])).join(" | ")} |`);
  }
  console.log("\n**Post → consumer-port receipt less `decodeStart`→`decodeEnd`** (a check, not decided on), ms a frame, median [range] over frames:\n");
  console.log(`| throttle | set | ${ARMS.join(" | ")} |\n| --- | --- | ${ARMS.map(() => "--:").join(" | ")} |`);
  for (const [key] of cells) {
    const [t, set] = key.split("|");
    const of = (a) => rows.filter((r) => `${r.throttle}|${r.set}` === key && r.arm === a).flatMap((r) => r.frames.map((f) => f.ms - f.decode));
    console.log(`| ${t}× | \`${set}\` | ${ARMS.map((a) => range(of(a))).join(" | ")} |`);
  }
  const d = read(cells, exact === frames && !errors.length);
  const cell = (e) => `${f3(e.ratio)} [${f3(e.lo)}–${f3(e.hi)}] ${reading(e)}`;
  console.log("\n**The reading** (round-paired ratio: the median [95 % interval], then the interval's reading):\n");
  console.log("| throttle | set | rounds | W′ ÷ W (A/A) | W2 ÷ W (M) | R ÷ W2 (R) |\n| --- | --- | --: | --- | --- | --- |");
  for (const l of d.lines) {
    console.log(`| ${l.t}× | \`${l.set}\` | ${l.M.n} | ${f3(l["A/A"].ratio)} [${f3(l["A/A"].lo)}–${f3(l["A/A"].hi)}]${l.aaMiss ? " **miss**" : ""} | ${cell(l.M)} | ${cell(l.R)} |`);
  }
  console.log(`\nA/A misses: ${d.aaMisses} of ${d.lines.length} cells (void at 2). M a cost in: ${d.mCosts.join(", ") || "no cell"}. **Run: ${d.verdict}.**`);
}
