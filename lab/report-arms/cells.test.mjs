// node lab/report-arms/cells.test.mjs — cells L and C (report-plan.md §7.3). L: each fault's latency is its first
// record's append time less the fault's stamp, the record joined to the latest fault at or before its own `at`, a
// second copy ignored, a fault with no record lost. C: the page thread's time from a record's assembly to the
// carrier's return, and in each page-side safety send, summed per load. The floor: each bare call's append time less
// its call, joined by its own load id, and the page thread's time in the call; medians, the undelivered counted.
// Y: a load's records at the receiver, copies included, and their bytes as received.
import { latencies, quantile, meter, floorTimes, bodies } from "./cells.js";

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
{
  const floors = [{ load: "f1", at: 100, callMs: 0.2 }, { load: "f2", at: 300, callMs: 0.4 }, { load: "f3", at: 500, callMs: 0.3 }];
  const lines = [JSON.stringify({ t: 103, r: { kind: "load", load: "f1" } }), JSON.stringify({ t: 309, r: { kind: "load", load: "f2" } }),
                 JSON.stringify({ t: 301, r: { kind: "load", load: "f2" } }), JSON.stringify({ t: 700, r: { kind: "load", load: "zz" } })];
  const f = floorTimes(floors, lines);
  check(f.n === 3 && f.delivered === 2, `floor: three calls, two delivered (${JSON.stringify(f)})`);
  check(f.appendMs === 1, `floor: the median over the delivered, the first copy each (${f.appendMs})`);
  check(f.callMs === 0.3, `floor: the median page-thread time in the call (${f.callMs})`);
  check(floorTimes([], lines).appendMs === null, "floor: none run, no time");
}
{
  const recs = [{ kind: "load", load: "L", seq: 0 }, { kind: "load", load: "L", seq: 1, x: "abcdef" }, { kind: "safety", load: "L" },
                { kind: "load", load: "M", seq: 0 }, { kind: "link", load: "L", rtt_us: 1 }];
  const y = bodies(recs, "L");
  const len = (o) => JSON.stringify(o).length;
  check(y.records === 3 && y.bytes === len(recs[0]) + len(recs[1]) + len(recs[2]), `Y: the load's records and their bytes, no link line (${JSON.stringify(y)})`);
  check(y.largest === len(recs[1]), "Y: the largest body, not the first");
}

if (failed) process.exit(1);
console.log("report-arms: cells L and C read what §7.3 says");
