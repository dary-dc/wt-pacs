/** The proxy's measures, the same for both options: each option reports a frame painted, and says how to step and play. */
import { seen } from "./instrument.js";

/** ms: a step is on time when its frame is painted within two display periods of the step. */
const STEP_ON_TIME_MS = 2 * (1000 / 60);

export function measure() {
  const paints = [];
  const waiters = new Map();
  let filledAt = null;
  return {
    /** Frame `i` painted at page time `t`: option A's IMAGE_RENDERED, option B's `shown` (or its worker's own clock in a cine). */
    painted(i, t) {
      paints.push({ i, t });
      waiters.get(i)?.(t);
      waiters.delete(i);
    },
    filled: () => (filledAt = performance.now()),
    handle: ({ step, play, pause, cineLog }) => ({
      ready: () => filledAt !== null,
      /** The first frame-0 paint, ms from navigation: every frame is checked exact before either option may paint it. */
      firstExact: () => paints.find((p) => p.i === 0)?.t ?? null,
      filledAt: () => filledAt,
      /** Steps through `order`, one every `everyMs`; each step's latency to its frame's paint, null if never painted. */
      async scroll(order, everyMs) {
        const out = [];
        for (const i of order) {
          const t0 = performance.now();
          const painted = new Promise((r) => waiters.set(i, r));
          step(i);
          const t = await Promise.race([painted, new Promise((r) => setTimeout(() => r(null), 1000))]);
          out.push(t === null ? null : t - t0);
          await new Promise((r) => setTimeout(r, Math.max(0, t0 + everyMs - performance.now())));
        }
        return { onTime: out.filter((l) => l !== null && l <= STEP_ON_TIME_MS).length / out.length, latencies: out };
      },
      /** Plays `n` frames' series for `ms`: frame k is due k periods after the first paint, and on time within one period of it. */
      async cine(fps, ms, n) {
        const from = paints.length;
        await play(fps);
        await new Promise((r) => setTimeout(r, ms));
        await pause();
        const log = cineLog ? await cineLog() : paints.slice(from);
        const period = 1000 / fps;
        let k = 0, onTime = 0;
        log.forEach((p, m) => {
          if (m) k += (((p.i - log[m - 1].i) % n) + n) % n;
          if (p.t - (log[0].t + k * period) <= period) onTime++;
        });
        return { onTime: onTime / Math.floor((ms / 1000) * fps), painted: log.length };
      },
      longTasks: (from = 0) => seen.longTasks.filter((t) => t.start >= from).reduce((s, t) => s + t.ms, 0),
      /** Every thread's memory where the browser gives it (cross-origin isolated pages only); null where it does not. */
      memory: () => performance.measureUserAgentSpecificMemory?.().then((r) => r.bytes, () => null) ?? null,
    }),
  };
}
