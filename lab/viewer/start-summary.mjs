// docs/adr/frame-path.md §7, *The view worker's start, timed*: where each arm's first frame goes, step by step, and
// the corrected bars — latency the first exact frame, throughput the fill after it — over run.mjs's quiet rows.
//   node lab/viewer/start-summary.mjs rows.jsonl [more.jsonl ...]
import { readFileSync } from "node:fs";
import { median } from "../frame-clock/measure.js";

/** ms: one 60 Hz frame. */
const BAR_MS = 16.7;
const FILL = [0.98, 1.02];
/** The browser cores' busy share at or past which a window is saturated. */
const SATURATED = 0.95;
const ROUNDS = 12;
/** The stamps in the order a start passes them; an arm lacks the ones that are not its own. */
export const STEPS = ["metadata", "viewWorker", "viewEvaluated", "viewStart", "viewGl", "gl", "connect", "viewConnect", "downloaderEvaluated",
  "downloaderStart", "dialReceived", "dial", "decodersReady", "sessionOpen", "firstIn", "firstHeld", "firstDrawn"];

/** Busy share of the cores over [from, to] epoch ms, from the samples bracketing it; null where none bracket it. */
export function busyShare(samples, from, to) {
  const a = samples.findLast((s) => s[0] <= from);
  const b = samples.find((s) => s[0] >= to);
  if (!a || !b || b[2] === a[2]) return null;
  return +((b[1] - a[1]) / (b[2] - a[2])).toFixed(3);
}

/** Each stamp of a row from navigation, the first exact frame held and drawn among them. */
const stamps = (r) => ({ ...r.boot, firstHeld: r.firstHeldMs, firstDrawn: r.firstMs });
/** ms: the fill after the first exact frame, the last held less the first. */
const afterFirst = (r) => r.lastHeldMs - r.firstHeldMs;
const kept = (r) => !r.void && !r.errors?.length && !r.failures && r.frames > 0 && r.exact === r.frames && r.boot;

/** Each cell's arms paired by round against `page`, with its A/A guard, its saturation guard and each arm's two bars. */
export function cells(rows, arms) {
  const byCell = new Map();
  for (const r of rows.filter((r) => !r.busy && !r.asks && !r.cineS)) {
    const key = [r.engine, r.set, `${r.throttle}x`].join(" ");
    if (!byCell.has(key)) byCell.set(key, { key, engine: r.engine, rows: [] });
    byCell.get(key).rows.push(r);
  }
  return [...byCell.values()].map((c) => {
    const all = Object.fromEntries(arms.map((a) => [a, new Map(c.rows.filter((r) => r.variant === a && kept(r)).map((r) => [r.round, r]))]));
    const rounds = [...all.page.keys()].filter((k) => arms.every((a) => all[a].has(k))).sort((x, y) => x - y).slice(0, ROUNDS);
    const paired = (a, f) => rounds.map((k) => f(all[a].get(k), all.page.get(k)));
    const of = (a, f) => median(rounds.map((k) => f(all[a].get(k))).filter((v) => v !== null && v !== undefined));
    const oneFrame = c.rows[0].owed === 1;
    const first = (a) => median(paired(a, (x, y) => x.firstMs - y.firstMs));
    const fill = (a) => (oneFrame ? null : median(paired(a, (x, y) => afterFirst(x) / afterFirst(y))));
    const out = { key: c.key, engine: c.engine, rounds: rounds.length, oneFrame, short: rounds.length < ROUNDS };
    out.void = Math.abs(first("pageaa")) >= BAR_MS || (!oneFrame && !(fill("pageaa") >= FILL[0] && fill("pageaa") <= FILL[1]));
    out.cores = { start: of("page", (r) => r.cores?.start), fill: oneFrame ? null : of("page", (r) => r.cores?.fill) };
    out.saturated = { start: out.cores.start >= SATURATED, fill: !oneFrame && out.cores.fill >= SATURATED };
    out.steps = Object.fromEntries(arms.map((a) => [a, Object.fromEntries(STEPS.map((s) => [s, of(a, (r) => stamps(r)[s])]).filter(([, v]) => !Number.isNaN(v)))]));
    out.arms = Object.fromEntries(arms.filter((a) => a !== "page" && a !== "pageaa").map((a) => {
      const d = first(a);
      const f = fill(a);
      return [a, {
        first: d,
        fill: f,
        latency: d >= BAR_MS ? "later" : d <= -BAR_MS ? "sooner" : "tie",
        throughput: oneFrame ? null : f > FILL[1] ? "slower" : f < FILL[0] ? "faster" : "tie",
      }];
    }));
    return out;
  });
}

/** An arm ties A when no decided bar of any cell finds it later or slower, and each engine has a decided latency. */
export function decide(rows, arms) {
  const all = cells(rows, arms);
  const decided = all.filter((c) => !c.void && !c.short);
  const verdicts = Object.fromEntries(arms.filter((a) => a !== "page" && a !== "pageaa").map((a) => {
    const behind = decided.flatMap((c) => [
      !c.saturated.start && c.arms[a].latency === "later" && `${c.key} first`,
      !c.oneFrame && !c.saturated.fill && c.arms[a].throughput === "slower" && `${c.key} fill`,
    ]).filter(Boolean);
    const undecided = [...new Set(all.map((c) => c.engine))].filter((e) => !decided.some((c) => c.engine === e && !c.saturated.start));
    const verdict = behind.length ? `behind A: ${behind.join(", ")}` : undecided.length ? `undecided: no latency decided in ${undecided.join(", ")}` : "ties A";
    return [a, verdict];
  }));
  return { cells: all, verdicts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const arms = [...new Set(rows.map((r) => r.variant))].sort((x, y) => (x === "page" ? -1 : y === "page" ? 1 : x.localeCompare(y)));
  const { cells: all, verdicts } = decide(rows, arms);
  const f = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(d));
  for (const c of all) {
    const guards = [c.void && "VOID", c.short && `short (${c.rounds} rounds)`, c.saturated.start && "start saturated", c.saturated.fill && "fill saturated"]
      .filter(Boolean).join(", ") || "decided";
    console.log(`${c.key}: ${guards}; busy start ${f(c.cores.start, 2)}, fill ${f(c.cores.fill, 2)}`);
    for (const [a, v] of Object.entries(c.arms)) {
      console.log(`  ${a} − page: first ${f(v.first, 1)} ms (${v.latency})${c.oneFrame ? "" : `, fill after it ×${f(v.fill, 3)} (${v.throughput})`}`);
    }
    for (const s of STEPS) {
      if (!arms.some((a) => c.steps[a][s] !== undefined)) continue;
      console.log(`  ${s.padEnd(20)} ${arms.map((a) => `${a} ${f(c.steps[a][s])}`).join(" / ")}`);
    }
  }
  for (const [a, v] of Object.entries(verdicts)) console.log(`${a}: ${v}`);
}
