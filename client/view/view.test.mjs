// node client/view/view.test.mjs — the view worker's page half, with stand-in workers: what reaches the page when something fails.
import assert from "node:assert/strict";
import { ViewWorker } from "./view.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const made = [];
globalThis.Worker = class {
  constructor(url) {
    this.url = String(url);
    this.sent = [];
    made.push(this);
  }
  postMessage(m) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
};
const canvas = { transferControlToOffscreen: () => ({}) };

/** A view worker on the page, every event it emits recorded, and its stand-in worker. */
function rig() {
  made.length = 0;
  const events = [];
  const view = new ViewWorker(canvas, { meta: { frameCount: 3 }, fillMode: true, size: {}, emit: (type, e) => events.push([type, e]) });
  return { view, worker: made[0], failures: () => events.filter(([t]) => t === "failed").map(([, e]) => `${e.scope}: ${e.reason}`) };
}

/** Each scope the view worker reports reaches the page by name, unchanged. */
test("each failed scope reaches the page by name", () => {
  const { worker, failures } = rig();
  for (const scope of ["frame", "series", "cache", "worker"]) worker.onmessage({ data: { kind: "event", type: "failed", scope, reason: `a ${scope} failure` } });
  assert.deepEqual(failures(), ["frame: a frame failure", "series: a series failure", "cache: a cache failure", "worker: a worker failure"]);
});

/** After start, the view worker's error is fatal: said once as the worker's, the worker ended, every waiting and later call refused. */
test("a view worker error after start is fatal and shown", async () => {
  const { view, worker, failures } = rig();
  worker.onmessage({ data: { kind: "event", type: "renderer", renderer: "stand-in" } });
  const waiting = view.repaint();
  worker.onerror({ message: "boom" });
  worker.onerror({ message: "again" });
  assert.deepEqual(failures(), ["worker: the view worker failed: boom"]);
  assert.equal(worker.terminated, true);
  await assert.rejects(waiting, /the view worker failed: boom/);
  await assert.rejects(view.valueAt(0, 0), /the view worker failed: boom/);
});

/** The view worker's fatal error also ends the downloader the page started, so no session outlives the view. */
test("a fatal view worker error ends the page's downloader", () => {
  const { view, worker } = rig();
  view.connect("https://x.invalid/", "ab", {}, 0).catch(() => {});
  worker.onmessage({ data: { kind: "event", type: "renderer", renderer: "stand-in" } });
  worker.onerror({ message: "boom" });
  assert.equal(made.find((w) => /downloader/.test(w.url)).terminated, true);
});

/** A message from the view worker the page cannot read is fatal in the same way. */
test("a view worker messageerror is fatal and shown", async () => {
  const { view, worker, failures } = rig();
  worker.onmessageerror();
  assert.deepEqual(failures(), ["worker: a message from the view worker could not be read"]);
  assert.equal(worker.terminated, true);
  await assert.rejects(view.ledger(), /could not be read/);
});

/** A downloader that does not start is the series' failure. */
test("a downloader that does not load fails the series", () => {
  const { view, failures } = rig();
  view.connect("https://x.invalid/", "ab", {}, 0).catch(() => {});
  made.find((w) => /downloader/.test(w.url)).onerror({ message: "" });
  assert.deepEqual(failures(), ["series: the downloader did not start: its script did not load"]);
});

/** A downloader whose script does not load fails `connect` at once, rather than leaving it to the check's deadline. */
test("a downloader that does not load fails connect", async () => {
  const { view } = rig();
  const connecting = view.connect("https://x.invalid/", "ab", {}, 0);
  made.find((w) => /downloader/.test(w.url)).onerror({ message: "" });
  const hung = new Promise((resolve) => setTimeout(() => resolve("still waiting"), 50));
  await assert.rejects(Promise.race([connecting, hung]).then((v) => assert.fail(v)), /the downloader did not start: its script did not load/);
});

/** A lab's cine reaches the view worker as intents: its clock and schedule, the page's ticks, the pause. */
test("play, tick and pause are the view worker's intents", () => {
  const { view, worker } = rig();
  view.play(30, 1234.5, "raf");
  view.tick(1240, 1239);
  view.pause();
  assert.deepEqual(worker.sent.slice(-3), [
    { kind: "play", fps: 30, t0: 1234.5, source: "raf" },
    { kind: "tick", t: 1240, vsync: 1239 },
    { kind: "pause" },
  ]);
});

const downloader = () => made.find((w) => /downloader/.test(w.url));
const connectMessage = (worker) => worker.sent.find((m) => m.kind === "connect");

/** By default the page posts the downloader its link alone; the view worker starts it and dials. */
test("by default the view worker starts the downloader", () => {
  const { view, worker } = rig();
  view.connect("https://x.invalid/", "ab", {}, 0);
  assert.deepEqual(downloader().sent.map((m) => m.kind), ["link"]);
  assert.equal(connectMessage(worker).dialled, false);
});

/**
 * Under `pageDials` the page starts the downloader with the first want, no fill and no cache setting, and dials, beside
 * the view worker's boot; the view worker is told it joins, and what rode the start.
 */
test("under pageDials the page starts and dials the downloader", async () => {
  globalThis.crossOriginIsolated = true;
  const { view, worker } = rig();
  view.connect("https://x.invalid/", "ab", { pageDials: true, firstWant: [0, 1, 2], writer: "store", fill: [0, 1, 2] }, 0);
  await new Promise((r) => setTimeout(r));
  const sent = downloader().sent;
  assert.deepEqual(sent.map((m) => m.kind), ["link", "start", "dial"]);
  assert.deepEqual(sent[1].config.want, [0, 1, 2]);
  assert.equal(sent[1].config.fill, undefined);
  assert.equal("writer" in sent[1].config, false);
  assert.equal(sent[2].url, "https://x.invalid/");
  assert.equal(connectMessage(worker).dialled, true);
  assert.deepEqual(connectMessage(worker).sent, [0, 1, 2]);
});

/** A worker booted before the metadata is the one started, not a second. */
test("a booted view worker is the one started", () => {
  made.length = 0;
  const booted = ViewWorker.boot();
  new ViewWorker(canvas, { meta: { frameCount: 3 }, fillMode: true, size: {}, emit: () => {}, booted, glAfterDial: true });
  assert.equal(made.length, 1);
  assert.equal(booted.sent[0].kind, "start");
  assert.equal(booted.sent[0].glAfterDial, true);
});

/** A worker booted early whose script failed before the page had its metadata fails as not started. */
test("a booted view worker that did not load is said", () => {
  made.length = 0;
  const booted = ViewWorker.boot();
  booted.onerror({ message: "" });
  const events = [];
  new ViewWorker(canvas, { meta: { frameCount: 3 }, fillMode: true, size: {}, emit: (type, e) => events.push(`${type} ${e.scope}: ${e.reason}`), booted });
  assert.deepEqual(events, ["failed worker: the view worker did not start: its script did not load"]);
  assert.equal(booted.terminated, true);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`view: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
