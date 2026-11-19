// The protocol's cells as page parameters, and the checks each row carries: cache-plan.md §8.2–§8.4.
import { balanced } from "../order.mjs";

export const SIZES = { 512: [512, 512], 2560: [2560, 3328], 3328: [3328, 4096] };
export const HELD = 4;
const RATE_MBPS = 125;
const SECONDS = 10;
const W_MB = 1000;
const FLOOR = 20;
const MiB = 2 ** 20;

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
  if (["L", "R-busy", "B", "Q", "T"].includes(cell) && row.deliveredMBps !== undefined) out.delivered = row.deliveredMBps >= 0.95 * c.rateMBps;
  if (row.read && row.damagedAsked !== undefined) out.damageReported = row.read.damaged.includes(row.damagedAsked);
  if (row.opened && row.opened.writer === false) out.readerWroteNothing = (row.store ?? row.rest) !== undefined && (row.store?.storeWrites ?? 0) + (row.rest?.storeWrites ?? 0) === 0;
  return out;
}

/** The page's query: the mutant runs in the arm only, so `none` stays the clean reference of the bars. */
export const pageQuery = (p, mutant, pilot) => Object.fromEntries(Object.entries({ ...p, mutant: p.arm === "none" ? "" : mutant, pilot })
  .filter(([, v]) => v !== "" && v !== undefined));

/** An arm's picks: a frozen `pilot-<engine>.json` maps each arm's module to its own; a string is every arm's. */
export const pilotOf = (pilot, arm) => (typeof pilot === "string" ? pilot : pilot[moduleOf(arm)] ?? "");

/** An arm's writes in flight, by its pilot (1 unless `inflight` says more). */
export const inflightOf = (pilot) => Number(new URLSearchParams(pilot).get("inflight") ?? 1);

/** K: present on reopen ≥ written at the kill − the arm's writes in flight. */
export const keptOnReopen = (atKill, present, pilot) => present >= atKill.written - inflightOf(pilot);

/** Frames unwritten 5 s after the last arrival: sampled then, while the writer may still be behind. `posted()` →
 *  {count, lastAt} over the feeders, `due` the frames they post. */
export async function backlogAt5s({ due, posted, progress, now, sleep, timeoutMs }) {
  for (const t0 = now(); (await posted()).count < due && now() - t0 < timeoutMs; ) await sleep(20);
  await sleep(Math.max(0, (await posted()).lastAt + 5000 - now()));
  return { at: now(), ...(await progress()) };
}

/** The tree's peak PSS growth over a load, from a baseline taken once the page's floor probe is done. */
export async function pssGrowth({ load, floorDone, pss, everyMs = 500 }) {
  let row = null;
  const loading = load().then((r) => (row = r));
  const wait = () => Promise.race([loading, new Promise((r) => setTimeout(r, everyMs))]);
  while (!row && !(await floorDone().catch(() => false))) await wait();
  const baseline = pss();
  let peak = baseline;
  while (!row) (peak = Math.max(peak, pss())), await wait();
  return { row: await loading, pssGrowthMiB: peak - baseline };
}

const NO_BAR_MET = { missed: false, delayP99: false, delivered: false, backlog: false, pss: false, exact: false };

/** L's bars against the same round's `none` (§8.3), each met in ≥ 75 % of rounds, every frame exact in every round. */
export function lBars(rows, { frameBytes, pilot }) {
  const ref = new Map(rows.filter((r) => r.unit === "none" && !r.error).map((r) => [r.round, r]));
  const units = [...new Set(rows.map((r) => r.unit))];
  const out = {};
  for (const unit of units.filter((u) => u !== "none")) {
    const mine = rows.filter((r) => r.unit === unit);
    const met = mine.filter((r) => ref.has(r.round)).map((r) => {
      if (r.error) return NO_BAR_MET;
      const n = ref.get(r.round);
      return {
        missed: r.shown.missedShare <= n.shown.missedShare + 0.01,
        delayP99: r.shown.paintDelayP99 <= n.shown.paintDelayP99 + 4,
        delivered: r.deliveredMBps >= 0.95 * n.deliveredMBps,
        backlog: r.unwrittenAt5s === 0,
        pss: r.pssGrowthMiB <= n.pssGrowthMiB + (inflightOf(pilotOf(pilot, unit)) * frameBytes) / MiB + 64,
        exact: r.verify?.notOk === 0 && r.verify.ok > 0,
      };
    });
    const share = Object.fromEntries(Object.keys(NO_BAR_MET).map((k) => [k, met.filter((m) => m[k]).length / met.length]));
    const pass = met.length > 0 && share.exact === 1 && Object.values(share).every((v) => v >= 0.75);
    const unjudged = [...new Set(mine.filter((r) => !ref.has(r.round)).map((r) => r.round))];
    out[unit] = { rounds: met.length, share, pass, unjudged, balanced: balanced(rows, unit, units) };
  }
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
