/** node lab/phone/beacon.test.mjs — what the beacon sends, and when. */
import assert from "node:assert/strict";
import { recorder } from "./beacon.js";

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

/** At the fill's end one batch leaves: the load first, with its fill time and each frame's route, KB and decode ms, then what was held. */
test("the fill's end sends the load and what was held, in one batch", () => {
  const { r, sent } = rig();
  r.record("label", { quality: "optimal" });
  r.filled(ledger, meta);
  assert.equal(sent.length, 1);
  const [load, label] = sent[0];
  assert.deepEqual({ ...load, at: 0 }, { load: "L", view: "worker", kind: "load", at: 0, exactSeries: "dbts_b1", lossy: { q: 8, g: 8, depth: 10 }, frameCount: 2, received: 2, fillMs: 812.5, errors: [],
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
  assert.deepEqual([sent[1][0].fillMs, sent[1][0].received, sent[1][0].errors], [null, 0, ["connect: refused"]]);
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
