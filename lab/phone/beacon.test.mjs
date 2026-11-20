/** node lab/phone/beacon.test.mjs — what the beacon sends, and when. */
import assert from "node:assert/strict";
import { recorder, watchLifecycle } from "./beacon.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const rig = () => {
  const sent = [];
  let t = 0;
  const r = recorder({ load: "L", view: "worker" }, { send: (body) => sent.push(JSON.parse(body)), now: () => ++t });
  return { r, sent };
};
const meta = { frameCount: 2, exactSeries: "dbts_b1", lossy: { q: 8, g: 8, depth: 10 } };
const ledger = {
  fillMs: 812.5,
  issuedAt: 1000,
  boot: { dial: 1100.25 },
  frames: [{ i: 0, path: "av1-webcodecs", wireBytes: 2560, decodeMs: 3.25 }, { i: 1, path: "av1-dav1d", refusal: "codec", wireBytes: 1536 }],
  errors: [],
};

/** Nothing leaves the page during the fill: labels and errors before its end are held. */
test("nothing is sent before the fill ends", () => {
  const { r, sent } = rig();
  r.record("label", { quality: "optimal" });
  r.record("error", { source: "console.error", message: "x" });
  r.flush();
  assert.equal(sent.length, 0);
});

/**
 * At the fill's end one batch leaves: the load first, then what was held. The load carries the Second amendment's fill,
 * from the downloader's dial (just before its WebTransport is built) to the last frame stored, both epoch ms; the status
 * line's beside it; the count per route; and each frame's route, KB and decode ms.
 */
test("the fill's end sends the load and what was held, in one batch", () => {
  const { r, sent } = rig();
  r.record("label", { quality: "optimal" });
  r.filled(ledger, meta);
  assert.equal(sent.length, 1);
  const [load, label] = sent[0];
  assert.deepEqual({ ...load, at: 0 }, { load: "L", view: "worker", kind: "load", at: 0, exactSeries: "dbts_b1", lossy: { q: 8, g: 8, depth: 10 }, frameCount: 2, received: 2, fillFrom: 1100.25, fillTo: 1812.5, fillMs: 712.25, statusFillMs: 812.5,
    routes: { "av1-webcodecs": 1, "av1-dav1d": 1 }, errors: [],
    frames: [{ i: 0, route: "av1-webcodecs", kb: 2.5, decodeMs: 3.25 }, { i: 1, route: "av1-dav1d", refusal: "codec", kb: 1.5, decodeMs: null }] });
  assert.deepEqual([label.kind, label.quality, label.load], ["label", "optimal", "L"]);
  assert.ok(label.at < load.at, "each record keeps its own time");
});

/** After the fill, records wait for a flush (the runner's, or the page hidden), and each is sent once. */
test("after the fill, records wait for a flush and leave once", () => {
  const { r, sent } = rig();
  r.filled(ledger, meta);
  r.record("lossless", { text: "lossless" });
  assert.equal(sent.length, 1);
  r.flush();
  r.flush();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].map((x) => x.kind), ["lossless"]);
});

/** A page left before its fill ends still sends what it held, and a failed fill says why with no fill time. */
test("a page left mid-fill sends what it held; a failed fill has no fill time", () => {
  const { r, sent } = rig();
  r.record("error", { source: "onerror", message: "boom" });
  r.flush({ leaving: true });
  assert.deepEqual(sent[0].map((x) => x.kind), ["error"]);
  r.filled({ error: "connect: refused", fillMs: 5 }, meta);
  assert.deepEqual([sent[1][0].fillMs, sent[1][0].statusFillMs, sent[1][0].received, sent[1][0].errors], [null, null, 0, ["connect: refused"]]);
});

/** Each route is counted over every frame that took it. */
test("the routes are counted per frame", () => {
  const { r, sent } = rig();
  r.filled({ ...ledger, frames: [...ledger.frames, { i: 2, path: "av1-webcodecs", wireBytes: 1 }] }, { ...meta, frameCount: 3 });
  assert.deepEqual(sent[0][0].routes, { "av1-webcodecs": 2, "av1-dav1d": 1 });
});

/** A fill with either mark missing (no dial stamped, or the last frame never stored) has no fill time, never a guess. */
test("a fill without both marks has no fill time", () => {
  for (const missing of [{ boot: {} }, { fillMs: null }]) {
    const { r, sent } = rig();
    r.filled({ ...ledger, ...missing }, meta);
    assert.equal(sent[0][0].fillMs, null);
  }
});

const page = (state = "visible") => {
  const doc = Object.assign(new EventTarget(), { visibilityState: state });
  return { doc, win: new EventTarget() };
};
const turn = (doc, state) => ((doc.visibilityState = state), doc.dispatchEvent(new Event("visibilitychange")));

/**
 * Every visibility change, freeze and resume is recorded with the page's state, in order from the load's start, so a
 * run tells a hidden or frozen page from a failure; turning hidden sends what is held, mid-fill too.
 */
test("the page's visibility and freezes are recorded, and hidden sends them", () => {
  const { r, sent } = rig();
  const { doc, win } = page();
  watchLifecycle(r, doc, win);
  turn(doc, "hidden");
  assert.deepEqual(sent[0].map((x) => [x.kind, x.event, x.state]), [["visibility", "start", "visible"], ["visibility", "visibilitychange", "hidden"]]);
  doc.dispatchEvent(new Event("freeze"));
  doc.dispatchEvent(new Event("resume"));
  turn(doc, "visible");
  r.filled(ledger, meta);
  assert.deepEqual(sent[1].slice(1).map((x) => [x.event, x.state]), [["freeze", "hidden"], ["resume", "hidden"], ["visibilitychange", "visible"]]);
  win.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(sent[2].map((x) => [x.event, x.state]), [["pagehide", "visible"]]);
});

/** A page that starts hidden says so in its first record. */
test("a page loaded hidden is recorded hidden from its start", () => {
  const { r, sent } = rig();
  const { doc, win } = page("hidden");
  watchLifecycle(r, doc, win);
  r.filled(ledger, meta);
  assert.deepEqual([sent[0][1].event, sent[0][1].state], ["start", "hidden"]);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`beacon: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
