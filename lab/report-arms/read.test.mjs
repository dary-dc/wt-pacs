// node lab/report-arms/read.test.mjs — the read tool, the same for every receiver: one entry per load, second copies
// dropped by reportId and counted, unkeyed copies counted by content, fields outside the list named (never their
// values), NGINX's line form read as RECEIVER's, the server's link line joined by load.
import { readLines, byLoad } from "./read.mjs";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));

const load = (o) => ({ v: 1, kind: "load", load: "L1", seq: 0, ...o });
const sinkLine = (r) => JSON.stringify({ t: 1, r });
const nginxLine = (r) => JSON.stringify({ t: "2026-11-15T12:00:00+00:00", s: "204", n: "9", r: JSON.stringify(r) });
const lines = [
  sinkLine(load({ reportId: "a", frames: [] })),
  sinkLine(load({ reportId: "a", frames: [] })),
  nginxLine(load({ reportId: "b", seq: 1, presses: [{ at: 1 }] })),
  sinkLine({ v: 1, kind: "safety", load: "L1", reportId: "s1", frame: 10, secret: "VALUE" }),
  sinkLine(load({ load: "L2", seq: 0 })),
  sinkLine(load({ load: "L2", seq: 0 })),
  JSON.stringify({ v: 1, kind: "link", load: "L1", rtt_us: 20000 }),
  "{broken",
  JSON.stringify({ t: "x", s: "204", n: "12011", r: "" }),
  JSON.stringify({ t: "x", s: "204", n: "4", r: "null" }),
];
const recs = readLines(lines);
check(recs.malformed === 3, `a broken line, NGINX's empty body and a null counted malformed: ${recs.malformed}`);
const loads = byLoad(recs.records);
const l1 = loads.get("L1");
check(l1.records.length === 2 && l1.duplicates === 1, "L1: a's second copy dropped and counted");
check(l1.seqs.join() === "0,1", "L1: the fill record and the delta, by seq, NGINX's line included");
check(l1.safety.length === 1 && l1.safety[0].frame === 10, "L1's safety report");
check(l1.outside.join() === "safety.secret" && !JSON.stringify(l1.outside).includes("VALUE"), "the outside field named");
check(l1.link?.rtt_us === 20000, "the server's link line joined by load");
const l2 = loads.get("L2");
check(l2.unkeyed === 2 && l2.duplicates === 1 && l2.records.length === 1, "no reportId: copies found by content");
check(l2.link === null, "a load with no link line says so");

if (failed) process.exit(1);
console.log("report-arms: the read tool's dedup, join and field check hold");
