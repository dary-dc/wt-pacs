// node lab/frame-clock/arms.test.mjs — each arm's start on the page: what it tells the view worker, and what its stop undoes.
import assert from "node:assert/strict";
import { ARMS, start } from "./arms.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** A stand-in `ViewWorker` recording each call, and the page's rAF and interval held by hand. */
function rig() {
  const calls = [];
  const view = { play: (...a) => calls.push(["play", ...a]), tick: (...a) => calls.push(["tick", ...a]), pause: () => calls.push(["pause"]) };
  const page = { rafs: [], intervals: [], cleared: [] };
  globalThis.requestAnimationFrame = (f) => page.rafs.push(f);
  globalThis.setInterval = (f, ms) => (page.intervals.push([f, ms]), page.intervals.length);
  globalThis.clearInterval = (id) => page.cleared.push(id);
  return { calls, view, page };
}

/** Each worker arm names its source to the view worker, posts no tick, and its stop pauses the worker. */
test("a worker arm starts the worker's own source", () => {
  for (const source of ["raf", "timeout", "channel", "wait"]) {
    const { calls, view, page } = rig();
    const stop = start(`worker-${source}`, view, 60, 1234);
    assert.deepEqual(calls, [["play", 60, 1234, source]]);
    assert.equal(page.rafs.length + page.intervals.length, 0);
    stop();
    assert.deepEqual(calls.at(-1), ["pause"]);
  }
});

/** page-raf and its A/A copy post each page rAF as a tick at the callback's time, logged as the vsync, until stopped. */
test("page-raf posts its rAF times as ticks", () => {
  for (const arm of ["page-raf", "page-raf′"]) {
    const { calls, view, page } = rig();
    const stop = start(arm, view, 30, 500);
    assert.deepEqual(calls, [["play", 30, 500, "posted"]]);
    page.rafs[0](40);
    const at = performance.timeOrigin + 40;
    assert.deepEqual(calls[1], ["tick", at, at]);
    assert.equal(page.rafs.length, 2);
    stop();
    page.rafs[1](57);
    assert.deepEqual(calls.slice(2), [["pause"]]);
    assert.equal(page.rafs.length, 2);
  }
});

/** page-interval is a page setInterval at the frame period, each firing a tick with no vsync; its stop clears it. */
test("page-interval ticks from a page interval", () => {
  const { calls, view, page } = rig();
  const stop = start("page-interval", view, 30, 500);
  assert.equal(page.intervals.length, 1);
  assert.equal(page.intervals[0][1], 1000 / 30);
  page.intervals[0][0]();
  assert.equal(calls[1][0], "tick");
  assert.ok(Math.abs(calls[1][1] - (performance.timeOrigin + performance.now())) < 50);
  assert.equal(calls[1][2], undefined);
  stop();
  assert.deepEqual(page.cleared, [1]);
  assert.deepEqual(calls.at(-1), ["pause"]);
});

/** Seven arms, the protocol's, and a name outside them is refused rather than run as something else. */
test("the arms are the protocol's seven", () => {
  assert.equal(new Set(ARMS).size, 7);
  assert.throws(() => start("worker-sleep", rig().view, 60, 0), /no arm/);
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
console.log(`frame-clock arms: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
