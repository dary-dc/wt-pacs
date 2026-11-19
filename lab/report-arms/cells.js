// Cells L and C's readings (report-plan.md §7.3), the same for every arm.

/** L: per fault stamp, ms from it to its first record's append; the latest stamp at or before a record's `at` is its
 * fault. Sink and RECEIVER lines carry `t` in ms; NGINX's ISO second gives none. */
export function latencies(faults, lines, load) {
  const first = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    const r = typeof o.r === "string" ? JSON.parse(o.r) : o.r;
    if (r?.kind !== "safety" || r.load !== load) continue;
    const fault = faults.findLast((f) => f <= r.at);
    if (fault === undefined) continue;
    const t = typeof o.t === "number" ? o.t : NaN;
    const was = first.get(fault);
    if (!was || t < was.t || Number.isNaN(was.t)) first.set(fault, { t });
  }
  return faults.map((f) => (first.has(f) && !Number.isNaN(first.get(f).t) ? first.get(f).t - f : null));
}

/** The nearest-rank quantile; a loss (null) leaves none. */
export function quantile(xs, q) {
  if (xs.some((x) => x === null)) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)];
}

/** C: the page thread's ms from a record's assembly to the carrier's return, and in each `timed` page-side send. */
export function meter(load, carrier, clock = () => performance.now()) {
  let total = 0, sends = 0, from = null, inTimed = false;
  const open = () => { from ??= clock(); };
  const close = () => { total += clock() - from; from = null; sends++; };
  // A delta with nothing in it is no send: SESSION's tick asks one every second.
  const assembled = (f) => () => { const t0 = clock(); const r = f(); if (r) from ??= t0; return r; };
  const send = (f) => (...a) => { open(); try { return f(...a); } finally { if (!inTimed) close(); } };
  return {
    load: { record: assembled(() => load.record()), delta: assembled(() => load.delta()) },
    carrier: { ...carrier, load: send(carrier.load.bind(carrier)), safety: send(carrier.safety.bind(carrier)) },
    timed: (f) => { open(); inTimed = true; try { return f(); } finally { inTimed = false; close(); } },
    ms: () => total,
    sends: () => sends,
  };
}

/** The floor beside L and C (§7.2): per bare call, its first append less its call, joined by its own load id. */
export function floorTimes(floors, lines) {
  const first = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    const r = typeof o.r === "string" ? JSON.parse(o.r) : o.r;
    if (typeof o.t === "number" && r?.load && (!first.has(r.load) || o.t < first.get(r.load))) first.set(r.load, o.t);
  }
  const appends = floors.filter((f) => first.has(f.load)).map((f) => first.get(f.load) - f.at);
  return { n: floors.length, delivered: appends.length, appendMs: appends.length ? quantile(appends, 0.5) : null,
           callMs: floors.length ? quantile(floors.map((f) => f.callMs), 0.5) : null };
}

/** Y, as far as the receiver sees it: a load's records, copies included, their bytes as one JSON line each. */
export function bodies(records, load) {
  const sizes = records.filter((r) => r.load === load && r.kind !== "link").map((r) => JSON.stringify(r).length);
  return { records: sizes.length, bytes: sizes.reduce((a, b) => a + b, 0), largest: Math.max(0, ...sizes) };
}
