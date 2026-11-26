// node lab/viewer/busy-summary.test.mjs — the busy page's asks on the mean, its guards and rule. lab/viewer/busy-summary.mjs
import { ARMS, asks, cells, verdicts } from "./busy-summary.mjs";

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
};

/** The page busy 200 ms every 500 ms from t = 0; ten asks handed off 137 ms apart, so some land in a task. */
const SPANS = Array.from({ length: 6 }, (_, k) => [500 * k + 100, 500 * k + 300]);
const HANDOFFS = Array.from({ length: 10 }, (_, k) => 150 + 137 * k);
const inTask = (h) => SPANS.find(([a, b]) => h >= a && h < b);
/** §2's model: the page waits what is left of a task, then its quiet path; the view worker takes its quiet path alone. */
const waits = (quiet) => (h) => quiet + (inTask(h) ? inTask(h)[1] - h : 0);
const quietly = (quiet) => () => quiet;
const MODEL = { page: waits(12), pageaa: waits(12), workerfix: quietly(12) };

const visit = (arm, round, screen, more = {}) => ({
  engine: "chromium", set: "ct", throttle: 1, round, variant: arm, busy: true, asks: 10, exact: 10, errors: [], failures: 0, void: false,
  tasks: { n: 6, minMs: 200 }, spans: SPANS, handoffs: HANDOFFS, screenMs: HANDOFFS.map(screen), ...more,
});
const cell = (model, rounds = 12, more = () => ({})) => ARMS.flatMap((arm) => Array.from({ length: rounds }, (_, k) => visit(arm, k, model[arm], more(arm, k))));
const one = (rows) => cells(rows)[0];

/** An ask is in a task when its hand-off is at or after the task's start and before its end; `left` is the rest of it. */
const a = asks(visit("page", 0, waits(12)));
check(a.inTaskN === HANDOFFS.filter(inTask).length && a.inTaskN > 0 && a.inTaskN < 10, `in-task asks ${a.inTaskN}`);
check(Math.abs(a.excess - 12) < 1e-9 && a.quiet === 12, `the page's excess over what is left is its quiet path (${a.excess}, ${a.quiet})`);
const edge = asks({ ...visit("page", 0, quietly(12)), handoffs: [100, 300, ...HANDOFFS.slice(2)] });
check(edge.inTaskN === HANDOFFS.slice(2).filter(inTask).length + 1, "a hand-off at a task's start is in it; at its end, not");

/** §2's prediction met: B′ wins on the mean and in a task in every round. */
const won = one(cell(MODEL));
check(won.decided && won.meanWins === 12 && won.inTaskWins === 12 && won.passes, JSON.stringify({ m: won.meanWins, t: won.inTaskWins }));
check(verdicts(cell(MODEL)).chromium.verdict === "B′ wins the busy page", verdicts(cell(MODEL)).chromium.verdict);

/** The view worker waiting out the task as the page does: no win, and B′ does not win. */
const tied = one(cell({ ...MODEL, workerfix: waits(12) }));
check(tied.meanWins === 0 && tied.inTaskWins === 0 && !tied.passes, "B′ waiting as A wins nothing");
check(verdicts(cell({ ...MODEL, workerfix: waits(12) })).chromium.verdict.startsWith("B′ does not win"), "a failing cell: B′ does not win");

/** The bar is 16.7 ms: B′ sooner in a task by 16.7 ms wins the round, by 16.6 does not. */
const by = (d) => one(cell({ page: quietly(30), pageaa: quietly(30), workerfix: quietly(30 - d) }));
check(by(16.7).inTaskWins === 12 && by(16.6).inTaskWins === 0, `in a task, 16.7 ms ${by(16.7).inTaskWins}, 16.6 ms ${by(16.6).inTaskWins}`);
check(by(16.7).meanWins === 12 && by(16.6).meanWins === 0, `on the mean, 16.7 ms ${by(16.7).meanWins}, 16.6 ms ${by(16.6).meanWins}`);

/** B′ sooner in a task but slower elsewhere, so that its mean is not sooner: the cell fails on the mean alone. */
const slower = one(cell({ ...MODEL, workerfix: (h) => (inTask(h) ? 12 : 200) }));
check(slower.inTaskWins === 12 && slower.meanWins === 0 && !slower.passes, `mean ${slower.meanWins}, in a task ${slower.inTaskWins}`);

/** Nine rounds pass, eight do not: B′'s gain removed from the last three, then four, rounds. */
const lose = (n) => one(cell(MODEL, 12, (arm, k) => (arm === "workerfix" && k >= 12 - n ? { screenMs: HANDOFFS.map(waits(12)) } : {}))).passes;
check(lose(3) && !lose(4), "9 of 12 rounds pass, 8 do not");

/** A round where either arm had no ask in a task is not an in-task win. */
const none = one(cell(MODEL, 12, (arm, k) => (k < 4 && arm === "workerfix" ? { handoffs: HANDOFFS.map((h) => h + 1e6) } : {})));
check(none.inTaskWins === 8 && none.meanWins === 12 && !none.passes, `B′ with no in-task asks in four rounds: ${none.inTaskWins} wins`);

/** The A/A pair apart by 8 ms on the quiet path, or on the excess past what is left of the task, makes the cell VOID. */
const aa = (f) => one(cell({ ...MODEL, pageaa: f })).void;
const quietAt = (q) => (h) => (inTask(h) ? waits(12)(h) : q);
check(aa(quietAt(20)) && !aa(quietAt(19.9)), "the A/A bar on the quiet path");
check(aa((h) => 12 + (inTask(h) ? inTask(h)[1] - h + 8 : 0)) && !aa((h) => 12 + (inTask(h) ? inTask(h)[1] - h + 7.9 : 0)), "the A/A bar on the excess");
check(verdicts(cell({ ...MODEL, pageaa: waits(40) })).chromium.verdict === "undecided: no asks cell decided", "a VOID cell decides nothing");

/** The page's quiet path past 50 ms saturates the cell; under 12 rounds it is short; a cell counts its first 12. */
check(one(cell({ page: waits(51), pageaa: waits(51), workerfix: quietly(20) })).saturated, "the quiet path past 50 ms saturates");
check(!one(cell({ page: waits(50), pageaa: waits(50), workerfix: quietly(20) })).saturated, "50 ms does not");
check(one(cell(MODEL, 11)).short && one(cell(MODEL, 14)).rounds === 12, "short at 11 rounds; 12 counted of 14");

/** A dropped visit (VOID relay, a short task, an ask without its hand-off) costs its round; a frame not exact, the verdict. */
const drop = (more) => one(cell(MODEL, 12, (arm, k) => (arm === "page" && k === 5 ? more : {}))).rounds;
check(drop({ void: true }) === 11 && drop({ tasks: { n: 6, minMs: 150 } }) === 11 && drop({ handoffs: HANDOFFS.slice(1) }) === 11, "dropped visits");
check(verdicts(cell(MODEL, 12, (arm, k) => (k === 0 && arm === "workerfix" ? { exact: 9 } : {}))).chromium.verdict === "B′ does not win: a frame not exact", "a frame not exact");

/** Cine, as §7: B′ on time where A misses passes; B′ late, or its gap p99 past two periods, fails; A/A and saturation guard. */
const CINE = { page: { latePct: 20, gapP99: 270, drawP99: 25 }, pageaa: { latePct: 20, gapP99: 270, drawP99: 25 }, workerfix: { latePct: 0, gapP99: 117, drawP99: 25 } };
const cine = (t) => ARMS.flatMap((arm) => Array.from({ length: 12 }, (_, k) => ({
  engine: "chromium", set: "ct", throttle: 1, round: k, variant: arm, busy: true, cineS: 10, frames: 76, exact: 76, errors: [], failures: 0, void: false,
  tasks: { n: 20, minMs: 200 }, cine: { period: 100, ...t[arm] } })));
check(one(cine(CINE)).decided && one(cine(CINE)).passes, "cine: B′ on time where A misses");
check(!one(cine({ ...CINE, workerfix: { ...CINE.workerfix, latePct: 3 } })).passes, "cine: B′ 3 points late fails");
check(!one(cine({ ...CINE, workerfix: { ...CINE.workerfix, gapP99: 201 } })).passes, "cine: B′'s gap p99 past two periods fails");
check(one(cine({ ...CINE, pageaa: { ...CINE.page, latePct: 23 } })).void && one(cine({ ...CINE, page: { ...CINE.page, drawP99: 51 } })).saturated, "cine: VOID and saturated");
check(verdicts(cine(CINE)).chromium.verdict === "undecided: no asks cell decided", "cine alone decides no engine");

console.log(failed ? `${failed} failed` : "busy summary: in-task asks, the mean and in-task rule, the A/A and saturation guards, cine: ok");
process.exit(failed ? 1 : 0);
