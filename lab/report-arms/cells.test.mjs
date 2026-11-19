// node lab/report-arms/cells.test.mjs — cells L and C (report-plan.md §7.3). L: each fault's latency is its first
// record's append time less the fault's stamp, the record joined to the latest fault at or before its own `at`, a
// second copy ignored, a fault with no record lost. C: the page thread's time from a record's assembly to the
// carrier's return, and in each page-side safety send, summed per load.
import { latencies, quantile, meter } from "./cells.js";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));

{
  const faults = [100, 1100, 2100];
  const line = (t, r) => JSON.stringify({ t, r: { kind: "safety", load: "L", ...r } });
  const lines = [
    line(1180, { reportId: "b", at: 1105 }),
    line(140, { reportId: "a", at: 104 }),
    line(1300, { reportId: "b", at: 1105 }),
    line(900, { reportId: "x", at: 104, load: "other" }),
    JSON.stringify({ t: 50, r: { kind: "load", load: "L", reportId: "l" } }),
  ];
  const l = latencies(faults, lines, "L");
  check(JSON.stringify(l) === JSON.stringify([40, 80, null]), `latencies: joined by at, first copy, a loss null (${JSON.stringify(l)})`);
  const s = latencies([100], [JSON.stringify({ t: 130, r: JSON.stringify({ kind: "safety", load: "L", reportId: "n", at: 101 }) })], "L");
  check(s[0] === 30, "latencies: a body kept as a string (NGINX's) read too");
  check(latencies([100], [JSON.stringify({ t: "2026-11-19T12:00:00+00:00", r: { kind: "safety", load: "L", reportId: "n", at: 101 } })], "L")[0] === null,
    "latencies: a time not in milliseconds gives no latency");
}
{
  check(quantile([5, 1, 3, 2, 4], 0.5) === 3, "quantile: the median");
  check(quantile([1, 2, 3, 4, 100], 0.99) === 100, "quantile: p99 of five is the largest");
  check(quantile([null, 2], 0.5) === null, "quantile: a loss leaves no latency");
}
{
  let t = 0;
  const clock = () => t;
  const load = { record: () => { t += 2; return { seq: 0 }; }, delta: () => { t += 1; return { seq: 1 }; } };
  const carrier = { load: () => { t += 3; }, safety: () => { t += 5; } };
  const m = meter(load, carrier, clock);
  m.carrier.load(JSON.stringify(m.load.record()));
  check(m.ms() === 5, `meter: assembly and send of a whole record (${m.ms()})`);
  m.carrier.load(JSON.stringify(m.load.delta()));
  check(m.ms() === 9, `meter: a delta too (${m.ms()})`);
  m.timed(() => { t += 4; m.carrier.safety("{}"); });
  check(m.ms() === 18, `meter: a page-side safety send, its carrier call once (${m.ms()})`);
  m.carrier.safety("{}", true);
  check(m.ms() === 23, `meter: a worker's report handed to the carrier (${m.ms()})`);
  check(m.sends() === 4, `meter: four sends (${m.sends()})`);
  const empty = meter({ record: () => null, delta: () => { t += 7; return null; } }, carrier, clock);
  empty.load.delta();
  t += 100;
  empty.carrier.load("{}");
  check(empty.ms() === 3, `meter: an empty delta opens nothing (${empty.ms()})`);
}

if (failed) process.exit(1);
console.log("report-arms: cells L and C read what §7.3 says");
