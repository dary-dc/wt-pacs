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
