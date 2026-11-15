// node lab/report-arms/timing.test.mjs — the timings every HTTP carrier runs (report-plan.md §3.1, §7.1): H sends the
// whole record once at the first hide; Y sends it at the fill's end and a delta at each later hide; one send per
// hide though both visibilitychange and pagehide fire; `off` adds no listener; each record mutant does what §7.4 says.
import { schedule } from "./timing.js";
import { wrapCarrier, mutateRecord } from "./mutants.js";
import { Load } from "./record.js";
import off from "./arms/off.js";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));

function page() {
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const win = new EventTarget();
  const hide = () => { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
                       win.dispatchEvent(new Event("pagehide")); };
  const show = () => { doc.visibilityState = "visible"; win.dispatchEvent(new Event("pageshow"));
                       doc.dispatchEvent(new Event("visibilitychange")); };
  return { doc, win, hide, show };
}
const sent = () => { const s = []; return { s, carrier: { load: (b) => s.push(JSON.parse(b)), safety: () => {} } }; };
const ctx = { load: "L", session: "S", build: "b", source: "x", frameCount: 2, codec: "htj2k" };

{
  const p = page(), { s, carrier } = sent(), load = new Load(ctx);
  const t = schedule({ timing: "H", carrier, load, ...p });
  load.frame({ i: 0, route: "htj2k" });
  t.fillEnded();
  check(s.length === 0, "H: nothing at the fill's end");
  p.hide();
  check(s.length === 1 && s[0].frames.length === 1, "H: the whole record once at the first hide");
  p.show(); load.press({ at: 1 }); p.hide();
  check(s.length === 1, "H: nothing at a later hide");
}
{
  const p = page(), { s, carrier } = sent(), load = new Load(ctx);
  const t = schedule({ timing: "Y", carrier, load, ...p });
  load.frame({ i: 0, route: "htj2k" });
  t.fillEnded();
  check(s.length === 1 && s[0].seq === 0 && s[0].frames.length === 1, "Y: the whole record at the fill's end");
  load.press({ at: 1 });
  p.hide();
  check(s.length === 2 && s[1].seq === 1 && s[1].presses.length === 1, "Y: a delta at hide, one for both events");
  p.show(); p.hide();
  check(s.length === 2, "Y: a hide with nothing changed sends nothing");
  load.press({ at: 2 }); p.show();
  check(s.length === 2, "Y: turning visible sends nothing");
  p.hide();
  check(s.length === 3 && s[2].seq === 2, "Y: a hide after a show sends the next delta");
}
{
  const p = page(), { s, carrier } = sent(), load = new Load(ctx);
  schedule({ timing: "Y", carrier, load, ...p });
  p.hide();
  check(s.length === 1 && s[0].fillMs === null && s[0].seq === 0, "Y: a hide before the fill's end sends the whole");
}
for (const timing of ["H", "Y"]) {
  const p = page(), { s, carrier } = sent(), load = new Load(ctx);
  schedule({ timing, carrier, load, ...p });
  p.win.dispatchEvent(new Event("pagehide"));
  check(s.length === 1, `${timing}: pagehide alone, with no visibilitychange, sends`);
}
{
  const p = page(), { s, carrier } = sent(), load = new Load(ctx);
  let listeners = 0;
  p.doc.addEventListener = p.win.addEventListener = () => listeners++;
  const t = schedule({ timing: "off", carrier, load, ...p });
  t.fillEnded();
  check(listeners === 0 && s.length === 0, "off: no listener, nothing sent");
}
{
  const calls = [];
  const c = { load: (b) => calls.push(["load", b]), safety: (b) => calls.push(["safety", b]) };
  wrapCarrier(c, "never-sent").load("{}");
  check(calls.length === 0, "never-sent: the load record is not sent");
  let r = 0.5;
  const sampled = wrapCarrier(c, "safety-sampled", () => r);
  sampled.safety("a"); r = 0.05; sampled.safety("b");
  check(calls.length === 1 && calls[0][1] === "b", "safety-sampled: the rate 0.1 applied to the safety report");
  const plain = wrapCarrier(c, null);
  check(plain === c, "no mutant: the carrier itself");
  check("labOnly" in mutateRecord({ reportId: "a" }, "field-outside"), "field-outside: a field off the list");
  check(!("reportId" in mutateRecord({ reportId: "a" }, "no-reportId")), "no-reportId: the id removed");
  check(JSON.stringify(mutateRecord({ reportId: "a" }, null)) === '{"reportId":"a"}', "no mutant: the record as is");
}
{
  const beacons = [];
  globalThis.navigator ??= {};
  const saved = navigator.sendBeacon;
  Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: (u, b) => (beacons.push([u, b]), true) },
                                                   configurable: true });
  const o = off({ base: "/report" });
  o.load("{}"); o.safety('{"kind":"safety"}');
  check(beacons.length === 1 && beacons[0][0] === "/report/safety", "off: the safety report by beacon at once, no load");
  void saved;
}

if (failed) process.exit(1);
console.log("report-arms: the timings, the off arm and the record mutants hold");
