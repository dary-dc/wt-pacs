// node lab/paint-read/measure.test.mjs — the probe's scoring: which calls start in a long task, and a cell's verdict.
import assert from "node:assert/strict";
import { cell, visit, VARIANTS } from "./measure.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const TASKS = [200, 200];
const SPANS = [[100, 300], [600, 800]];

/** A call that starts inside a task and lasts at least half the rest of it waits; one that starts outside is not counted in the task. */
test("a call starting in a task is timed against what is left of it", () => {
  const v = visit({ busy: true, tasks: TASKS, spans: SPANS, calls: [[0, 2], [150, 120], [300, 2], [650, 120]] });
  assert.equal(v.inTask.n, 2);
  assert.equal(v.inTask.left, 150);
  assert.equal(v.inTask.excess, -30);
  assert.equal(v.waits, true);
  assert.equal(v.n, 4);
});

/** A call starting at a task's end is outside it, and a short call inside a task does not wait. */
test("a short call in a task does not wait", () => {
  const v = visit({ busy: true, tasks: TASKS, spans: SPANS, calls: [[100, 1], [700, 1], [800, 1]] });
  assert.equal(v.inTask.n, 2);
  assert.equal(v.waits, false);
});

/** A busy visit whose shortest long task is under 200 ms is dropped, as §7's guard drops it. */
test("a busy visit with a short task is dropped", () => {
  assert.equal(visit({ busy: true, tasks: [200, 199.9], spans: SPANS, calls: [[0, 1]] }).kept, false);
  assert.equal(visit({ busy: true, tasks: [], spans: [], calls: [[0, 1]] }).kept, false);
  assert.equal(visit({ busy: false, tasks: [], calls: [[0, 1]] }).kept, true);
});

/** Timed-out fences are counted. */
test("a timed-out call is counted", () => {
  assert.equal(visit({ busy: false, calls: [[0, 1000, 1], [20, 1]] }).timedOut, 1);
});

const rows = (rounds, msOf) => Array.from({ length: rounds }, (_, round) => VARIANTS.map((variant) => ({
  engine: "x", round, variant, busy: true, tasks: TASKS, spans: SPANS, calls: [[0, 0.5], [120, msOf(variant, round)], [620, msOf(variant, round)]],
}))).flat();

/** The first 12 rounds in which the read waits in 10 say "waits"; a variant that never waits says "does not wait". */
test("a cell's verdict counts the rounds that waited", () => {
  const c = cell(rows(14, (x, r) => (x.startsWith("read") ? (r < 10 ? 180 : 1) : 1)), { busy: true, period: 20 });
  assert.equal(c.decided, true);
  assert.equal(c.rounds, 12);
  assert.equal(c.variants.read.waits, "waits");
  assert.equal(c.variants.read.waited, 10);
  assert.equal(c.variants.none.waits, "does not wait");
  assert.equal(c.void, false);
  assert.equal(c.saturated, false);
});

/** 9 of 12 is neither: "mixed". Under 12 rounds, nothing is decided. */
test("nine rounds of twelve are mixed, and eleven rounds decide nothing", () => {
  assert.equal(cell(rows(12, (x, r) => (x === "read" || x === "read′" ? (r < 9 ? 180 : 1) : 1)), { busy: true, period: 20 }).variants.read.waits, "mixed");
  const short = cell(rows(11, () => 1), { busy: true, period: 20 });
  assert.equal(short.decided, false);
  assert.equal(short.variants.read.waits, null);
});

/** The A/A pair apart by more than max(2 ms, 20 %) is VOID; the probe's draw alone past half the period is saturated. */
test("the A/A bar and the saturation guard", () => {
  assert.equal(cell(rows(12, (x) => (x === "read" ? 180 : x === "read′" ? 140 : 1)), { busy: true, period: 20 }).void, true);
  assert.equal(cell(rows(12, (x) => (x === "read" ? 180 : x === "read′" ? 150 : 1)), { busy: true, period: 20 }).void, false);
  assert.equal(cell(rows(12, (x) => (x === "none" ? 11 : 1)), { busy: true, period: 20 }).saturated, true);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
