// node client/paint/voi.test.mjs — the window table against values worked by hand from PS3.3 C.11.
import assert from "node:assert/strict";
import { rescale, tableShape, toCode, voi, windowTable } from "./voi.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const code = (fn, c, w, x) => toCode(voi(fn, c, w)(x));
const grey = (bits, signed) => ({ bits, signed, components: 1 });

/** LINEAR at c = 100, w = 11: below 94.5 is 0, above 104.5 is 255, and x = 95 is ((95 − 99.5)/10 + 0.5) × 255 = 12.75. */
test("LINEAR: the edges and the −0.5", () => {
  assert.equal(code("LINEAR", 100, 11, 94.5), 0);
  assert.equal(code("LINEAR", 100, 11, 95), 13);
  assert.equal(code("LINEAR", 100, 11, 104.5), 255);
  assert.equal(code("LINEAR", 100, 11, 104.6), 255);
  assert.ok(Math.abs(voi("LINEAR", 100, 11)(95) - 12.75) < 1e-9);
});

/** LINEAR's smallest width, 1, is a step at c − 0.5; a width under 1 is refused by name. */
test("LINEAR: width 1 is a step, under 1 refused", () => {
  assert.equal(code("LINEAR", 10, 1, 9.5), 0);
  assert.equal(code("LINEAR", 10, 1, 9.51), 255);
  assert.throws(() => voi("LINEAR", 10, 0.5), /LINEAR needs a window width ≥ 1/);
});

/** LINEAR_EXACT at c = 100, w = 10: x ≤ 95 is 0, x > 105 is 255, x = 95.5 is (−0.45 + 0.5) × 255 = 12.75. */
test("LINEAR_EXACT: the edges", () => {
  assert.equal(code("LINEAR_EXACT", 100, 10, 95), 0);
  assert.equal(code("LINEAR_EXACT", 100, 10, 95.5), 13);
  assert.equal(code("LINEAR_EXACT", 100, 10, 105), 255);
  assert.equal(code("LINEAR_EXACT", 100, 10, 105.01), 255);
  assert.ok(Math.abs(voi("LINEAR_EXACT", 100, 10)(95.5) - 12.75) < 1e-9);
});

/** LINEAR and LINEAR_EXACT differ at the same c and w: x = 95, c = 100, w = 11 is 12.75 against 11.59. */
test("LINEAR and LINEAR_EXACT are not the same function", () => {
  assert.equal(code("LINEAR", 100, 11, 95), 13);
  assert.equal(code("LINEAR_EXACT", 100, 11, 95), 12);
});

/** LINEAR_EXACT and SIGMOID take any width > 0 and refuse 0: at w = 0.001, x = 0.0004 is 0.9 × 255 = 229.5. */
test("LINEAR_EXACT and SIGMOID: width > 0", () => {
  assert.equal(code("LINEAR_EXACT", 0, 0.001, 0.0004), 230);
  assert.equal(code("LINEAR_EXACT", 0, 0.001, 0.0006), 255);
  assert.throws(() => voi("LINEAR_EXACT", 0, 0), /LINEAR_EXACT needs a window width > 0/);
  assert.throws(() => voi("SIGMOID", 0, 0), /SIGMOID needs a window width > 0/);
  assert.throws(() => voi("GAMMA", 0, 1), /VOI LUT function GAMMA/);
});

/** SIGMOID at c = 0, w = 4: 255 / (1 + e^(−x)) — 127.5 at 0, 186.42 at 1, 68.58 at −1. */
test("SIGMOID", () => {
  assert.equal(code("SIGMOID", 0, 4, 0), 128);
  assert.equal(code("SIGMOID", 0, 4, 1), 186);
  assert.equal(code("SIGMOID", 0, 4, -1), 69);
});

/** Half rounds up: 127.5 (the centre of LINEAR c = 100, w = 11, and of LINEAR_EXACT) is 128, not 127. */
test("half rounds up, then clamps", () => {
  assert.equal(code("LINEAR", 100, 11, 99.5), 128);
  assert.equal(code("LINEAR_EXACT", 100, 10, 100), 128);
  assert.equal(toCode(-3), 0);
  assert.equal(toCode(300), 255);
});

/** A missing, zero or non-finite slope is 1 and a non-finite intercept 0; a negative intercept is kept. */
test("rescale defaults", () => {
  assert.deepEqual(rescale(), { slope: 1, intercept: 0 });
  assert.deepEqual(rescale({ slope: 0, intercept: NaN }), { slope: 1, intercept: 0 });
  assert.deepEqual(rescale({ slope: Infinity, intercept: -1024 }), { slope: 1, intercept: -1024 });
});

/** CT: stored 1024 with intercept −1024 is x = 0, the centre of LINEAR_EXACT c = 0, w = 10 → 128. */
test("a negative intercept moves the window", () => {
  const t = windowTable(grey(12, false), { voi: { center: 0, width: 10, function: "LINEAR_EXACT" }, rescale: { slope: 1, intercept: -1024 } });
  assert.equal(t.length, 65536);
  assert.equal(t[1024], 128);
  assert.equal(t[1018], 0);
  assert.equal(t[1030], 255);
});

/** A signed 16-bit code s sits at s + 32 768: stored −1000 is the centre of a window at −1000. */
test("signed 16-bit input", () => {
  assert.deepEqual(tableShape(grey(16, true)), { entries: 65536, offset: 32768 });
  const t = windowTable(grey(16, true), { voi: { center: -1000, width: 10, function: "LINEAR_EXACT" } });
  assert.equal(t[32768 - 1000], 128);
  assert.equal(t[0], 0);
  assert.equal(t[65535], 255);
});

/** MONOCHROME1 is shown inverted; a user invert on top of it shows it as stored. */
test("MONOCHROME1 and invert", () => {
  const v = { voi: { center: 127.5, width: 256, function: "LINEAR_EXACT" } };
  const m2 = windowTable(grey(8, false), v);
  const m1 = windowTable(grey(8, false), { ...v, photometric: "MONOCHROME1" });
  const both = windowTable(grey(8, false), { ...v, photometric: "MONOCHROME1", invert: true });
  for (const i of [0, 1, 77, 200, 255]) {
    assert.equal(m1[i], 255 - m2[i]);
    assert.equal(both[i], m2[i]);
  }
});

/** RGB takes no VOI: its table is the identity, inverted on request; any other interpretation is declined by name. */
test("RGB as stored, others declined", () => {
  const rgb = { bits: 8, signed: false, components: 3 };
  const t = windowTable(rgb, { photometric: "RGB" });
  assert.equal(t[0], 0);
  assert.equal(t[200], 200);
  assert.equal(windowTable(rgb, { photometric: "RGB", invert: true })[200], 55);
  assert.throws(() => windowTable(rgb, { photometric: "YBR_FULL" }), /YBR_FULL is not painted/);
  assert.throws(() => windowTable(grey(8, false), { photometric: "RGB" }), /RGB with 1 component/);
});

const WINDOWS = [
  { voi: { center: 100, width: 11, function: "LINEAR" } },
  { voi: { center: 10, width: 1, function: "LINEAR" } },
  { voi: { center: 100, width: 10, function: "LINEAR_EXACT" } },
  { voi: { center: 0, width: 0.001, function: "LINEAR_EXACT" } },
  { voi: { center: 0, width: 4, function: "SIGMOID" } },
  { voi: { center: 0, width: 10, function: "LINEAR_EXACT" }, rescale: { slope: 1, intercept: -1024 } },
  { voi: { center: 900, width: 37, function: "LINEAR" }, rescale: { slope: 0.7, intercept: 3.1 }, photometric: "MONOCHROME1" },
];

/** At reduced depth, entry p is the full-scale entry of stored (p << shift) − bias, for every p, window, shift and bias. */
test("a reduced frame's table is the full table at (p << shift) − bias", () => {
  const full = grey(16, true);
  for (const bits of [8, 10]) {
    for (const shift of [0, 1, 2, 4]) {
      for (const bias of [0, 37]) {
        for (const d of WINDOWS) {
          const want = windowTable(full, d);
          const got = windowTable({ ...grey(bits, false), reduced: { shift, bias } }, d);
          for (let p = 0; p < 1 << bits; p++) assert.equal(got[p], want[(p << shift) - bias + 32768], `p ${p} shift ${shift}`);
        }
      }
    }
  }
});

/** Dividing LINEAR's c and w by 2^k is not the same window: at k = 2, c = 100, w = 11, p = 24 (stored 96) is 38, not 55. */
test("LINEAR's window does not scale with the samples", () => {
  assert.equal(code("LINEAR", 100, 11, 24 << 2), 38);
  assert.equal(code("LINEAR", 100 / 4, 11 / 4, 24), 55);
  const t = windowTable({ ...grey(10, false), reduced: { shift: 2, bias: 0 } }, { voi: { center: 100, width: 11, function: "LINEAR" } });
  assert.equal(t[24], 38);
});

/** A reduced frame is grey only. */
test("RGB at reduced depth is refused", () => {
  const rgb = { bits: 8, signed: false, components: 3, reduced: { shift: 1, bias: 0 } };
  assert.throws(() => windowTable(rgb, { photometric: "RGB" }), /RGB is not painted at reduced depth/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`voi: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
