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
    this.sent.push(m.kind);
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
  view.connect("https://x.invalid/", "ab", {}, 0);
  made.find((w) => /downloader/.test(w.url)).onerror({ message: "" });
  assert.deepEqual(failures(), ["series: the downloader did not start: its script did not load"]);
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
