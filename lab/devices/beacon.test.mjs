/** node lab/devices/beacon.test.mjs — what the beacon sends, and when. */
import assert from "node:assert/strict";
import { chunks, postBatch, recorder } from "./beacon.js";

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
  frames: [{ i: 0, route: "av1-webcodecs", wireBytes: 2560, decodeMs: 3.25, decoded: 1203.5 }, { i: 1, route: "av1-dav1d", refusal: "codec", wireBytes: 1536 }],
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
    frames: [{ i: 0, route: "av1-webcodecs", kb: 2.5, decodeMs: 3.25, decodedAt: 1203.5 }, { i: 1, route: "av1-dav1d", refusal: "codec", kb: 1.5, decodeMs: null, decodedAt: null }] });
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
  r.filled({ ...ledger, frames: [...ledger.frames, { i: 2, route: "av1-webcodecs", wireBytes: 1 }] }, { ...meta, frameCount: 3 });
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

/**
 * The load's last batch is posted and awaited whole, whatever its size: a sendBeacon over Chrome's keepalive quota
 * returns false and its records are lost (the 2026-11-22 round's cell 3). Only a failed post falls back to the beacon.
 */
test("drain awaits one post of the whole batch; a failed post falls back to the beacon", async () => {
  const posted = [];
  const sent = [];
  let answer;
  const post = (b, ms) => (posted.push({ records: JSON.parse(b), ms }), new Promise((ok) => (answer = ok)));
  const r = recorder({ load: "L" }, { send: (b) => sent.push(JSON.parse(b)), post, now: () => 1 });
  r.filled(ledger, meta);
  for (let i = 0; i < 400; i += 1) r.record("label", { text: "x".repeat(200) });
  r.record("verdict", { ok: true });
  let done = false;
  const drained = r.drain().then(() => (done = true));
  await Promise.resolve();
  assert.equal(done, false, "drain waits for the post's answer");
  assert.equal(posted.length, 1);
  assert.ok(posted[0].ms > 0 && posted[0].ms <= 10000, "the post has a timeout");
  assert.deepEqual(posted[0].records.slice(-2).map((x) => [x.kind, x.path]), [["verdict", undefined], ["drain", "post"]]);
  assert.equal(posted[0].records.length, 402);
  assert.equal(posted[0].records.at(-1).records, 401, "the drain record counts the batch it closes");
  assert.ok(JSON.stringify(posted[0].records).length > 64 * 1024);
  answer(null);
  await drained;
  assert.equal(sent.length, 1, "only the fill's batch went by beacon");

  const fallback = [];
  const f = recorder({ load: "F" }, { send: (b) => fallback.push(JSON.parse(b)), post: async () => "TimeoutError", now: () => 1 });
  f.filled(ledger, meta);
  f.record("verdict", { ok: false });
  await f.drain();
  assert.deepEqual(fallback.slice(-2).map((b) => b.map((x) => [x.kind, x.path, x.why, x.records])),
    [[["drain", "sendBeacon", "TimeoutError", 1]], [["verdict", undefined, undefined, undefined]]]);
});

/** Chrome's keepalive quota, as `ResourceFetcher` keeps it: a body is refused once 64 KiB would be in flight. */
const quota = (sent, refused = []) => {
  let inFlight = 0;
  return (b) => {
    if (inFlight + b.length > 64 * 1024) return !refused.push(b.length);
    inFlight += b.length;
    sent.push(JSON.parse(b));
    return true;
  };
};

/**
 * A failed post over the quota still lands its drain record, which counts the batch, and as many of the batch's
 * records as the quota takes, newest first so the verdict is among them, each beacon at most 16 KiB: a read sees a
 * cut batch, never a silent one.
 */
test("a fallback over the keepalive quota lands its count first and then what fits", async () => {
  const sent = [];
  const refused = [];
  const r = recorder({ load: "Q" }, { send: quota(sent, refused), post: async () => "TimeoutError", now: () => 1 });
  r.filled({ ...ledger, frames: [] }, meta);
  for (let i = 0; i < 400; i += 1) r.record("label", { n: i, text: "x".repeat(200) });
  r.record("verdict", { n: 400, ok: true });
  await r.drain();
  const [fill, [drain], ...rest] = sent;
  assert.equal(fill[0].kind, "load");
  assert.deepEqual([drain.kind, drain.path, drain.records], ["drain", "sendBeacon", 401]);
  const labels = rest.flat();
  assert.ok(labels.length > 200 && labels.length < 400, `the quota cuts the batch (${labels.length} of 400 landed)`);
  const ns = labels.map((l) => l.n).sort((a, b) => a - b);
  assert.deepEqual(ns, ns.map((_, i) => 401 - ns.length + i), "what lands is the batch's tail, the verdict with it");
  assert.ok(rest.every((b) => JSON.stringify(b).length <= 16 * 1024));
  assert.equal(refused.length, 1, "nothing is offered after the first refusal, so no gap opens in what lands");
});

/**
 * A post that times out after the server took it is followed by the beacon's copy: the copy's records are the
 * post's, field for field, so a read keeps one record of each (load, kind, at) (lab/devices/README.md §The round).
 */
test("the fallback's records are the posted ones, field for field", async () => {
  const posted = [];
  const sent = [];
  let t = 0;
  const r = recorder({ load: "D" }, { send: (b) => sent.push(...JSON.parse(b)), post: async (b) => (posted.push(...JSON.parse(b)), "TimeoutError"), now: () => ++t });
  r.filled(ledger, meta);
  r.record("verdict", { ok: true });
  sent.length = 0;
  await r.drain();
  assert.deepEqual(sent.filter((x) => x.kind !== "drain"), posted.filter((x) => x.kind !== "drain"));
});

/** Each list is at most `bytes` as JSON, the records in order; a longer record goes alone. */
test("chunks keeps order and size, a long record alone", () => {
  const rs = [{ a: "x".repeat(10) }, { a: "y".repeat(11) }, { a: "z".repeat(100) }, { a: "w" }];
  const cs = chunks(rs, 40);
  assert.deepEqual(cs.flat(), rs);
  assert.deepEqual(cs.map((c) => c.length), [2, 1, 1]);
  assert.equal(JSON.stringify(cs[0]).length, 40, "a list of exactly `bytes` is kept whole");
  assert.deepEqual(chunks([], 40), []);
});

/** The post answers `null` only when the server took the batch: a refusal names its status and a failed fetch its error. */
test("postBatch is null only on a 2xx, else why", async () => {
  const real = globalThis.fetch;
  try {
    const answers = [new Response(null, { status: 204 }), new Response(null, { status: 400 }), Promise.reject(new DOMException("t", "TimeoutError"))];
    const asked = [];
    globalThis.fetch = (url, init) => (asked.push({ url, init }), Promise.resolve(answers.shift()));
    assert.deepEqual([await postBatch("[]", 5000), await postBatch("[]", 5000), await postBatch("[]", 5000)], [null, "HTTP 400", "TimeoutError"]);
    assert.deepEqual([asked[0].url, asked[0].init.method, asked[0].init.body, asked[0].init.signal instanceof AbortSignal], ["/lab/beacon", "POST", "[]", true]);
  } finally {
    globalThis.fetch = real;
  }
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
