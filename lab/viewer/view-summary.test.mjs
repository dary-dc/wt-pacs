// node lab/viewer/view-summary.test.mjs — §7's guards and rule over rows. lab/viewer/view-summary.mjs
import { ARMS, decide } from "./view-summary.mjs";

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
};

const jitter = (round) => (round % 3) - 1;
/** 12 rounds of every arm in one cell of `kind`; `f(arm, round)` gives the row's own figures. */
function cell(engine, kind, f = () => ({}), set = "ct") {
  return ARMS.flatMap((arm) => Array.from({ length: 12 }, (_, round) => ({
    engine, set, throttle: 1, round, variant: arm, owed: kind === "asks" ? 10 : 76, frames: kind === "asks" ? 0 : 76,
    exact: kind === "asks" ? 10 : 76, errors: [], failures: 0, void: false, firstMs: 900 + jitter(round), fillMs: 5000 + jitter(round), pageCpuMs: 76,
    ...(kind !== "quiet" && { busy: true, tasks: { n: 20, minMs: 200 } }),
    ...(kind === "asks" && { asks: 10 }), ...(kind === "cine" && { cineS: 10 }),
    ...(kind === "asks" && { afterMs: Array(10).fill(60), screenMs: Array(10).fill(arm === "worker" ? 2 : 3) }),
    ...(kind === "cine" && { cine: { period: 100, latePct: arm === "worker" ? 0 : 40, gapP99: arm === "worker" ? 100 : 300, drawP99: 3 } }),
    ...f(arm, round),
  })));
}
/** The worker 100 ms sooner from decode to draw on a busy page, in every round. */
const sooner = (arm, round) => ({ screenMs: Array(10).fill(arm === "worker" ? 2 : 102 + jitter(round)) });
const engine = (e, more = {}) => [...cell(e, "quiet", more.quiet), ...cell(e, "asks", more.asks ?? sooner), ...cell(e, "cine", more.busy), ...cell(e, "busy", undefined, "mammo")];
const both = (more) => [...engine("chromium", more), ...engine("firefox", more)];

/** Sooner by the bar in every asks cell, cine on time where the page misses, the quiet fill held: B′. */
check(decide(both()).verdict === "adopt B′", `adopted (${decide(both()).verdict})`);

/** One frame not exact in any arm keeps A, whatever the timings. */
check(decide(both({ quiet: (arm, round) => (arm === "pageaa" && round === 4 ? { exact: 75 } : {}) })).verdict.startsWith("A stays: a frame"), "one inexact frame keeps A");

/** Sooner by the bar in 8 rounds of 12 is not enough. */
const eight = (arm, round) => (round < 4 && arm === "worker" ? { screenMs: Array(10).fill(102) } : sooner(arm, round));
check(decide(both({ asks: eight })).verdict.startsWith("A stays"), `8 of 12 rounds fail (${decide(both({ asks: eight })).verdict})`);

/** The worker's quiet fill ×1.03 the page's fails. */
const slowFill = (arm, round) => (arm === "worker" ? { fillMs: 5150 + jitter(round) } : {});
check(decide(both({ quiet: slowFill })).verdict.startsWith("A stays"), "a quiet fill ×1.03 fails");

/** Its first frame 17 ms later on a quiet page fails. */
check(decide(both({ quiet: (arm) => (arm === "worker" ? { firstMs: 917 } : {}) })).verdict.startsWith("A stays"), "a first frame 17 ms later fails");

/** Where the page's cine misses and the worker's misses too, it fails; where the page's does not miss, nothing is owed. */
const bothLate = (arm) => ({ cine: { period: 100, latePct: 40, gapP99: 300, drawP99: 3 } });
check(decide(both({ busy: bothLate })).verdict.startsWith("A stays"), "the worker's cine late where the page's is fails");
const onTime = () => ({ cine: { period: 100, latePct: 1, gapP99: 300, drawP99: 3 } });
check(decide(both({ busy: onTime })).verdict === "adopt B′", "no miss on the page owes nothing");

/** An A/A pair apart by more than its bound makes the cell VOID, so it decides nothing: here the only asks cell. */
const noisy = (arm, round) => (arm === "pageaa" ? { screenMs: Array(10).fill(120) } : sooner(arm, round));
const v = decide([...engine("chromium"), ...engine("firefox", { asks: noisy })]);
check(v.verdict === "undecided: no asks cell decided in firefox" && v.cells.some((c) => c.void && c.kind === "asks"), `a noisy A/A is VOID (${v.verdict})`);

/** A busy visit whose shortest task was under 200 ms is not counted: the cell falls short of 12 rounds. */
const shortTask = (arm, round) => ({ ...sooner(arm, round), ...(round === 0 && arm === "worker" && { tasks: { n: 20, minMs: 150 } }) });
const s = decide([...engine("chromium"), ...engine("firefox", { asks: shortTask })]);
check(s.cells.some((c) => c.short && c.engine === "firefox" && c.kind === "asks") && s.verdict.startsWith("undecided"), `a short task voids its visit (${s.verdict})`);

/** A cine cell whose page draw p99 passes half the period is saturated and decides nothing, even failing. */
const saturated = (arm) => ({ cine: { period: 100, latePct: 40, gapP99: 300, drawP99: 60 } });
check(decide(both({ busy: saturated })).verdict === "adopt B′", "a saturated cine cell decides nothing");

/** Rounds past the first 12 kept, run to replace dropped visits, are not counted: 8 wins in 12, then two more, still fail. */
const topUp = [...engine("chromium", { asks: eight }), ...engine("firefox"), ...cell("chromium", "asks", (arm, round) => ({ round: round + 12, ...sooner(arm, round) })).filter((r) => r.round < 14)];
check(decide(topUp).verdict.startsWith("A stays"), `rounds past 12 are not counted (${decide(topUp).verdict})`);

console.log(`view summary: ${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
