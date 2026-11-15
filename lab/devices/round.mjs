/** The round's rules, shared by the viewer's hook and its tests: lab/devices/README.md §The round */

/** ms: the runner's timer period, and the gap between two ticks that marks a load stopped (next-round.md §3). */
export const TICK_MS = 250;
export const STOPPED_GAP_MS = 2000;

/** Why a filled load failed, or null: every frame received and no error. */
export function fillFailure({ error, frames = [], errors = [] }, frameCount) {
  if (error) return error;
  if (frames.length < frameCount) return `received ${frames.length} of ${frameCount}`;
  return errors[0] ?? null;
}

/** The largest gap between consecutive ticks, ms. */
export const largestGap = (ticks) => ticks.reduce((g, t, k) => (k ? Math.max(g, t - ticks[k - 1]) : g), 0);

/** A load's verdict: `failure` its reason or null; a gap past the bar makes it VOID whatever else happened. */
export function verdict(failure, gapMs) {
  if (gapMs > STOPPED_GAP_MS) return { ok: false, void: "stopped", why: `the runner's timers stopped ${Math.round(gapMs)} ms`, gapMs };
  return failure ? { ok: false, why: failure, gapMs } : { ok: true, gapMs };
}

const until = (done, ms) => new Promise((resolve) => {
  const t0 = performance.now();
  const poll = setInterval(() => {
    const ok = done();
    if (ok || performance.now() - t0 > ms) (clearInterval(poll), resolve(Boolean(ok)));
  }, 20);
});

/** One exact frame asked and back to the view, as a reader presses: why not, or null. */
export async function losslessFailure(quality, lossless, { losslessMs = 30000, optimalMs = 10000 } = {}) {
  const shown = () => `${quality.className || "none"} (${quality.textContent})`;
  if (!(await until(() => quality.className === "optimal", 10000))) return `label ${shown()} after the fill, not optimal`;
  if (!(await until(() => !lossless.hidden, 10000))) return "no lossless button: the exact series did not connect";
  lossless.click();
  if (!(await until(() => ["lossless", "failed"].includes(quality.className), losslessMs))) return `no Lossless ${losslessMs / 1000} s after the press: ${shown()}`;
  if (quality.className !== "lossless") return `lossless pressed: ${shown()}`;
  lossless.click();
  return (await until(() => quality.className === "optimal", optimalMs)) ? null : `not Optimal quality ${optimalMs / 1000} s after the second press: ${shown()}`;
}

/** next-round.md §4's series and arms; the round's loads in order: the warm-ups, cell 2's rounds, cell 3's pairs. */
export const SERIES = ["dbts_b1-q8-g8", "dbts_a1-q8-g8-cut"];
export const ARMS = ["A", "B", "C1", "C2"];

export async function roundOrder({ rounds = 16, pairs = 24 } = {}) {
  const { order } = await import("../order.mjs");
  const warmUps = [["A", "page"], ["A", "page"], ["A", "worker"], ["A", "worker"]].map(([arm, view]) => ({ cell: "2", arm, view, series: SERIES[0], counted: false }));
  const cell2 = Array.from({ length: rounds }, (_, r) => order(ARMS, r).map((arm) => ({ cell: "2", arm, view: "page", series: SERIES[r % 2], round: r, counted: true })));
  const abba = (p) => (p % 2 ? ["worker", "page"] : ["page", "worker"]);
  const cell3 = Array.from({ length: pairs }, (_, p) => abba(p).map((view) => ({ cell: "3", arm: view, view, series: SERIES[0], pair: p, seq: "view", counted: true })));
  return [...warmUps, ...cell2.flat(), ...cell3.flat()];
}
