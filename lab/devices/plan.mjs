// What a device evening runs, in what order, and the reading it prints: docs/devices.md §2–3, lab/devices/README.md.
import { order } from "../order.mjs";

/** D1's sets (docs/devices.md §2 D1): each as HTJ2K and as AV1 in the layout rows 44 and 182 chose. */
export const D1_SETS = ["dbt10_ea1141", "mr_ispy1", "rf_fluoro"];
export const D1_ARMS = ["htj2k", "dav1d", "webcodecs"];

/** Quick mode answers the evening's first questions in about 15 minutes: the largest frames on every decoder,
 *  and today's server against the two levers (the 12 000-byte arm is today's default again, an A/A for later). */
export const QUICK = { rounds: 3, d1Sets: ["dbt10_ea1141"], d2Arms: ["shared", "asksfirst", "iw38400"] };
export const FULL = { rounds: 10, d1Sets: D1_SETS, d2Arms: null };

/** Every visit of a run, round by round in a Williams order, each knowing the arm before it in its round. */
export function schedule(arms, rounds, first = 0) {
  const visits = [];
  for (let round = first; round < first + rounds; round++) {
    let prev = null;
    for (const arm of order(arms, round)) {
      visits.push({ round, arm, prev });
      prev = arm;
    }
  }
  return visits;
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Each arm against `ref` on `metric`: the median of in-round ratios and their range, over pairs where neither
 *  visit is void (not exact, or failed). rows: { round, arm, exact, error?, [metric] }. */
export function reading(rows, ref, metric) {
  const ok = (r) => r && r.exact === true && !r.error && Number.isFinite(r[metric]);
  const at = (arm, round) => rows.find((r) => r.arm === arm && r.round === round);
  const arms = [...new Set(rows.map((r) => r.arm))].filter((a) => a !== ref);
  return arms.map((arm) => {
    const rounds = [...new Set(rows.filter((r) => r.arm === arm).map((r) => r.round))];
    const ratios = [];
    let voided = 0;
    for (const round of rounds) {
      const a = at(arm, round);
      const b = at(ref, round);
      if (ok(a) && ok(b)) ratios.push(a[metric] / b[metric]);
      else voided++;
    }
    return ratios.length
      ? { arm, ref, metric, n: ratios.length, voided, median: median(ratios), lo: Math.min(...ratios), hi: Math.max(...ratios) }
      : { arm, ref, metric, n: 0, voided };
  });
}

/** One line a reading, as the phone's screen shows it. */
export const line = (r) =>
  r.n
    ? `${r.arm}/${r.ref} ${r.metric}: ×${r.median.toFixed(3)} [${r.lo.toFixed(3)}–${r.hi.toFixed(3)}] n=${r.n}${r.voided ? `, ${r.voided} void` : ""}`
    : `${r.arm}/${r.ref} ${r.metric}: no pair (${r.voided} void)`;
