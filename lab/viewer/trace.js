/** The lab's scroll trace and what its steps measure: docs/adr/frame-path.md §3, *Experiment 2* */

/** ms between steps: 25 slices/s. */
export const STEP_MS = 40;

/** MAP's drilling trace: 0 → ⌊n/3⌋ → 0, `strokes` times, one frame a step; frame 0, already shown, is not a step. */
export function sawtooth(n, strokes = 3) {
  const top = Math.floor(n / 3);
  const stroke = [...Array.from({ length: top }, (_, k) => k + 1), ...Array.from({ length: top }, (_, k) => top - 1 - k)];
  return Array.from({ length: strokes }, () => stroke).flat();
}

/**
 * Each step's wait, ms from the step to its frame held, 0 if held at the step and null if never; the means over the
 * steps up and down, null if any is; `live`, the share of steps up whose frame was not held at the step; and
 * `missingMs`, the mean time a step's frame was missing before the next step, which is defined on demand too.
 */
export function waits(steps, held) {
  let from = 0;
  const all = steps.map(({ i, at }, k) => {
    const up = i > from;
    from = i;
    const ms = held.has(i) ? Math.max(0, held.get(i) - at) : null;
    const until = k + 1 < steps.length ? steps[k + 1].at - at : STEP_MS;
    return { up, ms, missing: Math.min(ms ?? Infinity, until) };
  });
  const mean = (xs) => (xs.some((x) => x === null) ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  const up = all.filter((s) => s.up);
  return {
    forwardMs: mean(up.map((s) => s.ms)),
    backwardMs: mean(all.filter((s) => !s.up).map((s) => s.ms)),
    live: up.filter((s) => s.ms !== 0).length / up.length,
    missingMs: mean(all.map((s) => s.missing)),
    waits: all.map((s) => (s.ms === null ? null : Math.round(s.ms))),
  };
}

/** Leg 0 climbs to `lo`, then `count` legs between `lo` and `lo + leg`, each ending in a turn: docs/reviews/page-runs.md §4 */
export function legPath({ lo = 0, leg, count, oneWay = false, short = false }, n) {
  if (oneWay) return Array.from({ length: n - 1 }, (_, k) => ({ i: k + 1, turn: false, leg: 1 }));
  const len = short ? leg - 1 : leg;
  if (lo + len >= n) throw new Error(`refused: legs ${lo} … ${lo + len} past ${n} frames`);
  const path = Array.from({ length: lo }, (_, k) => ({ i: k + 1, turn: false, leg: 0 }));
  for (let k = 1; k <= count; k++) {
    const from = k % 2 ? lo : lo + len;
    const dir = k % 2 ? 1 : -1;
    for (let j = 1; j <= len; j++) path.push({ i: from + dir * j, turn: j === len, leg: k });
  }
  return path;
}

/** Seconds each counted leg (from `from`) waited; `live`, its steps' share not held when due; `received`, frames that came. */
export function legWaits(steps, { from = 2, skip = 0 } = {}) {
  const counted = steps.filter((x) => x.leg >= from).slice(skip);
  const legs = [...new Set(counted.map((x) => x.leg))];
  const wait = (xs) => xs.reduce((a, x) => a + Math.max(0, x.heldMs - x.dueMs), 0) / 1000;
  const perLeg = legs.map((k) => wait(counted.filter((x) => x.leg === k)));
  const before = steps[steps.indexOf(counted[0]) - 1];
  return {
    perLeg,
    meanS: perLeg.reduce((a, b) => a + b, 0) / perLeg.length,
    live: counted.filter((x) => !x.heldAtDue).length / counted.length,
    received: counted.at(-1).received - (before?.received ?? 0),
  };
}
