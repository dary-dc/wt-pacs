/** node client/viewer/load-report.test.mjs — the load report: off unless drawn, one object per load, sent once when the page hides. */
import assert from "node:assert/strict";
import { loadReport } from "./load-report.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const on = { rate: 1, url: "/telemetry" };
const fields = { load: "L", view: "worker", client: "ts", codec: "av1", source: "0123456789abcdef", lossy: { q: 8, g: 8, depth: 10 }, frameCount: 2 };
const rig = (config = on, { accept = () => true, random = () => 0 } = {}) => {
  const sent = [];
  let t = 0;
  const r = loadReport(config, fields, { random, now: () => ++t, send: (url, body) => (sent.push({ url, body: JSON.parse(body) }), accept(sent.length)) });
  return { r, sent };
};
const summary = {
  issuedAt: 1000,
  fillMs: 812.5,
  dial: 1100.25,
  frames: [{ i: 0, path: "av1-webcodecs", wireBytes: 2560, decodeMs: 3.25 }, { i: 1, path: "av1-dav1d", refusal: "codec", wireBytes: 1536 },
    { i: 2, path: "av1-webcodecs", wireBytes: 1024, decodeMs: 2 }],
};

/** Off by default: no configuration, a rate of 0, or no endpoint draws nothing and records nothing. */
test("off unless the configuration sets a rate and an endpoint", () => {
  for (const config of [undefined, {}, { rate: 0, url: "/telemetry" }, { rate: 1 }]) {
    assert.equal(loadReport(config, fields, { random: () => 0, send: () => assert.fail("sent") }), null, JSON.stringify(config));
  }
});

/** The draw is once per load, against the rate: a draw under it samples the load, one at or over it does not. */
test("a load is sampled when its draw falls under the rate", () => {
  assert.notEqual(rig({ ...on, rate: 0.5 }, { random: () => 0.49 }).r, null);
  assert.equal(rig({ ...on, rate: 0.5 }, { random: () => 0.5 }).r, null);
});

/** Nothing leaves during the load: labels, presses, errors and the fill's end are held until the page hides. */
test("nothing is sent before the load ends", () => {
  const { r, sent } = rig();
  r.label("optimal", "Optimal quality");
  r.press("lossless");
  r.error("console.error", "x");
  r.progress(2);
  r.filled(summary);
  assert.equal(sent.length, 0);
});

/** One report per load: the first end sends it, to the configured endpoint; a later end (the page hidden again) sends nothing. */
test("the load's end sends one report, once", () => {
  const { r, sent } = rig();
  r.filled(summary);
  r.end();
  r.end();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "/telemetry");
});

/**
 * The fill as docs/devices.md §7's Second amendment defines it: from the downloader's dial to the last frame stored, both
 * epoch ms; the status line's fill beside it; the count per route; each frame's route, KB on the wire and decode ms.
 */
test("the report carries the fill, the routes and each frame", () => {
  const { r, sent } = rig();
  r.progress(2);
  r.filled(summary);
  r.end();
  const b = sent[0].body;
  assert.deepEqual({ fillFrom: b.fillFrom, fillTo: b.fillTo, fillMs: b.fillMs, statusFillMs: b.statusFillMs }, { fillFrom: 1100.25, fillTo: 1812.5, fillMs: 712.25, statusFillMs: 812.5 });
  assert.deepEqual(b.routes, { "av1-webcodecs": 2, "av1-dav1d": 1 });
  assert.deepEqual(b.frames, [{ i: 0, route: "av1-webcodecs", kb: 2.5, decodeMs: 3.25 }, { i: 1, route: "av1-dav1d", refusal: "codec", kb: 1.5, decodeMs: null },
    { i: 2, route: "av1-webcodecs", kb: 1, decodeMs: 2 }]);
  assert.equal(b.received, 2);
  assert.equal(b.rate, 1);
  assert.equal(b.truncated, false);
  for (const [k, v] of Object.entries(fields)) assert.deepEqual(b[k], v, k);
});

/** A load hidden before its fill ends still reports: the fill is null, not 0, and the frames received so far are counted. */
test("a load ended before its fill reports a null fill", () => {
  const { r, sent } = rig();
  r.progress(1);
  r.end();
  const b = sent[0].body;
  assert.deepEqual([b.fillFrom, b.fillTo, b.fillMs, b.statusFillMs, b.frames, b.received], [null, null, null, null, [], 1]);
});

/** Frames stored without the fill's end (on demand, or a fill cut short) are listed, and the fill stays null. */
test("frames without the fill's end leave the fill null", () => {
  const { r, sent } = rig();
  r.filled({ ...summary, fillMs: null });
  r.end();
  const b = sent[0].body;
  assert.deepEqual([b.fillFrom, b.fillTo, b.fillMs, b.statusFillMs, b.frames.length], [null, null, null, null, 3]);
});

/** Labels, presses and errors keep their order and their times; an error's URLs are removed, so no address or query leaves. */
test("labels, presses and errors are kept in order, URLs removed", () => {
  const { r, sent } = rig();
  r.label("optimal", "Optimal quality");
  r.press("lossless");
  r.label("asking", "fetching lossless…");
  r.error("page", "connect: https://host.example:4433/wt?series=x failed, then http://other/a.json");
  r.end();
  const b = sent[0].body;
  assert.deepEqual(b.labels, [{ at: 1, quality: "optimal", text: "Optimal quality" }, { at: 3, quality: "asking", text: "fetching lossless…" }]);
  assert.deepEqual(b.presses, [{ at: 2, text: "lossless" }]);
  assert.deepEqual(b.errors, [{ at: 4, source: "page", message: "connect: <url> failed, then <url>" }]);
});

/** A refused beacon (the keepalive budget taken) is sent again once without the per-frame rows, marked truncated; a second refusal drops it. */
test("a refused report is sent again once without its frames", () => {
  const { r, sent } = rig(on, { accept: () => false });
  r.filled(summary);
  r.end();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].body.truncated, false);
  assert.deepEqual([sent[1].body.frames, sent[1].body.truncated, sent[1].body.fillMs], [null, true, 712.25]);
  r.end();
  assert.equal(sent.length, 2);
});

/**
 * The report fits the beacon's budget with room to spare on every demo series (56, 50 and 69 frames, the three DBT volumes):
 * every frame stored, each with the longest route and a refusal, the protocol's label changes and two presses. Fetch's
 * keepalive limit is 64 KiB for all of a page's keepalive requests in flight; the report stays under 16 KiB.
 */
test("the report's size on the demo series stays under 16 KiB", () => {
  const sizes = {};
  for (const [set, n] of [["dbts_a1", 56], ["dbts_b1", 50], ["dbts_c1", 69]]) {
    let body = "";
    const r = loadReport(on, { ...fields, frameCount: n }, { random: () => 0, send: (_, b) => ((body = b), true) });
    for (const [quality, text] of [["optimal", "Optimal quality"], ["asking", "fetching lossless…"], ["lossless", "Lossless"], ["optimal", "Optimal quality"]]) r.label(quality, text);
    r.press("lossless");
    r.press("optimal quality");
    r.progress(n);
    r.filled({ ...summary, frames: Array.from({ length: n }, (_, i) => ({ i, path: "av1-webcodecs", refusal: "codec", wireBytes: 1234567, decodeMs: 123.456789 })) });
    r.end();
    sizes[set] = new TextEncoder().encode(body).length;
    assert.ok(sizes[set] < 16 * 1024, `${set}: ${sizes[set]} B`);
  }
  console.log(`report bytes, worst case: ${JSON.stringify(sizes)}`);
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
console.log(`load-report: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
