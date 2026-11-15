// The protocol's cells as page parameters, and the checks each row carries: cache-plan.md §8.2–§8.4.
export const SIZES = { 512: [512, 512], 2560: [2560, 3328], 3328: [3328, 4096] };
export const HELD = 4;
const RATE_MBPS = 125;
const SECONDS = 10;
const W_MB = 1000;
const FLOOR = 20;

/** An arm's module: `OPFS-SYNC` and its A/A twin `OPFS-SYNC-aa` both load `arms/opfs-sync.js`. */
export const moduleOf = (arm) => arm.replace(/-aa$/, "").toLowerCase();

/** The page's query for one arm in one cell at one size. */
export function params(cell, size, arm, extra = {}) {
  const [w, h] = SIZES[size];
  const mb = (w * h * 2) / 1e6;
  const base = { arm: moduleOf(arm), w, h, held: HELD, cineEvery: size === "512" ? 1 : 6, series: `${cell}-${size}`, floor: arm === "none" ? 0 : FLOOR };
  const late = { ...base, n: HELD + Math.ceil((RATE_MBPS * SECONDS) / mb), rate: RATE_MBPS };
  const by = {
    L: late,
    W: { ...base, n: HELD + Math.ceil(W_MB / mb), credits: 3 },
    "R-idle": { ...base, n: HELD + 32, credits: 3, misses: "idle", missCount: 16, cineEvery: 0 },
    "R-busy": { ...late, misses: "busy", missCount: 16 },
    B: { ...late, misses: "busy", missCount: 16, longTasks: 1 },
    O: { ...base, n: size === "512" ? 256 : 32, credits: 3, floor: 0 },
    E: { ...base, n: 20, credits: 3, floor: 0 },
    K: { ...base, n: 64, credits: 3, floor: 0 },
    Q: { ...base, n: 50, rate: RATE_MBPS, ballast: 1, floor: 0 },
    T: { ...base, n: 50, rate: RATE_MBPS, floor: 0 },
    P: { ...base, n: 32, credits: 3, floor: 0 },
  };
  return { ...by[cell], ...extra };
}

/** Per row, what a mutant must break: every frame exact, nothing unwritten at +5 s, the rate delivered, a damaged
 *  frame reported, a reading tab writing nothing. The bars against `none` are the summary's, over a round. */
export function checks(cell, row) {
  if (row.error) return { ran: false };
  const c = row.config ?? {};
  const out = { ran: true };
  if (row.verify) out.exact = row.verify.notOk === 0 && row.verify.ok > 0;
  if (row.unwrittenAt5s !== undefined) out.allWritten = row.unwrittenAt5s === 0;
  if (cell === "L" || cell === "Q" || cell === "T") out.delivered = row.deliveredMBps >= 0.95 * c.rateMBps;
  if (row.read && row.damagedAsked !== undefined) out.damageReported = row.read.damaged.includes(row.damagedAsked);
  if (row.opened && row.opened.writer === false) out.readerWroteNothing = row.store?.storeWrites === 0 && (row.rest?.storeWrites ?? 0) === 0;
  return out;
}

/** The sets on disk the cell E's sequence must leave after each open (§8.3). */
export const E_STEPS = [
  { tab: 1, series: "A", expect: ["A"] },
  { tab: 2, series: "B", expect: ["A", "B"], hold: true },
  { tab: 1, series: "C", expect: ["B", "C"] },
  { tab: 1, series: "D", expect: ["B", "D"] },
  { tab: 1, series: "A", expect: ["A", "D"], afterClosing: 2 },
];
export const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join();
