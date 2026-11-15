// docs/adr/frame-path.md §7, *The busy page, asks on the mean*: A against B′ with the start's fix on §7's busy page,
// the asks scored on the mean and on the asks handed off inside a long task; cine as §7.
//   node lab/viewer/busy-summary.mjs lab/viewer/rows/busy-asks.jsonl lab/viewer/rows/busy-cine.jsonl
import { readFileSync } from "node:fs";
import { median } from "../frame-clock/measure.js";

/** ms: one 60 Hz frame, the bar; the A/A pair's bound on each part of the model; a quiet path this long saturates. */
const BAR_MS = 16.7;
const AA_MS = 8;
const QUIET_SATURATED_MS = 50;
/** Points of frames due; a busy visit's shortest long task, ms. */
const AA_POINTS = 2;
const LONG_TASK_MS = 200;
const ROUNDS = 12;
const ROUNDS_NEEDED = 9;
export const ARMS = ["page", "pageaa", "workerfix"];

export const kindOf = (r) => (r.asks ? "asks" : "cine");

const kept = (r) => !r.void && !r.errors?.length && !r.failures && r.tasks?.minMs >= LONG_TASK_MS &&
  (r.asks ? r.screenMs?.length === r.asks && r.handoffs?.length === r.asks : r.frames && r.cine);

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One asks visit: each ask in a task or not, by its hand-off against the page's spans; `left`, ms of its task still to run. */
export function asks(r) {
  const each = r.screenMs.map((screen, k) => {
    const h = r.handoffs[k];
    const span = r.spans.find(([a, b]) => h >= a && h < b);
    return { screen, left: span ? span[1] - h : null };
  });
  const inTask = each.filter((a) => a.left !== null);
  const out = each.filter((a) => a.left === null);
  return {
    mean: mean(r.screenMs),
    inTask: inTask.length ? median(inTask.map((a) => a.screen)) : null,
    inTaskN: inTask.length,
    // §2's model for the page: an ask handed off in a task waits what is left of it, then takes the quiet path.
    excess: inTask.length ? median(inTask.map((a) => a.screen - a.left)) : null,
    quiet: out.length ? median(out.map((a) => a.screen)) : null,
  };
}

/** Each cell's guards and the rule, paired by round. */
export function cells(rows) {
  const byCell = new Map();
  for (const r of rows) {
    const key = [r.engine, r.set, `${r.throttle}x`, kindOf(r)].join(" ");
    if (!byCell.has(key)) byCell.set(key, { key, engine: r.engine, set: r.set, throttle: r.throttle, kind: kindOf(r), rows: [] });
    byCell.get(key).rows.push(r);
  }
  return [...byCell.values()].map((c) => {
    const exact = c.rows.every((r) => r.exact === (c.kind === "asks" ? r.asks : r.frames));
    const all = Object.fromEntries(ARMS.map((a) => [a, new Map(c.rows.filter((r) => r.variant === a && kept(r)).map((r) => [r.round, r]))]));
    const rounds = [...all.page.keys()].filter((k) => ARMS.every((a) => all[a].has(k))).sort((x, y) => x - y).slice(0, ROUNDS);
    const out = { ...c, exact, rounds: rounds.length, short: rounds.length < ROUNDS };
    if (c.kind === "asks") {
      const v = Object.fromEntries(ARMS.map((a) => [a, rounds.map((k) => asks(all[a].get(k)))]));
      const of = (a, f) => median(v[a].map(f).filter((x) => x !== null));
      const paired = (a, b, f) => rounds.map((_, k) => [f(v[a][k]), f(v[b][k])]).filter(([x, y]) => x !== null && y !== null);
      const aa = (f) => Math.abs(median(paired("pageaa", "page", f).map(([x, y]) => x - y)));
      for (const f of ["mean", "inTask", "inTaskN", "excess", "quiet"]) out[f] = Object.fromEntries(ARMS.map((a) => [a, rounds.length ? of(a, (s) => s[f]) : null]));
      out.void = !(aa((s) => s.quiet) < AA_MS && aa((s) => s.excess) < AA_MS);
      out.saturated = out.quiet.page > QUIET_SATURATED_MS;
      out.meanWins = paired("page", "workerfix", (s) => s.mean).filter(([a, b]) => a - b >= BAR_MS).length;
      // A round in which either arm had no ask in a task is not a win.
      out.inTaskWins = paired("page", "workerfix", (s) => s.inTask).filter(([a, b]) => a - b >= BAR_MS).length;
      out.passes = out.meanWins >= ROUNDS_NEEDED && out.inTaskWins >= ROUNDS_NEEDED;
    } else {
      const of = (a, f) => (rounds.length ? median(rounds.map((k) => f(all[a].get(k).cine))) : null);
      const aa = (f) => median(rounds.map((k) => Math.abs(f(all.pageaa.get(k).cine) - f(all.page.get(k).cine))));
      out.period = c.rows.find((r) => r.cine)?.cine.period;
      for (const f of ["latePct", "gapP99", "drawP99"]) out[f] = Object.fromEntries(ARMS.map((a) => [a, of(a, (s) => s[f])]));
      out.void = !(aa((s) => s.latePct) <= AA_POINTS && aa((s) => s.gapP99) < BAR_MS);
      out.saturated = out.drawP99.page > out.period / 2;
      out.pageMisses = out.latePct.page > AA_POINTS;
      out.passes = !out.pageMisses || (out.latePct.workerfix <= AA_POINTS && out.gapP99.workerfix <= 2 * out.period);
    }
    out.decided = exact && !out.short && !out.void && !out.saturated;
    return out;
  });
}

/** Per engine: B′ wins the busy page if every decided cell passes and one asks cell is decided. */
export function verdicts(rows) {
  const all = cells(rows);
  return Object.fromEntries([...new Set(all.map((c) => c.engine))].map((e) => {
    const mine = all.filter((c) => c.engine === e);
    const decided = mine.filter((c) => c.decided);
    const failing = decided.filter((c) => !c.passes);
    const verdict = !mine.every((c) => c.exact) ? "B′ does not win: a frame not exact"
      : failing.length ? `B′ does not win: ${failing.map((c) => c.key).join(", ")} fail`
        : !decided.some((c) => c.kind === "asks") ? "undecided: no asks cell decided"
          : "B′ wins the busy page";
    return [e, { decided: decided.length, verdict }];
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const f = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(d));
  const each = (o, d) => ARMS.map((a) => `${a} ${f(o[a], d)}`).join(" / ");
  for (const c of cells(rows)) {
    const guards = [c.void && "VOID", c.short && `short (${c.rounds} rounds)`, c.saturated && "saturated", !c.exact && "NOT EXACT"].filter(Boolean).join(", ") || "decided";
    console.log(`${c.key}: ${guards}; ${c.passes ? "passes" : "fails"}`);
    if (c.kind === "asks") {
      console.log(`  mean ${each(c.mean)} ms; B′ ≥ ${BAR_MS} ms sooner in ${c.meanWins}/${c.rounds}`);
      console.log(`  in a task: median ${each(c.inTask)} ms, asks ${each(c.inTaskN, 0)}; B′ ≥ ${BAR_MS} ms sooner in ${c.inTaskWins}/${c.rounds}`);
      console.log(`  quiet path ${each(c.quiet)} ms; past what is left of the task ${each(c.excess)} ms`);
    } else {
      console.log(`  late ${each(c.latePct)} %; gap p99 ${each(c.gapP99, 0)} ms; draw p99 ${each(c.drawP99, 0)} ms`);
    }
  }
  for (const [e, v] of Object.entries(verdicts(rows))) console.log(`${e} (${v.decided} decided): ${v.verdict}`);
}
