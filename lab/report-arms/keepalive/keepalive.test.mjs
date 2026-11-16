// node lab/report-arms/keepalive/keepalive.test.mjs — KEEPALIVE as report-plan.md §3.2 designs it: every record one
// keepalive POST inside the call; a send while visible retried once after 1 s, a hide send never; past OpenTelemetry's
// budget the frames dropped, then keepalive off; the worker sends each failed check at once and tells the page on its
// 204; the page sends every safety report not yet acknowledged at each hide; the floor sends the same bytes.
import keepalive from "./keepalive.js";
import { reporter, failed } from "./worker.js";
import { floor } from "./floor.js";

let failures = 0;
const check = (ok, what) => ok || (failures++, console.error(`FAIL ${what}`));
const settle = () => new Promise((r) => setTimeout(r, 0));

function rig(answers = []) {
  const calls = [];
  const timers = [];
  const pendingAnswers = [];
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const win = new EventTarget();
  const channel = {};
  const send = (url, body, keep) => {
    calls.push({ url, body, keep });
    const a = answers.length ? answers.shift() : true;
    if (a === "hold") return new Promise((ok) => pendingAnswers.push(ok));
    return Promise.resolve(a);
  };
  const timer = (fn, ms) => timers.push([fn, ms]);
  const hide = () => { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); };
  const show = () => { doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); };
  const arm = keepalive({ base: "/report", load: "L" }, { send, doc, win, timer, channel });
  return { arm, calls, timers, hide, show, win, channel, pendingAnswers };
}
const whole = JSON.stringify({ kind: "load", reportId: "r1", seq: 0, frames: [{ i: 0 }] });
const delta = JSON.stringify({ kind: "load", reportId: "r2", seq: 1, presses: [] });
const fault = (n) => JSON.stringify({ kind: "safety", reportId: `s${n}`, frame: n });

{
  const { arm, calls } = rig();
  arm.load(whole);
  check(calls.length === 1 && calls[0].url === "/report/load" && calls[0].body === whole && calls[0].keep === true,
        "load: one keepalive POST inside the call, the body as given");
  arm.safety(fault(1));
  check(calls.length === 2 && calls[1].url === "/report/safety" && calls[1].keep === true, "safety: one keepalive POST at once");
}
{
  const { arm, calls, timers } = rig([false, false]);
  arm.load(whole);
  await settle();
  check(timers.length === 1 && timers[0][1] === 1000, "load: a visible send not answered 204 is retried after 1 s");
  timers.shift()[0]();
  await settle();
  check(calls.length === 2 && calls[1].body === whole && timers.length === 0, "load: retried once, never twice");
}
{
  const { arm, timers, hide } = rig([false]);
  hide();
  arm.load(delta);
  await settle();
  check(timers.length === 0, "load: a send at hide never waits for its answer");
}
{
  const { arm, calls } = rig(Array(9).fill("hold"));
  for (let i = 0; i < 9; i++) arm.safety(fault(i));
  arm.load(whole);
  const r = JSON.parse(calls[9].body);
  check(r.frames === null && r.truncated === true && r.reportId === "r1", "load: past the budget the frames are dropped, same reportId");
  check(calls[9].keep === false, "load: past nine in flight, keepalive is off");
}
{
  const big = JSON.stringify({ kind: "load", reportId: "r3", seq: 0, frames: "x".repeat(70_000) });
  const { arm, calls } = rig();
  arm.load(big);
  check(JSON.parse(calls[0].body).frames === null && calls[0].keep === true, "load: a record over 60 000 bytes goes without its frames");
}
{
  const { arm, calls, pendingAnswers } = rig(Array(9).fill("hold"));
  for (let i = 0; i < 9; i++) arm.safety(fault(i));
  pendingAnswers.forEach((ok) => ok(true));
  await settle();
  arm.load(whole);
  check(calls[9].keep === true && calls[9].body === whole, "budget: released when the sends in flight settle");
}
{
  const { arm, calls, timers, hide } = rig([false, false, true]);
  arm.safety(fault(1));
  await settle();
  check(timers.length === 1 && timers[0][1] === 1000, "safety (page's own): a failed send retried after 1 s");
  timers.shift()[0]();
  await settle();
  check(calls.length === 2 && timers.length === 0, "safety (page's own): retried once");
  hide();
  await settle();
  check(calls.length === 3 && calls[2].body === fault(1) && calls[2].url === "/report/safety", "safety: still unsent, sent at the next hide");
  hide();
  check(calls.length === 3, "safety: once acknowledged, never sent again");
}
{
  const { arm, calls, hide, win, channel } = rig();
  arm.safety(fault(1), true);
  arm.safety(fault(2), true);
  check(calls.length === 0, "safety (the worker's): the page does not send it at once");
  channel.onmessage({ data: fault(1) });
  win.dispatchEvent(new Event("pagehide"));
  check(calls.length === 1 && calls[0].body === fault(2), "safety (the worker's): pagehide sends only those not acknowledged");
  await settle();
  hide();
  check(calls.length === 1, "safety (the worker's): the page's 204 settles it too");
}
{
  const { arm, calls, channel } = rig();
  channel.onmessage({ data: fault(3) });
  arm.safety(fault(3), true);
  arm.safety(fault(3));
  check(calls.length === 0, "safety: acknowledged before it reached the page, never held nor sent");
}
{
  const { arm, timers, hide, show } = rig([false]);
  hide();
  show();
  arm.load(whole);
  await settle();
  check(timers.length === 1, "load: shown again, a send is visible again and retried");
}

function worker(answers = [], mutant = null, random = () => 0.5) {
  const calls = [];
  const posted = [];
  const timers = [];
  const q = new URLSearchParams({ base: "/report", load: "L", session: "S", build: "b", codec: "htj2k", ...(mutant ? { mutant } : {}) });
  const send = (url, body, keep) => (calls.push({ url, body, keep }), Promise.resolve(answers.length ? answers.shift() : true));
  const report = reporter(q, ["d0", "d1"], { engine: "E", hardwareConcurrency: 4 },
    { channel: { postMessage: (b) => posted.push(b) }, send, timer: (fn, ms) => timers.push([fn, ms]), now: () => 7,
      random });
  return { report, calls, posted, timers };
}
const rescued = { kind: "frame", index: 1, route: "wasm", mismatchOn: "webcodecs", exact: true };
{
  const { report, calls, posted } = worker();
  const body = report(rescued);
  const r = JSON.parse(body);
  check(calls.length === 1 && calls[0].url === "/report/safety" && calls[0].keep === true && calls[0].body === body,
        "worker: the failed check sent at once by keepalive, the body it returns");
  check(r.kind === "safety" && r.load === "L" && r.frame === 1 && r.route === "webcodecs" && r.expected === "d1" &&
        r.followed === "rescued" && r.secondDecode === true && r.at === 7 && r.reportId?.length === 32,
        "worker: the record names the frame, the route that failed, the digest expected and what followed");
  await settle();
  check(posted.length === 1 && posted[0] === body, "worker: on the 204 the page is told, by the body");
}
{
  const { report, calls, posted, timers } = worker([false, false]);
  report(rescued);
  await settle();
  check(posted.length === 0 && timers.length === 1 && timers[0][1] === 1000, "worker: a failed send is retried after 1 s, the page not told");
  timers.shift()[0]();
  await settle();
  check(calls.length === 2 && timers.length === 0 && posted.length === 0, "worker: retried once");
}
{
  const { report } = worker([], "no-reportId");
  check(!("reportId" in JSON.parse(report(rescued))), "worker: the no-reportId mutant reaches the worker's record");
  const s = worker([], "field-outside");
  check(JSON.parse(s.report(rescued)).labOnly === 1, "worker: the field-outside mutant reaches the worker's record");
  const k = worker([], "safety-sampled", () => 0.5);
  k.report(rescued);
  check(k.calls.length === 0, "worker: the safety-sampled mutant drops the worker's send");
}
check(failed(rescued) && failed({ kind: "frame", exact: false }) && !failed({ kind: "frame", exact: true }) &&
      !failed({ ...rescued, preview: true }) && !failed({ kind: "done" }), "worker: a final frame whose check failed, nothing else");
{
  const calls = [];
  const body = JSON.stringify({ load: "11111111-1111-4111-8111-111111111111", reportId: "a".repeat(32), frames: [] });
  const f = floor({ base: "/report", load: "11111111-1111-4111-8111-111111111111", body,
                    send: (url, b, keep) => (calls.push({ url, b, keep }), Promise.resolve(true)) });
  check(calls[0].b.length === body.length && calls[0].b.includes(f.load) && !calls[0].b.includes("a".repeat(32)) &&
        calls[0].keep === true && calls[0].url === "/report/load" && f.done instanceof Promise,
        "floor: the arm's bytes, keepalive, its own load id and reportId");
}

if (failures) process.exit(1);
console.log("keepalive: ok");
