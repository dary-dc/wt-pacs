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

/** One Long Task entry on the `performance.now()` clock, in µs. */
export type LongTaskSpan = { start_us: Us; end_us: Us };

function toSpan(entry: PerformanceEntry): LongTaskSpan {
  return {
    start_us: Math.round(entry.startTime * 1000),
    end_us: Math.round((entry.startTime + entry.duration) * 1000),
  };
}

/**
 * Watch Long Tasks (main-thread tasks over 50 ms). A `read()` that resolves during one is
 * stamped late by the browser being busy, not by the network — so each entry is kept with
 * its span and matched against rows at finish. `stop()` collects entries the observer has
 * not delivered yet (delivery is asynchronous) and disconnects.
 */
export function watchLongTasks(onSpan: (span: LongTaskSpan) => void): () => LongTaskSpan[] {
  try {
    if (typeof PerformanceObserver === "undefined") return () => [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) onSpan(toSpan(entry));
    });
    observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    return () => {
      let pending: LongTaskSpan[] = [];
      try {
        pending = observer.takeRecords().map(toSpan);
        observer.disconnect();
      } catch {
        /* ignore */
      }
      return pending;
    };
  } catch {
    return () => [];
  }
}

/** Length of the overlap between two closed intervals, in µs (0 when disjoint). */
export function overlapUs(a0: Us, a1: Us, b0: Us, b1: Us): Us {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return hi > lo ? hi - lo : 0;
}
