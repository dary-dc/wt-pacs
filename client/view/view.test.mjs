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
  return { view, worker: made[0], failures: () => events.filter(([t]) => t === "failed").map(([, e]) => e.reason) };
}

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
