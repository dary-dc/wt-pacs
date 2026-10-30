// docs/adr/frame-path.md §7: the page view against the view worker, its guards and rule over run.mjs's rows.
//   node lab/viewer/view-summary.mjs rows.jsonl [more.jsonl ...]
import { readFileSync } from "node:fs";
import { median } from "../frame-clock/measure.js";

/** ms: one 60 Hz frame, the bar; the A/A pair's bound on its paired median. Points of frames due. */
const BAR_MS = 16.7;
const AA_MS = 8;
const AA_POINTS = 2;
const FILL = [0.98, 1.02];
const ROUNDS_NEEDED = 9;
const ROUNDS = 12;
/** ms: a busy visit whose shortest long task was shorter is void. */
const LONG_TASK_MS = 200;
export const ARMS = ["page", "pageaa", "worker"];

/** quiet: the fill; busy: the fill on a busy page; cine: the same, then its cine; asks: on demand, busy. */
export const kindOf = (r) => (r.asks ? "asks" : r.cineS ? "cine" : r.busy ? "busy" : "quiet");

/** A visit counted: its relay on time, no error, every frame it owed held, and under a busy page every task long. */
const kept = (r) => !r.void && !r.errors?.length && !r.failures && (r.frames || r.afterMs?.length) && (!r.cineS || r.cine) && (!r.busy || r.tasks?.minMs >= LONG_TASK_MS);

/** Each cell's guards and the worker against the page, paired by round. */
export function cells(rows) {
  const byCell = new Map();
  for (const r of rows) {
    const key = [r.engine, r.set, `${r.throttle}x`, kindOf(r)].join(" ");
    if (!byCell.has(key)) byCell.set(key, { key, engine: r.engine, set: r.set, throttle: r.throttle, kind: kindOf(r), rows: [] });
    byCell.get(key).rows.push(r);
  }
  return [...byCell.values()].map((c) => {
    // Every frame a visit held is owed exact; a visit that failed short is re-run, not counted.
    const exact = c.rows.every((r) => r.exact === (c.kind === "asks" ? r.afterMs?.length ?? 0 : r.frames));
    const all = Object.fromEntries(ARMS.map((a) => [a, new Map(c.rows.filter((r) => r.variant === a && kept(r)).map((r) => [r.round, r]))]));
    // The first 12 rounds every arm kept: a round re-run for a dropped visit does not lengthen the cell.
    const rounds = [...all.page.keys()].filter((k) => ARMS.every((a) => all[a].has(k))).sort((x, y) => x - y).slice(0, ROUNDS);
    const arms = Object.fromEntries(ARMS.map((a) => [a, new Map(rounds.map((k) => [k, all[a].get(k)]))]));
    const paired = (a, f) => [...arms[a].keys()].filter((k) => arms.page.has(k)).map((k) => f(arms[a].get(k), arms.page.get(k)));
    const out = { ...c, exact, rounds: rounds.length };
    const of = (a, f) => (arms[a].size ? median([...arms[a].values()].map(f)) : null);
    out.cpuPerFrame = Object.fromEntries(ARMS.map((a) => [a, of(a, (r) => r.pageCpuMs / r.owed)]));
    out.firstMs = Object.fromEntries(ARMS.map((a) => [a, of(a, (r) => r.firstMs)]));
    if (c.kind === "quiet") {
      const fill = (a) => median(paired(a, (x, y) => x.fillMs / y.fillMs));
      const first = (a) => median(paired(a, (x, y) => x.firstMs - y.firstMs));
      out.void = !(fill("pageaa") >= FILL[0] && fill("pageaa") <= FILL[1] && Math.abs(first("pageaa")) < BAR_MS);
      out.fill = fill("worker");
      out.first = first("worker");
      out.passes = out.fill >= FILL[0] && out.fill <= FILL[1] && out.first < BAR_MS;
    }
    if (c.kind === "asks") {
      const screen = (r) => median(r.screenMs);
      out.screenMs = Object.fromEntries(ARMS.map((a) => [a, of(a, screen)]));
      // §2 predicts the page's mean, not its median: half a task for the asks that land in one.
      out.screenMean = Object.fromEntries(ARMS.map((a) => [a, of(a, (r) => r.screenMs.reduce((x, y) => x + y, 0) / r.screenMs.length)]));
      out.void = !(Math.abs(median(paired("pageaa", (x, y) => screen(x) - screen(y)))) < AA_MS);
      out.wins = paired("worker", (x, y) => screen(y) - screen(x) >= BAR_MS).filter(Boolean).length;
      out.passes = out.wins >= ROUNDS_NEEDED;
    }
    if (c.kind === "busy") out.passes = true;
    if (c.kind === "cine") {
      const period = c.rows.find((r) => r.cine)?.cine.period;
      const late = (a) => median(paired(a, (x, y) => x.cine.latePct - y.cine.latePct).map(Math.abs));
      const gap = (a) => median(paired(a, (x, y) => x.cine.gapP99 - y.cine.gapP99).map(Math.abs));
      out.latePct = Object.fromEntries(ARMS.map((a) => [a, of(a, (r) => r.cine.latePct)]));
      out.gapP99 = Object.fromEntries(ARMS.map((a) => [a, of(a, (r) => r.cine.gapP99)]));
      out.void = !(late("pageaa") <= AA_POINTS && gap("pageaa") < BAR_MS);
      out.saturated = of("page", (r) => r.cine.drawP99) > period / 2;
      out.pageMisses = out.latePct.page > AA_POINTS;
      out.passes = !out.pageMisses || (out.latePct.worker <= AA_POINTS && out.gapP99.worker <= 2 * period);
    }
    out.short = out.rounds < ROUNDS;
    return out;
  });
}

/** The rule: B′ if every decided cell passes and each engine has an asks cell decided; otherwise A stays. */
export function decide(rows) {
  const all = cells(rows);
  if (!all.every((c) => c.exact)) return { cells: all, verdict: "A stays: a frame not exact" };
  const decided = all.filter((c) => !c.void && !c.short && !c.saturated);
  const engines = [...new Set(all.map((c) => c.engine))];
  const failing = decided.filter((c) => !c.passes);
  if (failing.length) return { cells: all, verdict: `A stays: ${failing.map((c) => c.key).join(", ")} fail` };
  const undecided = engines.filter((e) => !decided.some((c) => c.engine === e && c.kind === "asks"));
  if (undecided.length) return { cells: all, verdict: `undecided: no asks cell decided in ${undecided.join(", ")}` };
  return { cells: all, verdict: "adopt B′" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const { cells: all, verdict } = decide(rows);
  const f = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(d));
  const each = (o, d) => ARMS.map((a) => `${a} ${f(o[a], d)}`).join(" / ");
  for (const c of all) {
    const guards = [c.void && "VOID", c.short && `short (${c.rounds} rounds)`, c.saturated && "saturated", !c.exact && "NOT EXACT"].filter(Boolean).join(", ") || "decided";
    const figures = {
      quiet: () => `first ${each(c.firstMs, 0)} ms; worker fill ×${f(c.fill, 3)}, first ${f(c.first, 1)} ms; page thread ${each(c.cpuPerFrame, 2)} ms a frame`,
      asks: () => `decode → draw median ${each(c.screenMs)} ms, mean ${each(c.screenMean)} ms; worker ≥ ${BAR_MS} ms sooner in ${c.wins}/${c.rounds}`,
      busy: () => `first ${each(c.firstMs, 0)} ms`,
      cine: () => `first ${each(c.firstMs, 0)} ms; cine late ${each(c.latePct)} %, gap p99 ${each(c.gapP99, 0)} ms`,
    }[c.kind]();
    console.log(`${c.key}: ${guards}; ${c.passes ? "passes" : "fails"}; ${figures}`);
  }
  console.log(verdict);
}
