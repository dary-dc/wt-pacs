/** A visit's per-call times and a cell's verdict, as pre-registered: docs/adr/frame-path.md §7, *The pixel read under a busy page*. */
import { LONG_TASK_MS } from "../frame-clock/busy.js";

export const VARIANTS = ["read", "read′", "fence", "finish", "none"];
export const UNITS = VARIANTS.flatMap((variant) => [false, true].map((busy) => ({ variant, busy })));
export const ROUNDS = 12;
/** A call waits out the page when it lasts at least this share of the task left at its start. */
const WAIT_SHARE = 0.5;
/** Rounds of 12: at least this many waiting is "waits", at most LOOSE is "does not". */
const WAITS_ROUNDS = 10;
const LOOSE_ROUNDS = 2;
/** The A/A bar, ms or a share of the larger median, whichever is larger. */
const AA_MS = 2;
const AA_SHARE = 0.2;

export const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return !s.length ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
export const p99 = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.ceil(0.99 * s.length) - 1] : NaN;
};

/** One visit's row: every call's time, and for the calls that start inside a long task, the time against the task left. */
export function visit({ calls, spans = [], tasks = [], busy }) {
  if (busy && (!tasks.length || Math.min(...tasks) < LONG_TASK_MS)) return { kept: false };
  const ms = calls.map(([, m]) => m);
  const inTask = [];
  for (const [start, m] of calls) {
    const span = spans.find(([a, e]) => a <= start && start < e);
    if (span) inTask.push({ ms: m, left: span[1] - start });
  }
  const left = median(inTask.map((c) => c.left));
  const inMs = median(inTask.map((c) => c.ms));
  return {
    kept: true, n: calls.length, median: median(ms), p99: p99(ms), timedOut: calls.filter((c) => c[2]).length,
    inTask: { n: inTask.length, median: inMs, left, excess: median(inTask.map((c) => c.ms - c.left)) },
    waits: inTask.length > 0 && inMs >= WAIT_SHARE * left,
  };
}

/** The verdict of one engine's quiet or busy cell; `period` is the probe's call period, ms. */
export function cell(rows, { busy, period }) {
  const byRound = new Map();
  for (const r of rows.filter((r) => !r.error && r.busy === busy)) {
    const v = visit(r);
    if (!v.kept) continue;
    const round = byRound.get(r.round) ?? byRound.set(r.round, {}).get(r.round);
    round[r.variant] ??= v;
  }
  const rounds = [...byRound.entries()].filter(([, vs]) => VARIANTS.every((x) => vs[x])).sort(([a], [b]) => a - b).slice(0, ROUNDS).map(([, vs]) => vs);
  const stat = (v) => (busy ? v.inTask.median : v.median);
  const aa = median(rounds.map((vs) => stat(vs.read) - stat(vs["read′"])));
  const larger = Math.max(median(rounds.map((vs) => stat(vs.read))), median(rounds.map((vs) => stat(vs["read′"]))));
  const variants = Object.fromEntries(VARIANTS.map((x) => {
    const vs = rounds.map((r) => r[x]);
    const waited = vs.filter((v) => v.waits).length;
    return [x, {
      median: median(vs.map((v) => v.median)), p99: median(vs.map((v) => v.p99)), timedOut: vs.reduce((s, v) => s + v.timedOut, 0),
      inTask: median(vs.map((v) => v.inTask.median)), left: median(vs.map((v) => v.inTask.left)), excess: median(vs.map((v) => v.inTask.excess)),
      waited, waits: !busy || rounds.length < ROUNDS ? null : waited >= WAITS_ROUNDS ? "waits" : waited <= LOOSE_ROUNDS ? "does not wait" : "mixed",
    }];
  }));
  return {
    busy, rounds: rounds.length, decided: rounds.length >= ROUNDS, aa, void: Math.abs(aa) > Math.max(AA_MS, AA_SHARE * larger),
    saturated: variants.none.p99 > period / 2, variants,
  };
}

const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");

/** Every engine's two cells from a rows file, and the text the run prints. */
export function summarise(rows) {
  const lines = [];
  const cells = {};
  for (const engine of [...new Set(rows.map((r) => r.engine))]) {
    const mine = rows.filter((r) => r.engine === engine);
    const period = mine.find((r) => r.period)?.period ?? 20;
    const ua = mine.find((r) => r.userAgent);
    lines.push(`\n${engine}: ${ua?.renderer ?? "?"}; ${ua?.userAgent ?? "?"}`);
    for (const busy of [false, true]) {
      const c = (cells[`${engine}/${busy ? "busy" : "quiet"}`] = cell(mine, { busy, period }));
      lines.push(`  ${busy ? "busy " : "quiet"}  rounds ${c.rounds}${c.decided ? "" : " (decides nothing)"}  A/A ${fmt(c.aa, 2)} ms${c.void ? "  VOID" : ""}${c.saturated ? "  SATURATED" : ""}`);
      for (const [x, v] of Object.entries(c.variants)) {
        lines.push(`    ${x.padEnd(6)} median ${fmt(v.median, 2).padStart(7)}  p99 ${fmt(v.p99, 2).padStart(7)} ms${busy
          ? `  in a task: ${fmt(v.inTask, 2).padStart(7)} ms, ${fmt(v.left)} left, excess ${fmt(v.excess)}; waited ${v.waited}/${c.rounds}${v.waits ? `: ${v.waits}` : ""}`
          : ""}${v.timedOut ? `  ${v.timedOut} timed out` : ""}`);
      }
    }
  }
  return { cells, text: lines.join("\n") };
}
