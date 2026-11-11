/** A run's score and a cell's verdict, as pre-registered: docs/adr/frame-path.md §A frame clock in the view worker. */

import { LONG_TASK_MS } from "./busy.js";

/** ms: one display interval at 60 Hz, for a run with no vsync log. */
export const DISPLAY_MS = 1000 / 60;
/** Points of frames due, ms of gap p99, and a share of rounds. */
const AA_POINTS = 2;
const AA_GAP_MS = 16.7;
const LEAD_POINTS = 20;
const LEAD_ROUNDS = 11 / 14;

export const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return !s.length ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
export const p99 = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.ceil(0.99 * s.length) - 1] : NaN;
};

function nextVsync(vsyncs, t) {
  let [lo, hi] = [0, vsyncs.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vsyncs[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return vsyncs[lo];
}

/** Frames not on their tick, the gap p99 and the draw p99: lab/frame-clock/README.md §Scoring. */
export function score({ draws, vsyncs = [], t0, period, ms }) {
  // Frames due before t0 + ms; the epsilon keeps 1000 / (1000 / 60) from rounding to 59.
  const due = Math.ceil(ms / period - 1e-9);
  const sorted = [...draws].sort((a, b) => a.end - b.end);
  const shown = [];
  const drawMs = [];
  for (let k = 0; k < sorted.length; k++) {
    const d = sorted[k];
    if (d.i >= due) continue;
    drawMs.push(d.end - d.start);
    const at = nextVsync(vsyncs, d.end);
    const next = sorted[k + 1];
    const superseded = next !== undefined && (vsyncs.length ? at !== undefined && next.end < at : next.end - d.end < DISPLAY_MS);
    if (d.end >= t0 + d.i * period && d.end < t0 + (d.i + 1) * period && !superseded) shown.push(at ?? d.end);
  }
  const gaps = shown.slice(1).map((t, k) => t - shown[k]);
  return { due, late: due - shown.length, latePct: (100 * (due - shown.length)) / due, gapP99: p99(gaps), drawP99: p99(drawMs) };
}

export const voidRun = (run) => run.busy && (!run.tasks.length || Math.min(...run.tasks) < LONG_TASK_MS);

/** A cell's VOID, saturation and each worker arm's bar, from rows `{ round, arm, latePct, gapP99, drawP99 }` of runs not void. */
export function verdict(rows, { period, busy }) {
  const by = (arm) => new Map(rows.filter((r) => r.arm === arm).map((r) => [r.round, r]));
  const ref = by("page-raf");
  const paired = (arm, k) => [...by(arm)].filter(([round]) => ref.has(round)).map(([round, r]) => r[k] - ref.get(round)[k]);
  const aa = { late: median(paired("page-raf′", "latePct").map(Math.abs)), gap: median(paired("page-raf′", "gapP99").map(Math.abs)) };
  const out = {
    rounds: ref.size,
    aa,
    void: !(aa.late <= AA_POINTS && aa.gap < AA_GAP_MS),
    saturated: median([...ref.values()].map((r) => r.drawP99)) > period / 2,
    arms: {},
  };
  for (const arm of new Set(rows.map((r) => r.arm))) {
    if (!arm.startsWith("worker-")) continue;
    const late = paired(arm, "latePct");
    const gap = paired(arm, "gapP99");
    const wins = late.filter((d) => d <= -LEAD_POINTS).length;
    out.arms[arm] = {
      latePct: median([...by(arm).values()].map((r) => r.latePct)),
      passes: busy
        ? late.length > 0 && wins >= LEAD_ROUNDS * late.length && median([...by(arm).values()].map((r) => r.gapP99)) <= 2 * period
        : median(late) <= aa.late && median(gap) <= aa.gap,
    };
  }
  return out;
}

/** The engine's clock from its cells' verdicts, `{ series, busy, ...verdict }`: lab/frame-clock/README.md §The rule. */
export function rule(cells) {
  const decide = cells.filter((c) => c.series === "s512" && !c.void && !c.saturated);
  if (!decide.length) return { clock: null, why: "no 512² cell is neither VOID nor saturated" };
  const arms = Object.keys(decide[0].arms);
  const lateness = (arm) => median(decide.filter((c) => c.busy).map((c) => c.arms[arm]?.latePct ?? Infinity));
  const order = ["worker-raf", ...arms.filter((a) => a !== "worker-raf").sort((a, b) => lateness(a) - lateness(b))].filter((a) => arms.includes(a));
  const clock = order.find((arm) => decide.every((c) => c.arms[arm]?.passes));
  if (!clock) return { clock: "page", why: "no worker arm passes; the owner decides" };
  const reversed = cells.filter((c) => c.series !== "s512" && !c.void && !c.saturated && c.arms[clock] && !c.arms[clock].passes);
  return reversed.length ? { clock, reversed: reversed.map((c) => c.name) } : { clock };
}
