/**
 * The passes protocol's reading of run.mjs's rows: ms a frame per arm and cell, W′ ÷ W and W2 ÷ W as the median of
 * round-paired ratios with a distribution-free 95 % interval, and the decision rule applied. README.md here
 *
 *   node lab/av1/decode/passes/report.mjs rows.json > report.md
 */
import { readFileSync } from "node:fs";

const ULTRASOUND = "us_liver";

export const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** The largest k with P(Binomial(n, ½) ≤ k − 1) ≤ 0.025: the interval is the k-th and (n − k + 1)-th ordered values. */
export function rank(n) {
  let p = 0;
  let term = Math.pow(0.5, n); // P(X = 0)
  let k = 0;
  while (k < n) {
    if (p + term > 0.025) break;
    p += term;
    k++;
    term *= (n - k + 1) / k;
  }
  return k;
}

/** The median of `logs` and its 95 % interval, as ratios. */
export function effect(logs) {
  const s = [...logs].sort((a, b) => a - b);
  const k = rank(s.length);
  return { n: s.length, ratio: Math.exp(median(s)), lo: k ? Math.exp(s[k - 1]) : NaN, hi: k ? Math.exp(s[s.length - k]) : NaN };
}

/** cell → arm → round → the median of its frames' ms. */
function rounds(rows) {
  const cells = new Map();
  for (const r of rows) {
    const key = `${r.throttle}|${r.set}`;
    if (!cells.has(key)) cells.set(key, {});
    const c = cells.get(key);
    (c[r.arm] ??= new Map()).set(r.round, median(r.frames.map((f) => f.ms)));
  }
  return cells;
}

function paired(c, arm) {
  return [...c[arm].keys()].filter((r) => c.W.has(r)).map((r) => Math.log(c[arm].get(r) / c.W.get(r)));
}

export function decide(cells) {
  const lines = [];
  let aaMisses = 0;
  let pass = true;
  for (const [key, c] of cells) {
    const [t, set] = key.split("|");
    const aa = effect(paired(c, "W′"));
    const w2 = effect(paired(c, "W2"));
    const aaMiss = !(aa.lo <= 1 && aa.hi >= 1);
    if (aaMiss) aaMisses++;
    let ok;
    let why = "";
    if (set === ULTRASOUND) {
      ok = w2.hi <= 1.02;
      if (!ok) why = `upper end ${w2.hi.toFixed(3)} > 1.02`;
    } else {
      ok = w2.hi < 1 && w2.ratio <= 0.97;
      if (!ok) why = [w2.hi >= 1 && `upper end ${w2.hi.toFixed(3)} ≥ 1.00`, w2.ratio > 0.97 && `median ${w2.ratio.toFixed(3)} > 0.97`].filter(Boolean).join(", ");
    }
    if (!ok) pass = false;
    lines.push({ t: Number(t), set, aa, w2, aaMiss, ok, why });
  }
  return { lines, aaMisses, aaVoid: aaMisses >= 2, pass };
}

const f3 = (x) => x.toFixed(3);
const range = (v) => `${median(v).toFixed(1)} [${Math.min(...v).toFixed(1)}–${Math.max(...v).toFixed(1)}]`;

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const frames = rows.reduce((a, r) => a + r.n, 0);
  const exact = rows.reduce((a, r) => a + r.exact, 0);
  const errors = rows.filter((r) => r.error);
  const browsers = new Set(rows.map((r) => `${r.round}:${r.throttle}`)).size;
  console.log(`Chromium ${[...new Set(rows.map((r) => r.chromium))].join(", ")}; ${browsers} browsers; ${rows.length} runs; **${exact} of ${frames} frames exact**${errors.length ? `; ${errors.length} runs failed` : ""}.\n`);
  const fallbacks = rows.flatMap((r) => r.frames).filter((f) => f.mismatchOn || f.path !== "av1-webcodecs").length;
  console.log(`Frames off WebCodecs or rescued by the fallback: ${fallbacks}.\n`);
  const cells = new Map([...rounds(rows)].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  console.log("**ms a frame** (the median over rounds of each round's median of 16 frames [range]; rounds):\n");
  console.log("| throttle | set | rounds | W | W′ | W2 |\n| --- | --- | --: | --: | --: | --: |");
  for (const [key, c] of cells) {
    const [t, set] = key.split("|");
    console.log(`| ${t}× | \`${set}\` | ${c.W.size} | ${["W", "W′", "W2"].map((a) => range([...c[a].values()])).join(" | ")} |`);
  }
  console.log("\n**Post → consumer-port receipt** (a check, not decided on): the page's post to the frame's receipt, less the product's `decodeStart`→`decodeEnd`, ms a frame, median [range] over frames:\n");
  console.log("| throttle | set | W | W′ | W2 |\n| --- | --- | --: | --: | --: |");
  for (const [key] of cells) {
    const [t, set] = key.split("|");
    const of = (a) => rows.filter((r) => `${r.throttle}|${r.set}` === key && r.arm === a).flatMap((r) => r.frames.map((f) => f.post - f.ms));
    console.log(`| ${t}× | \`${set}\` | ${["W", "W′", "W2"].map((a) => range(of(a))).join(" | ")} |`);
  }
  const d = decide(cells);
  console.log("\n**The rule** (round-paired ratio ÷ W: the median, [95 % interval]):\n");
  console.log("| throttle | set | rounds | W′ ÷ W (A/A) | W2 ÷ W | condition | met |\n| --- | --- | --: | --: | --: | --- | --- |");
  for (const l of d.lines) {
    const cond = l.set === ULTRASOUND ? "upper ≤ 1.02" : "upper < 1.00, median ≤ 0.97";
    console.log(`| ${l.t}× | \`${l.set}\` | ${l.w2.n} | ${f3(l.aa.ratio)} [${f3(l.aa.lo)}–${f3(l.aa.hi)}]${l.aaMiss ? " **miss**" : ""} | ${f3(l.w2.ratio)} [${f3(l.w2.lo)}–${f3(l.w2.hi)}] | ${cond} | ${l.ok ? "yes" : `**no**: ${l.why}`} |`);
  }
  const allExact = exact === frames && !errors.length;
  const verdict = !allExact ? "void: not every frame exact" : d.aaVoid ? `void: the A/A missed in ${d.aaMisses} cells` : d.pass ? "`onePass` becomes the default" : "`onePass` stays off";
  console.log(`\nA/A misses: ${d.aaMisses} of ${d.lines.length} cells (void at 2). **Verdict: ${verdict}.**`);
}
