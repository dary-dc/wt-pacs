import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "./report.mjs";

const series = (v) => new Map(v.map((x, i) => [i, x]));
const jitter = (v) => Array.from({ length: 10 }, (_, i) => v * (1 + (i - 4.5) / 1000));
const cell = ({ w = 100, aa = jitter(100), w2 = 100, r = 96, s = 80 } = {}) => {
  const ten = (x) => (Array.isArray(x) ? x : Array(10).fill(x));
  return { W: series(ten(w)), "W′": series(ten(aa)), W2: series(ten(w2)), R: series(ten(r)), S: series(ten(s)) };
};
const one = (key, c) => decide(new Map([[key, c]]));

/** R passes a DBT cell only with R ÷ W2's interval below 1.00 and its median ≤ 0.97, paired against W2 and not W. */
test("R on a DBT cell", () => {
  assert.equal(one("1|dbts_a1", cell()).rDefault, true);
  assert.equal(one("1|dbts_a1", cell({ r: 98 })).rDefault, false);
  assert.equal(one("1|dbts_a1", cell({ r: jitter(97.2) })).rDefault, false);
  assert.equal(one("1|dbts_a1", cell({ w: 110, w2: 100, r: 99 })).rDefault, false);
  assert.equal(one("1|dbts_a1", cell({ r: [...Array(8).fill(90), 100.5, 100.5] })).rDefault, false);
});

/** On the small frame R passes with an upper end ≤ 1.02, and S has no condition there. */
test("R on mr_ispy1", () => {
  assert.equal(one("4|mr_ispy1", cell({ r: 101.5, s: 100 })).rDefault, true);
  assert.equal(one("4|mr_ispy1", cell({ r: 102.5 })).rDefault, false);
  assert.equal(one("4|mr_ispy1", cell({ s: 100 })).sProposed, true);
});

/** S is proposed only when S ÷ W2's interval lies entirely below 0.90 in every DBT cell. */
test("S", () => {
  assert.equal(one("1|dbts_b1", cell({ s: 89 })).sProposed, true);
  assert.equal(one("1|dbts_b1", cell({ s: 90 })).sProposed, false);
  assert.equal(decide(new Map([["1|dbts_b1", cell()], ["4|dbts_c1", cell({ s: 95 })]])).sProposed, false);
});

/** One A/A miss stands; two void the run. */
test("A/A", () => {
  const miss = cell({ aa: 110 });
  assert.equal(decide(new Map([["1|dbts_a1", miss], ["4|dbts_a1", cell()]])).aaVoid, false);
  assert.equal(decide(new Map([["1|dbts_a1", miss], ["4|dbts_a1", miss]])).aaVoid, true);
});
