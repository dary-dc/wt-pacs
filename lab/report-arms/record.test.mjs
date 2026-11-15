// node lab/report-arms/record.test.mjs — every record the harness makes carries only listed fields, a reportId and
// the schema version; a delta carries what changed since the last send and the next seq; a safety record carries
// the frame's check and never a UID.
import { readFileSync } from "node:fs";
import { Load, safetyRecord } from "./record.js";

const FIELDS = JSON.parse(readFileSync(new URL("./report-fields.json", import.meta.url)));
let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));
const outside = (r) => Object.keys(r).filter((k) => !FIELDS[r.kind].includes(k));

const ctx = { load: "L1", session: "S1", build: "b1", source: "f00d", frameCount: 4, codec: "htj2k" };
const l = new Load(ctx);
l.frame({ i: 0, route: "htj2k", kb: 10, decodeMs: 2 });
l.frame({ i: 1, route: "htj2k", kb: 11, decodeMs: 3 });
const full = l.record();
check(outside(full).length === 0, `the load record's fields are listed: ${outside(full)}`);
check(full.v === FIELDS.v && full.kind === "load" && full.seq === 0, "the first record: v, kind load, seq 0");
check(typeof full.reportId === "string" && full.reportId.length >= 32, "a reportId on the load record");
check(full.received === 2 && full.routes.htj2k === 2 && full.frames.length === 2, "the fill's frames and routes");

const none = l.delta();
check(none === null, "a delta with nothing changed is no record");
l.press({ at: 5, text: "Lossless" });
const d = l.delta();
check(d && d.seq === 1 && d.presses.length === 1 && !("frames" in d), "a delta: the next seq, the press, no frames");
check(d.reportId !== full.reportId && outside(d).length === 0, "a delta is its own record, listed fields only");
l.press({ at: 6, text: "Lossless" });
check(l.delta().presses.length === 1, "a second delta carries only the press since the first");
l.check("htj2k", true);
l.check("htj2k", false);
check(l.delta().checks.htj2k.checked === 2 && l.record().checks.htj2k.failed === 1, "checks per route, the denominator");

const s = safetyRecord(ctx, { frame: 10, route: "htj2k", check: "xxh3", expected: "aa", actual: "ab", secondDecode: true,
                               followed: "rescued", at: 123 }, { engine: "Chrome/153", hardwareConcurrency: 4 });
check(s.kind === "safety" && outside(s).length === 0 && s.frame === 10 && s.reportId, "the safety record's fields");
check(!JSON.stringify(s).match(/1\.2\.840/), "no UID in the safety record");
check(s.load === "L1" && s.session === "S1" && s.source === "f00d", "the safety record keys: load, session, source");

if (failed) process.exit(1);
console.log("report-arms: the records' fields, deltas and safety record hold");
