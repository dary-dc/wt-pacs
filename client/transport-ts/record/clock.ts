/** Clock helpers for the client recorder. */

import type { Us } from "./types.ts";

export function nowUs(): Us {
  return Math.round(performance.now() * 1000);
}

export type ClockProbe = {
  /** Smallest positive delta observed, in µs. */
  resolution_us: number | null;
  /** Wall cost of the probe itself, in µs. */
  probe_cost_us: number;
};

/**
 * Cheap resolution probe — running minimum, no sample array / sort.
 * Intended to run at finish() (or explicitly before install_t0), never in the
 * constructor on the connect path.
 */
export function probeClockResolution(iterations = 2_000): ClockProbe {
  const t0 = performance.now();
  let prev = t0;
  let minDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    const d = t - prev;
    if (d > 0 && d < minDelta) minDelta = d;
    prev = t;
  }
  const probe_cost_us = Math.round((performance.now() - t0) * 1000);
  return {
    resolution_us:
      minDelta === Number.POSITIVE_INFINITY ? null : Math.round(minDelta * 1000),
    probe_cost_us,
  };
}

/** Returns a disconnect function; no-op when longtask is unavailable. */
export function watchLongTasks(onCount: (n: number) => void): () => void {
  try {
    if (typeof PerformanceObserver === "undefined") return () => {};
    let total = 0;
    const observer = new PerformanceObserver((list) => {
      total += list.getEntries().length;
      onCount(total);
    });
    observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    return () => {
      try {
        observer.disconnect();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return () => {};
  }
}
