// node client/view/clock.test.mjs — cine's clock in the view worker: which frame a tick paints, and each source's wiring.
import assert from "node:assert/strict";
import { Cine, now } from "./clock.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A cine whose paints are recorded, on `source`. */
function rig(source, { fps = 50, lead = 30 } = {}) {
  const shown = [];
  const c = new Cine({ fps, t0: now() + lead, source, show: async (i) => void shown.push(i) });
  return { c, shown };
}

/** A `MessageChannel` the test pumps by hand, one task a call to `task()`: Node's loop starves timers under a self-posting port. */
function pumped() {
  const Channel = globalThis.MessageChannel;
  const posted = [];
  let channel;
  globalThis.MessageChannel = class {
    port1 = { close() {} };
    port2 = { postMessage: () => posted.push(1) };
    constructor() {
      channel = this;
    }
  };
  return { posted, task: () => channel.port1.onmessage(), restore: () => (globalThis.MessageChannel = Channel) };
}

/** A paint that returns its draw's end is logged with that end, not when its reply came back; one returning nothing, with now. */
test("a paint's own end is logged where it gives one", async () => {
  const c = new Cine({ fps: 50, t0: 1000, source: "posted", show: async (i) => (i === 0 ? 1003 : undefined) });
  await c.tick(1000);
  const before = now();
  await c.tick(1020);
  assert.equal(c.log[0].end, 1003);
  assert.ok(c.log[1].end >= before);
});

/** A tick paints the frame due at its time, a second tick in the same period paints nothing, and a late tick skips ahead. */
test("a tick paints the frame due at its time, once", async () => {
  const shown = [];
  const c = new Cine({ fps: 50, t0: 1000, source: "posted", show: async (i) => void shown.push(i) });
  await c.tick(990);
  await c.tick(1000, 999);
  await c.tick(1019);
  await c.tick(1045);
  assert.deepEqual(shown, [0, 2]);
  assert.deepEqual(c.log.map(({ i, tick, vsync }) => [i, tick, vsync]), [[0, 1000, 999], [2, 1045, null]]);
  assert.ok(c.log.every((e) => e.end >= e.start));
  c.stop();
  await c.tick(1100);
  assert.deepEqual(shown, [0, 2]);
});

/** worker-raf: each rAF callback is a tick at its own time, on `now()`'s clock, logged as the vsync; stop ends the loop. */
test("raf ticks at the callback's time, and stops", async () => {
  const asked = [];
  globalThis.requestAnimationFrame = (f) => asked.push(f);
  const shown = [];
  const t0 = performance.timeOrigin + 100;
  const c = new Cine({ fps: 50, t0, source: "raf", show: async (i) => void shown.push(i) });
  assert.equal(asked.length, 1);
  asked[0](125);
  await sleep(0);
  assert.deepEqual(shown, [1]);
  assert.equal(c.log[0].vsync, t0 + 25);
  assert.equal(asked.length, 2);
  c.stop();
  asked[1](200);
  assert.equal(asked.length, 2);
  delete globalThis.requestAnimationFrame;
});

/** worker-timeout: each timer is set for the next frame's due time from now, so lateness does not add up. */
test("timeout waits until the next frame is due", async () => {
  const timer = globalThis.setTimeout;
  const set = [];
  globalThis.setTimeout = (f, ms) => set.push([f, ms]);
  const { c, shown } = rig("timeout", { fps: 50, lead: 30 });
  globalThis.setTimeout = timer;
  assert.equal(set.length, 1);
  assert.ok(set[0][1] > 25 && set[0][1] <= 30, `first wait ${set[0][1]} ms`);
  while (now() < c.t0 + 7);
  globalThis.setTimeout = (f, ms) => set.push([f, ms]);
  set[0][0]();
  globalThis.setTimeout = timer;
  await sleep(0);
  assert.deepEqual(shown, [0]);
  assert.ok(Math.abs(set[1][1] - (c.period - 7)) < 2, `second wait ${set[1][1]} ms, for a tick 7 ms late`);
  c.stop();
});

/** worker-channel: each task posts to itself again, and paints the frame once it is due, never before. */
test("channel paints each frame once due", async () => {
  const pump = pumped();
  const { c, shown } = rig("channel", { fps: 100, lead: 20 });
  const until = now() + 80;
  for (let task = 1; now() < until; task++) {
    assert.equal(pump.posted.length, task, "one post a task");
    await pump.task();
  }
  c.stop();
  pump.restore();
  assert.ok(shown.length >= 5, `painted ${shown.length}`);
  assert.deepEqual(shown, shown.map((_, k) => k));
  for (const e of c.log) assert.ok(e.tick >= c.t0 + e.i * c.period, `frame ${e.i} ticked early`);
});

/** worker-wait: each task blocks at most one period, then posts to itself, so the event loop runs between slices. */
test("wait blocks in slices of a period and yields between them", async () => {
  const pump = pumped();
  const wait = Atomics.wait;
  const slices = [];
  Atomics.wait = (a, i, v, ms) => (slices.push(ms), wait(a, i, v, ms));
  const { c, shown } = rig("wait", { fps: 50, lead: 50 });
  for (let task = 1; task <= 8; task++) {
    assert.equal(pump.posted.length, task, "one post a task");
    await pump.task();
    assert.ok(slices.length <= task, `${slices.length} slices in ${task} tasks`);
  }
  c.stop();
  Atomics.wait = wait;
  pump.restore();
  assert.ok(slices.every((ms) => ms > 0 && ms <= c.period), `slices ${slices}`);
  assert.ok(shown.length >= 3 && shown[0] === 0, `painted ${shown}`);
  for (const e of c.log) assert.ok(e.tick >= c.t0 + e.i * c.period, `frame ${e.i} ticked early`);
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
console.log(`clock: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
