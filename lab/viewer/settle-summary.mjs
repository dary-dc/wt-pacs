// docs/adr/frame-path.md §7, *The pixel read under a busy page*: §7's cine cell again, each view settling by the read
// and by the fence; the guards and rules as pre-registered there.
//   node lab/viewer/settle-summary.mjs lab/viewer/rows/settle-cine.jsonl
import { readFileSync } from "node:fs";
import { median } from "../frame-clock/measure.js";

/** Points of frames due; ms of gap p99; a busy visit's shortest long task, ms. */
const AA_POINTS = 2;
const BAR_MS = 16.7;
const LONG_TASK_MS = 200;
const ROUNDS = 12;
/** ms: a draw p99 this long or longer waits out the page's 200 ms task. */
const WAITED_MS = 150;
export const ARMS = ["page", "pageaa", "worker", "page-read", "worker-read"];

const kept = (r) => !r.void && !r.errors?.length && !r.failures && r.frames && r.cine && r.tasks?.minMs >= LONG_TASK_MS;

/** Each cine cell: the first 12 rounds every arm kept, the medians, the guards and both rules. */
export function cells(rows) {
  const byCell = new Map();
  for (const r of rows.filter((r) => r.cineS)) {
    const key = [r.engine, r.set, `${r.throttle}x`].join(" ");
    if (!byCell.has(key)) byCell.set(key, { key, engine: r.engine, set: r.set, throttle: r.throttle, rows: [] });
    byCell.get(key).rows.push(r);
  }
  return [...byCell.values()].map((c) => {
    const exact = c.rows.every((r) => r.exact === r.frames);
    const all = Object.fromEntries(ARMS.map((a) => [a, new Map(c.rows.filter((r) => r.variant === a && kept(r)).map((r) => [r.round, r]))]));
    const rounds = [...all.page.keys()].filter((k) => ARMS.every((a) => all[a].has(k))).sort((x, y) => x - y).slice(0, ROUNDS);
    const of = (a, f) => median(rounds.map((k) => f(all[a].get(k).cine)));
    const aa = (f) => median(rounds.map((k) => Math.abs(f(all.pageaa.get(k).cine) - f(all.page.get(k).cine))));
    const period = c.rows.find((r) => r.cine)?.cine.period;
    const each = (f) => Object.fromEntries(ARMS.map((a) => [a, rounds.length ? of(a, f) : null]));
    const out = { ...c, exact, rounds: rounds.length, period, latePct: each((s) => s.latePct), gapP99: each((s) => s.gapP99), drawP99: each((s) => s.drawP99) };
    out.short = out.rounds < ROUNDS;
    out.void = !(aa((s) => s.latePct) <= AA_POINTS && aa((s) => s.gapP99) < BAR_MS);
    out.saturated = out.drawP99.page > period / 2;
    out.decided = exact && !out.short && !out.void && !out.saturated;
    // (a) The wait was the read: settled by the read the view worker's draw waits out the task; by the fence it does not.
    out.readWaits = out.drawP99["worker-read"] >= WAITED_MS && out.drawP99.worker <= period / 2;
    // (b) §7's cine rule on the fence arms.
    out.pageMisses = out.latePct.page > AA_POINTS;
    out.workerOnTime = out.latePct.worker <= AA_POINTS && out.gapP99.worker <= 2 * out.period;
    return out;
  });
}

/** Per engine: whether every decided cell says the wait was the read, and whether B′ keeps cine on time where A misses. */
export function verdicts(rows) {
  const all = cells(rows);
  const engines = [...new Set(all.map((c) => c.engine))];
  return Object.fromEntries(engines.map((e) => {
    const decided = all.filter((c) => c.engine === e && c.decided);
    if (!decided.length) return [e, { decided: 0, read: "undecided: no decided cell", cine: "undecided: no decided cell" }];
    const missed = decided.filter((c) => c.pageMisses);
    return [e, {
      decided: decided.length,
      read: decided.every((c) => c.readWaits) ? "the wait was the read" : decided.some((c) => c.readWaits) ? "mixed" : "not the read",
      cine: !missed.length ? "A on time in every decided cell: nothing to keep" : missed.every((c) => c.workerOnTime) ? "B′ keeps cine on time where A misses" : "B′ misses where A misses",
    }];
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const f = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(d));
  const each = (o, d) => ARMS.map((a) => `${a} ${f(o[a], d)}`).join(" / ");
  for (const c of cells(rows)) {
    const guards = [c.void && "VOID", c.short && `short (${c.rounds} rounds)`, c.saturated && "saturated", !c.exact && "NOT EXACT"].filter(Boolean).join(", ") || "decided";
    console.log(`${c.key}: ${guards}\n  late ${each(c.latePct)} %\n  gap p99 ${each(c.gapP99)} ms\n  draw p99 ${each(c.drawP99)} ms`);
  }
  for (const [e, v] of Object.entries(verdicts(rows))) console.log(`${e} (${v.decided} decided): ${v.read}; ${v.cine}`);
}
