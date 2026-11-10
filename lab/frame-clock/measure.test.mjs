// node lab/frame-clock/measure.test.mjs — the pre-registered score, VOID, saturation and rule, on made-up logs.
import assert from "node:assert/strict";
import { rule, score, verdict, voidRun } from "./measure.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const T = 1000 / 60;
/** 60 due frames at 60/s, vsyncs mid-period as the page sets them, and a draw of `ms` per frame from each due time. */
function run({ skip = [], ms = 4, extra = [] } = {}) {
  const draws = [];
  for (let i = 0; i < 60; i++) if (!skip.includes(i)) draws.push({ i, start: i * T, end: i * T + ms });
  return { t0: 0, period: T, ms: 1000, vsyncs: Array.from({ length: 62 }, (_, k) => (k + 0.5) * T), draws: [...draws, ...extra] };
}

/** Every frame drawn inside its period and alone before its vsync is on its tick; the gap is one period. */
test("a clean run has no frame late", () => {
  const s = score(run());
  assert.equal(s.due, 60);
  assert.equal(s.late, 0);
  assert.ok(Math.abs(s.gapP99 - T) < 1e-9);
  assert.equal(s.drawP99, 4);
});

/** A frame never drawn is late, and the gap across it is two periods. */
test("a frame not drawn is late", () => {
  const s = score(run({ skip: [10] }));
  assert.equal(s.late, 1);
  assert.ok(Math.abs(s.gapP99 - 2 * T) < 1e-9);
});

/** A draw that ends past its period is late, though drawn. */
test("a draw ending after its period is late", () => {
  const one = (end) => score({ t0: 0, period: T, ms: T, vsyncs: [T / 2, 1.5 * T, 2.5 * T], draws: [{ i: 0, start: 0, end }] }).late;
  assert.equal(one(T - 0.1), 0);
  assert.equal(one(T + 0.1), 1);
});

/** A draw followed by another before the vsync that would show it is superseded, so late. */
test("a superseded draw is late", () => {
  const two = (end1) => score({ t0: 0, period: T, ms: 2 * T, vsyncs: [T / 2, 1.5 * T, 2.5 * T], draws: [{ i: 0, start: 0, end: T / 4 }, { i: 1, start: T, end: end1 }] });
  assert.equal(two(T + 1).late, 0);
  const s = score({ t0: 0, period: T, ms: 2 * T, vsyncs: [T / 2, 1.5 * T], draws: [{ i: 0, start: 0, end: 1 }, { i: 1, start: 2, end: 3 }] });
  assert.equal(s.late, 2, "frame 0 superseded before the vsync at T/2; frame 1 drawn before its own period");
});

/** Without a vsync log, a draw is superseded by one ending within a display interval. */
test("without vsyncs, a draw followed within an interval is superseded", () => {
  const close = score({ t0: 0, period: 2 * T, ms: 4 * T, vsyncs: [], draws: [{ i: 0, start: 0, end: 1 }, { i: 1, start: 2 * T, end: 2 * T + 1 }] });
  assert.equal(close.late, 0);
  const near = score({ t0: 0, period: 2 * T, ms: 4 * T, vsyncs: [], draws: [{ i: 0, start: 0, end: 2 * T - 1 }, { i: 1, start: 2 * T, end: 2 * T + 1 }] });
  assert.equal(near.late, 1);
});

/** A busy run void unless every long task lasted 200 ms. */
test("a busy run with a short task is void", () => {
  assert.equal(voidRun({ busy: true, tasks: [200, 201] }), false);
  assert.equal(voidRun({ busy: true, tasks: [200, 199.9] }), true);
  assert.equal(voidRun({ busy: true, tasks: [] }), true);
  assert.equal(voidRun({ busy: false, tasks: [] }), false);
});

/** Rows for 14 rounds: page-raf at `ref` % late, its copy at `aa`, worker-raf at `raf`, which may vary by round. */
function rows({ ref = 40, aa = 40, raf = 0, gap = T, draw = 2 }) {
  const out = [];
  for (let round = 0; round < 14; round++) {
    out.push({ round, arm: "page-raf", latePct: ref, gapP99: 200, drawP99: draw });
    out.push({ round, arm: "page-raf′", latePct: aa, gapP99: 200, drawP99: draw });
    out.push({ round, arm: "worker-raf", latePct: typeof raf === "function" ? raf(round) : raf, gapP99: gap, drawP99: draw });
  }
  return out;
}

/** The A/A pair 2 points apart is not VOID; 2.5 is; and ≥ 16.7 ms apart in gap is. */
test("VOID by the A/A pair", () => {
  assert.equal(verdict(rows({ aa: 42 }), { period: T, busy: true }).void, false);
  assert.equal(verdict(rows({ aa: 42.5 }), { period: T, busy: true }).void, true);
  const gap = (ms) => verdict(rows({}).map((r) => (r.arm === "page-raf′" ? { ...r, gapP99: 200 + ms } : r)), { period: T, busy: true }).void;
  assert.equal(gap(16.69), false);
  assert.equal(gap(16.71), true);
});

/** The reference arm's draw p99 past period/2 marks the cell saturated. */
test("saturated past half a period", () => {
  assert.equal(verdict(rows({ draw: T / 2 }), { period: T, busy: true }).saturated, false);
  assert.equal(verdict(rows({ draw: T / 2 + 0.1 }), { period: T, busy: true }).saturated, true);
});

/** Busy: 20 points fewer late in 11 of 14 rounds, and gap p99 ≤ 2T, passes; 10 of 14, or a long gap, fails. */
test("a busy cell's bar for a worker arm", () => {
  const pass = (raf, gap = T) => verdict(rows({ raf, gap }), { period: T, busy: true }).arms["worker-raf"].passes;
  assert.equal(pass((r) => (r < 11 ? 20 : 40)), true);
  assert.equal(pass((r) => (r < 10 ? 20 : 40)), false);
  assert.equal(pass((r) => (r < 11 ? 21 : 40)), false);
  assert.equal(pass(0, 2 * T + 0.1), false);
});

/** Quiet: a worker arm passes when no worse than page-raf by more than the A/A difference. */
test("a quiet cell's bar for a worker arm", () => {
  const pass = (raf) => verdict(rows({ ref: 1, aa: 2, raf, gap: 200 }), { period: T, busy: false }).arms["worker-raf"].passes;
  assert.equal(pass(2), true);
  assert.equal(pass(2.5), false);
});

/** The rule takes worker-raf when it passes in every deciding 512² cell, a fallback by fewest late when it does not, else the page. */
test("the rule's order", () => {
  const cell = (busy, arms, more = {}) => ({ series: "s512", busy, void: false, saturated: false, arms, ...more });
  const ok = { passes: true, latePct: 1 };
  const no = { passes: false, latePct: 50 };
  assert.equal(rule([cell(true, { "worker-raf": ok, "worker-timeout": ok }), cell(false, { "worker-raf": ok, "worker-timeout": ok })]).clock, "worker-raf");
  const fall = rule([cell(true, { "worker-raf": no, "worker-timeout": { passes: true, latePct: 5 }, "worker-wait": { passes: true, latePct: 2 } })]);
  assert.equal(fall.clock, "worker-wait");
  assert.equal(rule([cell(true, { "worker-raf": no })]).clock, "page");
  assert.equal(rule([cell(true, { "worker-raf": no }, { void: true }), cell(true, { "worker-raf": ok })]).clock, "worker-raf");
  const big = { series: "mammo", name: "mammo/60/busy/1", busy: true, void: false, saturated: false, arms: { "worker-raf": no } };
  assert.deepEqual(rule([cell(true, { "worker-raf": ok }), big]).reversed, ["mammo/60/busy/1"]);
  assert.equal(rule([{ ...big, saturated: true }]).clock, null);
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
console.log(`frame-clock measure: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
