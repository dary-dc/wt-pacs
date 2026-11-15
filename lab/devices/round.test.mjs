/** node lab/devices/round.test.mjs — the round's rules: a load's failure, the timer gap, the verdict. */
import assert from "node:assert/strict";
import { balanced } from "../order.mjs";
import { ARMS, SERIES, STOPPED_GAP_MS, TICK_MS, fillFailure, largestGap, roundOrder, verdict } from "./round.mjs";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** A fill fails on its own error, on a frame short, or on the first error the page collected; whole and clean, it passes. */
test("a fill's failure is its error, a frame short, or its first error", () => {
  const frames = [{ i: 0 }, { i: 1 }];
  assert.equal(fillFailure({ error: "connect: refused" }, 2), "connect: refused");
  assert.equal(fillFailure({ frames: frames.slice(1) }, 2), "received 1 of 2");
  assert.equal(fillFailure({ frames, errors: ["frame 1: digest"] }, 2), "frame 1: digest");
  assert.equal(fillFailure({ frames, errors: [] }, 2), null);
});

/** The gap is the largest between consecutive ticks, not the span, so a steady ticker over a long load has none. */
test("the gap is the largest between consecutive ticks", () => {
  const steady = Array.from({ length: 400 }, (_, k) => k * TICK_MS);
  assert.equal(largestGap(steady), TICK_MS);
  assert.equal(largestGap([0, 250, 2900, 3150]), 2650);
  assert.equal(largestGap([5]), 0);
});

/** A gap past 2 s makes the load VOID: stopped, even when it otherwise passed; a gap at the bar does not. */
test("a gap past the bar is VOID: stopped, whatever else happened", () => {
  assert.deepEqual(verdict(null, STOPPED_GAP_MS), { ok: true, gapMs: STOPPED_GAP_MS });
  const v = verdict(null, STOPPED_GAP_MS + 1);
  assert.equal(v.ok, false);
  assert.equal(v.void, "stopped");
  assert.equal(verdict("received 1 of 2", 3000).void, "stopped");
});

/** A failed load says why and is not VOID: it counts as the failure it is. */
test("a failed load says why and is not void", () => {
  assert.deepEqual(verdict("received 1 of 2", 300), { ok: false, why: "received 1 of 2", gapMs: 300 });
});

/**
 * The round's order is next-round.md §4's: four warm-ups not counted, then cell 2's 16 rounds each a Williams row of
 * the four arms, the series alternating by round (8 each, 64 loads, every arm before and after every other equally), then
 * cell 3's 24 pairs in ABBA order (48 loads).
 */
test("the round's order is the protocol's", async () => {
  const loads = await roundOrder();
  assert.equal(loads.length, 4 + 64 + 48);
  assert.ok(loads.slice(0, 4).every((l) => !l.counted));
  const cell2 = loads.filter((l) => l.cell === "2" && l.counted);
  assert.equal(cell2.length, 64);
  for (let r = 0; r < 16; r += 1) {
    const round = cell2.filter((l) => l.round === r);
    assert.deepEqual([...round.map((l) => l.arm)].sort(), [...ARMS].sort());
    assert.ok(round.every((l) => l.series === SERIES[r % 2]));
  }
  const rows = cell2.map((l, k) => ({ unit: l.arm, prev: k % 4 ? cell2[k - 1].arm : undefined }));
  for (const arm of ARMS) assert.ok(balanced(rows, arm, ARMS), `${arm} balanced`);
  const cell3 = loads.filter((l) => l.cell === "3");
  assert.equal(cell3.length, 48);
  assert.deepEqual(cell3.slice(0, 4).map((l) => l.view), ["page", "worker", "worker", "page"]);
  assert.ok(cell3.every((l) => l.seq === "view"));
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
console.log(`round: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
