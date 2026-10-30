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
