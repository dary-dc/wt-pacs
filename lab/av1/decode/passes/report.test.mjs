import assert from "node:assert/strict";
import test from "node:test";
import { decide, effect, rank } from "./report.mjs";

/** The interval's rank is the largest k with P(Binomial(n, ½) ≤ k − 1) ≤ 0.025, at sizes worked by hand. */
test("rank", () => {
  assert.equal(rank(5), 0); // P(X ≤ 0) = 1/32 > 0.025: no interval
  assert.equal(rank(6), 1); // 1/64 ≤ 0.025 < 7/64
  assert.equal(rank(10), 2); // 11/1024 ≤ 0.025 < 56/1024
  assert.equal(rank(42), 15);
  assert.equal(rank(150), 63);
});

/** The interval is the k-th and (n − k + 1)-th ordered values, as ratios. */
test("effect", () => {
  const e = effect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => Math.log(x)));
  assert.equal(e.lo.toFixed(6), "2.000000");
  assert.equal(e.hi.toFixed(6), "9.000000");
  assert.equal(e.ratio.toFixed(6), (Math.exp((Math.log(5) + Math.log(6)) / 2)).toFixed(6));
});

const cell = (w, aa, w2) => ({ W: new Map(w.map((v, i) => [i, v])), "W′": new Map(aa.map((v, i) => [i, v])), W2: new Map(w2.map((v, i) => [i, v])) });
const ten = (v) => Array(10).fill(v);
const jitter = (v) => Array.from({ length: 10 }, (_, i) => v * (1 + (i - 4.5) / 1000));

/** A DBT cell passes only below 1 with a median ≤ 0.97; the ultrasound only with an upper end ≤ 1.02; two A/A misses void. */
test("decide", () => {
  const good = cell(ten(100), jitter(100), ten(96));
  assert.equal(decide(new Map([["1|dbts_a1", good]])).pass, true);
  assert.equal(decide(new Map([["1|dbts_a1", cell(ten(100), jitter(100), ten(98))]])).pass, false);
  assert.equal(decide(new Map([["1|us_liver", cell(ten(100), jitter(100), ten(101))]])).pass, true);
  assert.equal(decide(new Map([["1|us_liver", cell(ten(100), jitter(100), ten(103))]])).pass, false);
  const miss = cell(ten(100), ten(110), ten(96));
  assert.equal(decide(new Map([["1|dbts_a1", miss]])).aaVoid, false);
  assert.equal(decide(new Map([["1|dbts_a1", miss], ["4|dbts_a1", miss]])).aaVoid, true);
});
