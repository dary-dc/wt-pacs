// node lab/report-arms/beacon/beacon.test.mjs — BEACON as report-plan.md §3.1 designs it: each record one sendBeacon,
// sent inside the call; a refused whole load record sent once more without its frames; a refused safety report kept,
// whole, and sent again on a 1 s timer and at the next hide, before any load record; the floor sends the same bytes.
import beacon from "./beacon.js";
import { floor } from "./floor.js";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));

function rig(answers = []) {
  const calls = [];
  const timers = [];
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const win = new EventTarget();
  const send = (url, body) => (calls.push([url, body]), answers.length ? answers.shift() : true);
  const timer = (fn, ms) => timers.push([fn, ms]);
  const hide = () => { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); };
  const arm = beacon({ base: "/report" }, { send, doc, win, timer });
  return { arm, calls, timers, hide, win, answers };
}
const whole = JSON.stringify({ kind: "load", reportId: "r1", seq: 0, frames: [{ i: 0 }], truncated: false });
const delta = JSON.stringify({ kind: "load", reportId: "r2", seq: 1, presses: [] });
const fault = (n) => JSON.stringify({ kind: "safety", reportId: `s${n}`, frame: n });

{
  const { arm, calls } = rig();
  arm.load(whole);
  check(calls.length === 1 && calls[0][0] === "/report/load" && calls[0][1] === whole, "load: one beacon, the body as given");
  arm.safety(fault(1));
  check(calls.length === 2 && calls[1][0] === "/report/safety" && calls[1][1] === fault(1), "safety: one beacon at once");
}
{
  const { arm, calls } = rig([false, true]);
  arm.load(whole);
  const again = JSON.parse(calls[1]?.[1] ?? "{}");
  check(calls.length === 2 && again.frames === null && again.truncated === true && again.reportId === "r1",
        "load: a refused whole record is sent once more without its frames, same reportId");
}
{
  const { arm, calls } = rig([false, false]);
  arm.load(whole);
  check(calls.length === 2, "load: a second refusal sends nothing more");
}
{
  const { arm, calls } = rig([false]);
  arm.load(delta);
  check(calls.length === 1, "load: a refused delta has no frames to drop, so is not sent again");
}
{
  const { arm, calls, timers } = rig([false, false]);
  arm.safety(fault(1));
  check(timers.length === 1 && timers[0][1] === 1000, "safety: a refusal keeps it and arms a 1 s timer");
  timers[0]?.[0]();
  check(calls.length === 2 && calls[1][1] === fault(1), "safety: the timer sends it again, whole");
  check(timers.length === 2, "safety: refused again, the timer is armed again");
  timers[1]?.[0]();
  check(calls.length === 3 && timers.length === 2, "safety: accepted, no timer left");
}
{
  const { arm, calls, timers } = rig([false]);
  arm.safety(fault(1));
  arm.safety(fault(2));
  check(calls.map((c) => c[1]).join() === [fault(1), fault(1), fault(2)].join() && timers.length === 1,
        "safety: a later report sends the pending one first, in order, and one timer only");
}
{
  const { arm, timers } = rig([false, false]);
  arm.safety(fault(1));
  arm.safety(fault(2));
  check(timers.length === 1, "safety: refused again before the timer fires, still one timer");
}
{
  const { arm, calls, hide } = rig([false]);
  arm.safety(fault(1));
  hide();
  check(calls.length === 2 && calls[1][1] === fault(1), "safety: the next hide sends a pending report");
}
{
  const { arm, calls, win } = rig([false]);
  arm.safety(fault(1));
  win.dispatchEvent(new Event("pagehide"));
  check(calls.length === 2 && calls[1][1] === fault(1), "safety: pagehide sends a pending report");
}
{
  const { arm, calls } = rig([false]);
  arm.safety(fault(1));
  arm.load(whole);
  check(calls.map((c) => c[0]).join() === "/report/safety,/report/safety,/report/load",
        "load: a pending safety report goes before the load record");
}
{
  const { calls, hide } = rig();
  hide();
  check(calls.length === 0, "hide: nothing pending, nothing sent");
}
{
  const calls = [];
  const body = JSON.stringify({ kind: "load", reportId: "0123456789abcdef0123456789abcdef",
                                load: "11111111-2222-3333-4444-555555555555", frames: [] });
  const f = floor({ base: "/report", load: "11111111-2222-3333-4444-555555555555", body,
                    send: (u, b) => (calls.push([u, b]), true) });
  const sent = calls[0]?.[1] ?? "";
  const r = JSON.parse(sent || "{}");
  check(calls.length === 1 && calls[0][0] === "/report/load", "floor: one beacon to the same path");
  check(sent.length === body.length, "floor: the same number of bytes");
  check(r.load === f.load && r.load !== "11111111-2222-3333-4444-555555555555" && r.reportId !== "0123456789abcdef0123456789abcdef",
        "floor: its own load id and reportId, so the read tool keeps it apart");
  check(f.ok === true && typeof f.at === "number" && typeof f.callMs === "number", "floor: the answer, the call's time and its cost");
}

if (failed) process.exit(1);
console.log("report-arms/beacon: each record one beacon in the call; refusals kept or trimmed as §3.1 says; the floor's bytes equal");
