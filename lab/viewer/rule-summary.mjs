// docs/adr/frame-path.md §7, *Again with both fixes*: §7's rule with the quiet cell's corrected bars, one B′ arm named.
//   node lab/viewer/rule-summary.mjs rows.jsonl [more.jsonl ...]
import { readFileSync } from "node:fs";
import { cells as startCells } from "./start-summary.mjs";
import { cells as viewCells, kindOf } from "./view-summary.mjs";

export const ARMS = ["page", "pageaa", "workerdials"];

/** Every frame a visit held is exact, kept or not: §7's. */
const exact = (r) => r.exact === (r.asks ? r.afterMs?.length ?? 0 : r.frames);

/** The quiet cells by the corrected bars, the busy cells by §7's; each with `passes` and what it leaves undecided. */
export function cells(rows, arms = ARMS) {
  const b = arms[2];
  // A quiet cell's saturation guard is a bar's: a saturated window claims nothing, the other bar still decides.
  const quiet = startCells(rows.filter((r) => kindOf(r) === "quiet"), arms).map(({ saturated, ...c }) => {
    const a = c.arms[b];
    const later = !saturated.start && a.latency === "later";
    const slower = !c.oneFrame && !saturated.fill && a.throughput === "slower";
    return { ...c, key: `${c.key} quiet`, kind: "quiet", saturatedBars: saturated, latencyDecided: !saturated.start, passes: !later && !slower };
  });
  const busy = viewCells(rows.filter((r) => kindOf(r) !== "quiet"), arms);
  return [...quiet, ...busy];
}

/** B′ replaces A if every frame is exact, every decided cell passes, and each engine has an asks cell and a quiet latency decided. */
export function decide(rows, arms = ARMS) {
  const all = cells(rows, arms);
  if (!rows.every(exact)) return { cells: all, verdict: "A stays: a frame not exact" };
  const decided = all.filter((c) => !c.void && !c.short && !c.saturated);
  const failing = decided.filter((c) => !c.passes);
  if (failing.length) return { cells: all, verdict: `A stays: ${failing.map((c) => c.key).join(", ")} fail` };
  const engines = [...new Set(all.map((c) => c.engine))];
  const owed = engines.flatMap((e) => [
    !decided.some((c) => c.engine === e && c.kind === "asks") && `no asks cell decided in ${e}`,
    !decided.some((c) => c.engine === e && c.kind === "quiet" && c.latencyDecided) && `no quiet latency decided in ${e}`,
  ]).filter(Boolean);
  if (owed.length) return { cells: all, verdict: `undecided: ${owed.join(", ")}` };
  return { cells: all, verdict: "B′ replaces A" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const { cells: all, verdict } = decide(rows);
  const b = ARMS[2];
  const f = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(d));
  const each = (o, d) => ARMS.map((a) => `${a} ${f(o[a], d)}`).join(" / ");
  for (const c of all) {
    const guards = [c.void && "VOID", c.short && `short (${c.rounds} rounds)`, c.saturated && "saturated", c.saturatedBars?.start && "start saturated",
      c.saturatedBars?.fill && "fill saturated", c.exact === false && "NOT EXACT"].filter(Boolean).join(", ") || "decided";
    const figures = {
      quiet: () => `cores start ${f(c.cores.start, 2)}, fill ${f(c.cores.fill, 2)}; ${b} − page first ${f(c.arms[b].first)} ms (${c.arms[b].latency})` +
        (c.oneFrame ? "" : `, fill after it ×${f(c.arms[b].fill, 3)} (${c.arms[b].throughput})`),
      asks: () => `decode → draw median ${each(c.screenMs)} ms, mean ${each(c.screenMean)} ms; ${b} ≥ 16.7 ms sooner in ${c.wins}/${c.rounds}`,
      busy: () => `first ${each(c.firstMs, 0)} ms`,
      cine: () => `cine late ${each(c.latePct)} %, gap p99 ${each(c.gapP99, 0)} ms`,
    }[c.kind]();
    console.log(`${c.key}: ${guards}; ${c.passes ? "passes" : "fails"}; ${figures}`);
  }
  console.log(verdict);
}
