/**
 * The breakdown's rows read as the protocol reads them: ms a frame, the stage shares, the checks that can void
 * them, the refutations and the decision rule. Markdown out. README.md here
 *
 *   node lab/av1/decode/breakdown/report.mjs rows.json [--manifest lab/.av1-work/breakdown/frames/manifest.json]
 */
import { readFileSync } from "node:fs";
import { coverage, durations, groups, median, spans, streams } from "./stages.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
const manifest = JSON.parse(readFileSync(arg("--manifest", "lab/.av1-work/breakdown/frames/manifest.json"), "utf8"));
const SETS = manifest.map((s) => s.name);
const THROTTLES = [...new Set(rows.map((r) => r.throttle))].sort((a, b) => a - b);
const ARMS = ["H", "H0", "D", "D0", "W", "W0", "W1", "W2", "W12", "Z_D", "Z_W", "T_D", "T_W"].filter((a) => rows.some((r) => r.arm === a));
const WEBCODECS = (arm) => arm.startsWith("W") || arm === "Z_W" || arm === "T_W";
const f1 = (v) => (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1));
const pct = (v) => (100 * v).toFixed(1);
const range = (v, f = f1) => `${f(median(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}]`;

const cell = (t, s, a) => rows.filter((r) => r.throttle === t && r.set === s && r.arm === a && !r.error && r.frames.length === r.n);
/** Per round: the round's median of `pick(frame)`, frames of a round's row. */
const perRound = (t, s, a, pick) => new Map(cell(t, s, a).map((r) => [r.round, median(r.frames.map(pick))]));

const exactAll = rows.reduce((n, r) => n + r.exact, 0);
const framesAll = rows.reduce((n, r) => n + r.n, 0);
const failed = rows.filter((r) => r.error);
console.log(`## Rows\n\n${rows.length} runs, ${new Set(rows.map((r) => r.round)).size} rounds, Chromium ${[...new Set(rows.map((r) => r.chromium))].join(", ")}; **${exactAll} of ${framesAll} frames exact** (the worker's XXH3 and the page's SHA-256 both)${failed.length ? `; ${failed.length} runs failed: ${[...new Set(failed.map((r) => `${r.arm} ${r.set}: ${r.error}`))].join("; ")}` : ""}.\n`);

console.log("## ms a frame\n\nMedian over rounds of each round's median [range of round medians].\n");
console.log(`| throttle | set | ${ARMS.join(" | ")} |\n| --- | --- |${ARMS.map(() => " --: |").join("")}`);
for (const t of THROTTLES) for (const s of SETS) {
  console.log(`| ${t}× | \`${s}\` | ${ARMS.map((a) => { const v = [...perRound(t, s, a, (f) => f.ms).values()]; return v.length ? range(v) : "—"; }).join(" | ")} |`);
}

console.log("\n## Checks\n\n**A/A**: stamped ÷ unstamped, the median of round-paired ratios [range]; within 2 % or the breakdown is void.\n");
console.log("| throttle | set | H ÷ H0 | D ÷ D0 | W ÷ W0 |\n| --- | --- | --: | --: | --: |");
const paired = (t, s, a, b, pick = (f) => f.ms) => {
  const x = perRound(t, s, a, pick);
  const y = perRound(t, s, b, pick);
  return [...x].filter(([r]) => y.has(r)).map(([r, v]) => v / y.get(r));
};
let aaVoid = false;
for (const t of THROTTLES) for (const s of SETS) {
  const cols = [["H", "H0"], ["D", "D0"], ["W", "W0"]].map(([a, b]) => {
    const v = paired(t, s, a, b);
    if (!v.length) return "—";
    if (Math.abs(median(v) - 1) > 0.02) aaVoid = true;
    return range(v, (x) => x.toFixed(3));
  });
  console.log(`| ${t}× | \`${s}\` | ${cols.join(" | ")} |`);
}
console.log(`\nA/A ${aaVoid ? "**outside 2 % in some cell: the breakdown is void there**" : "within 2 % in every cell"}.\n`);

console.log("**Coverage**: the share of a frame its stages cover, median of round medians [range]; under 97 % voids the cell.\n");
const STAMPED = ARMS.filter((a) => !a.endsWith("0"));
console.log(`| throttle | set | ${STAMPED.join(" | ")} |\n| --- | --- |${STAMPED.map(() => " --: |").join("")}`);
let covVoid = [];
for (const t of THROTTLES) for (const s of SETS) {
  console.log(`| ${t}× | \`${s}\` | ${STAMPED.map((a) => {
    const v = [...perRound(t, s, a, (f) => coverage(spans(f.stamps), f.ms)).values()];
    if (!v.length) return "—";
    if (median(v) < 0.97) covVoid.push(`${a} ${t}× ${s}`);
    return range(v, pct);
  }).join(" | ")} |`);
}
console.log(`\nCoverage ${covVoid.length ? `under 97 % in: ${covVoid.join(", ")}` : "≥ 97 % in every cell"}.\n`);

/** The protocol's predicted shares, % of decodeStart→decodeEnd. */
const PREDICTED = {
  D: { "top decode": [50, 75], "low decode": [18, 45], flush: [0, 1], "chroma + merge + range": [3, 8], digest: [0.3, 1.3] },
  W: { "max(top, low) decode": [55, 100], flush: [7, 28], copyTo: [2, 5], "chroma + merge + range": [5, 12], digest: [0.5, 2] },
};
/** HTJ2K's codec has no stamps inside: its stages are the codec call and the digest. */
const stagesOf = (a, list) => (a === "H" ? durations(list) : groups(list, WEBCODECS(a)));
const share = (a, name) => (f) => (stagesOf(a, spans(f.stamps))[name] ?? 0) / f.ms;

for (const a of STAMPED) {
  const names = a === "H" ? ["codec", "digest"] : Object.keys(groups([], WEBCODECS(a)));
  console.log(`## Stages, ${a}\n\n% of the frame, median of round medians [range]${PREDICTED[a] ? "; predicted range under each name, and the rounds of 10 outside it by > 5 points" : ""}.\n`);
  console.log(`| throttle | set | ${names.map((n) => (PREDICTED[a]?.[n] ? `${n} (${PREDICTED[a][n].join("–")})` : n)).join(" | ")} | ms a frame |\n| --- | --- |${names.map(() => " --: |").join("")} --: |`);
  for (const t of THROTTLES) for (const s of SETS) {
    const cols = names.map((n) => {
      const v = [...perRound(t, s, a, share(a, n)).values()];
      if (!v.length) return "—";
      const p = PREDICTED[a]?.[n];
      const out = p ? v.filter((x) => 100 * x < p[0] - 5 || 100 * x > p[1] + 5).length : null;
      return `${range(v, pct)}${p ? ` · ${out}/${v.length}${out >= 8 ? " **refuted**" : ""}` : ""}`;
    });
    console.log(`| ${t}× | \`${s}\` | ${cols.join(" | ")} | ${range([...perRound(t, s, a, (f) => f.ms).values()])} |`);
  }
  if (WEBCODECS(a)) {
    console.log("\nEach stream's own time, config to flush, ms, and their sum (one core's stand-in):\n");
    console.log("| throttle | set | top | low | sum | frame |\n| --- | --- | --: | --: | --: | --: |");
    for (const t of THROTTLES) for (const s of SETS) {
      const g = (k) => [...perRound(t, s, a, (f) => streams(spans(f.stamps))[k] ?? 0).values()];
      if (!g("sum").length) continue;
      console.log(`| ${t}× | \`${s}\` | ${range(g("top"))} | ${range(g("low"))} | ${range(g("sum"))} | ${range([...perRound(t, s, a, (f) => f.ms).values()])} |`);
    }
  }
  console.log(`\nThe consumer port, decodeEnd to the page's receipt, ms: ${THROTTLES.map((t) => `${t}× ${range(SETS.flatMap((s) => [...perRound(t, s, a, (f) => f.port).values()]))}`).join(", ")}.\n`);
}

console.log("## The entropy coder\n\nD's `_av1_decode`, top and low, % of D's frame; refuted under 50 %.\n");
for (const t of THROTTLES) for (const s of SETS) {
  const v = [...perRound(t, s, "D", (f) => { const d = durations(spans(f.stamps)); return ((d["top.decode"] ?? 0) + (d["low.decode"] ?? 0)) / f.ms; }).values()];
  if (v.length) console.log(`* ${t}× \`${s}\`: ${range(v, pct)} %${median(v) < 0.5 ? " **refuted**" : ""}`);
}

console.log("\n## The rule\n\nLever ÷ W, round-paired: the median ratio [range], and the rounds the lever was faster.\n");
console.log("| lever | throttle | set | ÷ W | faster | exact |\n| --- | --- | --- | --: | --: | --: |");
const verdicts = {};
for (const lever of ["W1", "W2", "W12"]) {
  let ok = true;
  for (const t of THROTTLES) for (const s of SETS) {
    const v = paired(t, s, lever, "W");
    const all = rows.filter((r) => r.throttle === t && r.set === s && r.arm === lever);
    const exact = `${all.reduce((n, r) => n + r.exact, 0)}/${all.reduce((n, r) => n + r.n, 0)}`;
    const faster = v.filter((x) => x < 1).length;
    const pass = v.length >= 10 && faster >= 9 && median(v) <= 0.95 && all.every((r) => r.exact === r.n && !r.error);
    ok &&= pass;
    console.log(`| ${lever} | ${t}× | \`${s}\` | ${v.length ? range(v, (x) => x.toFixed(3)) : "—"} | ${faster}/${v.length} | ${exact} |`);
  }
  verdicts[lever] = ok && THROTTLES.includes(1) && THROTTLES.includes(4);
}
console.log(`\n${Object.entries(verdicts).map(([l, ok]) => `**${l}: ${ok ? "build as the default" : "not built"}**`).join(" · ")} (W12 is not named in the rule; it is reported).\n`);

console.log("**Store levers**, for the owner: bytes over the base AV1 coding, and ms a frame ÷ their decoder's arm, round-paired.\n");
console.log("| lever | set | bytes ÷ AV1 | throttle | ÷ arm |\n| --- | --- | --: | --- | --: |");
for (const [lever, ref, ext] of [["Z_D", "D", "z"], ["Z_W", "W", "z"], ["T_D", "D", "t4"], ["T_W", "W", "t4"]]) {
  for (const s of manifest) for (const t of THROTTLES) {
    const v = paired(t, s.name, lever, ref);
    console.log(`| ${lever} | \`${s.name}\` | ${(s.bytes[ext] / s.bytes.av1).toFixed(4)} | ${t}× | ${v.length ? range(v, (x) => x.toFixed(3)) : "—"} |`);
  }
}
console.log(`\nBytes, the 16 slices: ${manifest.map((s) => `\`${s.name}\` AV1 ${s.bytes.av1}, 4 tiles ${s.bytes.t4}, low deflated ${s.bytes.z}, HTJ2K ${s.bytes.htj2k}`).join("; ")}.`);
