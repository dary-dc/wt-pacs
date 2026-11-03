// node lab/viewer/rule-summary.test.mjs — §7's rule with the corrected quiet bars, over rows. lab/viewer/rule-summary.mjs
import { ARMS, decide } from "./rule-summary.mjs";

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
};

const B = ARMS[2];
const jitter = (round) => (round % 3) - 1;
/** 12 rounds of every arm in one Chromium cell of `kind`; `f(arm, round)` gives the row's own figures. */
function cell(kind, f = () => ({}), set = "ct", frames = 76) {
  return ARMS.flatMap((arm) => Array.from({ length: 12 }, (_, round) => ({
    engine: "chromium", set, throttle: 1, round, variant: arm, owed: kind === "asks" ? 10 : frames, frames: kind === "asks" ? 0 : frames,
    exact: kind === "asks" ? 10 : frames, errors: [], failures: 0, void: false, pageCpuMs: 76,
    firstMs: 600 + jitter(round), firstHeldMs: 580, lastHeldMs: 3580 + jitter(round), fillMs: 3500, boot: { connect: 150 }, cores: { start: 0.5, fill: 0.3 },
    ...(kind !== "quiet" && { busy: true, tasks: { n: 20, minMs: 200 } }),
    ...(kind === "asks" && { asks: 10, afterMs: Array(10).fill(60), screenMs: Array(10).fill(arm === B ? 2 : 102 + jitter(round)) }),
    ...(kind === "cine" && { cineS: 10, cine: { period: 100, latePct: arm === B ? 0 : 20, gapP99: arm === B ? 117 : 283, drawP99: 25 } }),
    ...f(arm, round),
  })));
}
const run = (more = {}) => [...cell("quiet", more.quiet), ...cell("quiet", more.mammo, "mammo", 1), ...cell("asks", more.asks), ...cell("cine", more.cine), ...cell("busy", undefined, "mammo", 1)];
const verdict = (rows) => decide(rows).verdict;

/** B′ sooner by the bar in every asks round, on time in cine where A misses, tied on both quiet bars: it replaces A. */
check(verdict(run()) === "B′ replaces A", `replaces A (${verdict(run())})`);

/** One frame not exact, in any arm, keeps A. */
check(verdict(run({ quiet: (arm, round) => (arm === "pageaa" && round === 5 ? { exact: 75 } : {}) })).startsWith("A stays: a frame"), "an inexact frame keeps A");

/** Latency: B′'s first exact frame 17 ms later fails the quiet cell. */
check(verdict(run({ quiet: (arm, round) => (arm === B ? { firstMs: 617 + jitter(round) } : {}) })).startsWith("A stays"), "first frame 17 ms later fails");

/** Throughput is the fill after the first frame: a whole fill ×1.03 that is all before the first frame ties. */
const lateStart = (arm, round) => (arm === B ? { firstMs: 610 + jitter(round), firstHeldMs: 590, lastHeldMs: 3590 + jitter(round), fillMs: 3605 } : {});
check(verdict(run({ quiet: lateStart })) === "B′ replaces A", `a delay before the first frame is not a slower fill (${verdict(run({ quiet: lateStart }))})`);

/** The fill after the first frame ×1.03 fails. */
const slower = (arm, round) => (arm === B ? { lastHeldMs: 580 + 3000 * 1.03 + jitter(round) } : {});
check(verdict(run({ quiet: slower })).startsWith("A stays"), "fill after the first frame ×1.03 fails");

/** A one-frame series has no throughput bar. */
check(verdict(run({ mammo: (arm) => (arm === B ? { lastHeldMs: 9000 } : {}) })) === "B′ replaces A", "a one-frame fill is not judged");

/** A quiet start saturated by the guard claims no latency: B′ later there fails nothing, and the other cell decides. */
const sat = (arm, round) => ({ cores: { start: 0.97, fill: 0.3 }, ...(arm === B && { firstMs: 640 + jitter(round) }) });
check(verdict(run({ quiet: sat })) === "B′ replaces A", "a saturated start claims no latency");

/** A fill saturated by the guard claims no throughput: B′ slower there fails nothing. */
const fillSat = (arm, round) => ({ ...slower(arm, round), cores: { start: 0.5, fill: 0.97 } });
check(verdict(run({ quiet: fillSat })) === "B′ replaces A", "a saturated fill claims no throughput");

/** With every quiet start saturated, no latency is decided. */
const allSat = { quiet: () => ({ cores: { start: 0.97, fill: 0.3 } }), mammo: () => ({ cores: { start: 0.97, fill: null } }) };
check(verdict(run(allSat)).includes("no quiet latency decided"), `no latency decided (${verdict(run(allSat))})`);

/** A quiet A/A pair 17 ms apart on the first frame is VOID: B′ later there decides nothing. */
const apart = (arm, round) => (arm === "pageaa" ? { firstMs: 617 + jitter(round) } : arm === B ? { firstMs: 640 } : {});
check(verdict(run({ quiet: apart })) === "B′ replaces A", "a VOID quiet cell decides nothing");

/** Asks: sooner by the bar in 8 rounds of 12 fails. */
const eight = (arm, round) => (arm === B && round < 4 ? { screenMs: Array(10).fill(102) } : {});
check(verdict(run({ asks: eight })).startsWith("A stays"), "asks sooner in 8 of 12 fails");

/** Asks: a VOID asks cell, the only one, leaves the rule undecided. */
const noisy = (arm) => (arm === "pageaa" ? { screenMs: Array(10).fill(130) } : {});
check(verdict(run({ asks: noisy })).includes("no asks cell decided"), "no asks cell decided is undecided");

/** Cine: B′ late too where A misses fails; saturated, it decides nothing. */
const bothLate = () => ({ cine: { period: 100, latePct: 20, gapP99: 283, drawP99: 25 } });
check(verdict(run({ cine: bothLate })).startsWith("A stays"), "B′'s cine late where A's is fails");
const saturated = () => ({ cine: { period: 100, latePct: 20, gapP99: 283, drawP99: 60 } });
check(verdict(run({ cine: saturated })) === "B′ replaces A", "a saturated cine cell decides nothing");

/** Only the named arm is B′: rows of another worker variant are not read. */
const other = cell("asks").filter((r) => r.variant === B).map((r) => ({ ...r, variant: "worker", screenMs: Array(10).fill(500) }));
check(verdict([...run(), ...other]) === "B′ replaces A", "another arm's rows are not read");

console.log(`rule summary: ${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
