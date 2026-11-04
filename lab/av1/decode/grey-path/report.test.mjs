import assert from "node:assert/strict";
import { test } from "node:test";
import { read, reading, rounds } from "./report.mjs";

const frames = (ms) => Array.from({ length: 16 }, () => ({ decode: ms }));
/** rows for one cell: W at 100 ms, each arm at its ratio × 100 with a ±1 % alternation so intervals have width. */
function rowsOf(ratios, n = 40, set = "s", throttle = 1) {
  return Array.from({ length: n }, (_, round) => Object.entries({ W: 1, ...ratios }).map(([arm, x]) => ({
    round, throttle, set, arm, frames: frames(100 * x * (arm === "W" ? 1 : 1 + (round % 2 ? 0.01 : -0.01) * (round % 5) / 4)),
  }))).flat();
}

/** An interval entirely below 1 is a speed-up, entirely above a cost, one across 1 not resolved. */
test("reading", () => {
  assert.equal(reading({ lo: 0.9, hi: 0.999 }), "speed-up");
  assert.equal(reading({ lo: 1.001, hi: 1.1 }), "cost");
  assert.equal(reading({ lo: 0.99, hi: 1.01 }), "not resolved");
  assert.equal(reading({ lo: 0.99, hi: 1 }), "not resolved");
  assert.equal(reading({ lo: 1, hi: 1.01 }), "not resolved");
});

/** M is W2 ÷ W and R is R ÷ W2, not R ÷ W. */
test("references", () => {
  const { lines } = read(rounds(rowsOf({ "W′": 1, W2: 0.9, R: 0.9 * 1.05 })), true);
  assert.equal(reading(lines[0].M), "speed-up");
  assert.equal(reading(lines[0].R), "cost");
  assert.ok(Math.abs(lines[0].R.ratio - 1.05) < 0.01);
});

/** The run is void when not every frame is exact, or when the A/A misses in two cells; one miss is allowed. */
test("void", () => {
  const ok = { "W′": 1, W2: 1, R: 1 };
  const miss = { "W′": 1.1, W2: 1, R: 1 };
  assert.equal(read(rounds(rowsOf(ok)), false).verdict, "void: not every frame exact");
  assert.equal(read(rounds([...rowsOf(miss, 40, "a"), ...rowsOf(ok, 40, "b")]), true).verdict, "read");
  assert.equal(read(rounds([...rowsOf(miss, 40, "a"), ...rowsOf(miss, 40, "b")]), true).verdict, "void: the A/A missed in 2 cells");
});

/** A cost of M is named by its cell. */
test("M's cost named", () => {
  const d = read(rounds(rowsOf({ "W′": 1, W2: 1.1, R: 1 }, 40, "usb_cine", 4)), true);
  assert.deepEqual(d.mCosts, ["usb_cine at 4×"]);
});
