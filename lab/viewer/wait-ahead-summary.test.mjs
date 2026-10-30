// node lab/viewer/wait-ahead-summary.test.mjs — Experiment 2's guards and rule over rows. lab/viewer/wait-ahead-summary.mjs
import { ARMS, decide } from "./wait-ahead-summary.mjs";

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
};

/** 12 rounds of every arm in one cell; `up(arm, round)` is the forward wait, or on demand the missing time, where a frame left may never come. */
function cell({ engine = "chromium", set = "ct", frames = 100, fill = true, up, down = () => 50, fillMs = () => 5000, exact = () => true, voids = () => false, failures = () => 0, live = 0.5 }) {
  return Object.keys(ARMS).flatMap((arm) => Array.from({ length: 12 }, (_, round) => {
    const figure = up(arm, round);
    const held = fill ? frames : 11;
    return { engine, set, link: "r5000rtt92", throttle: 1, round, variant: arm, owed: fill ? frames : 0, frames: held, exact: exact(arm, round) ? held : held - 1,
      failures: failures(arm, round), void: voids(arm, round), fillMs: fill ? fillMs(arm, round) : null,
      trace: { forwardMs: fill ? figure : null, backwardMs: down(arm, round), live, missingMs: fill ? 20 : figure } };
  }));
}
const jitter = (round) => (round % 3) - 1;
/** k = 2 beats `off` by 20 ms in every round; k = 4 and 8 are later than k = 1. */
const better = (arm, round) => 300 + jitter(round) - ({ k2: 20, k4: -30, k8: -30 }[arm] ?? 0);
const onDemand = (engine) => cell({ engine, fill: false, up: (arm, round) => 30 + jitter(round) });
const both = (more = {}) => ["chromium", "firefox"].flatMap((engine) => [...cell({ engine, up: better, ...more }), ...onDemand(engine)]);

/** A k that beats `off` by the bar in every round, no later anywhere, the fill held: adopted, as the largest k no later than k = 1. */
const adopted = decide(both());
check(adopted.star === "k2" && adopted.verdict === "adopt k2", `k* and the verdict (${adopted.star}: ${adopted.verdict})`);

/** One frame not exact in any arm rejects it, whatever the timings. */
check(decide(both({ exact: (arm, round) => !(arm === "offaa" && round === 3) })).verdict.startsWith("rejected"), "one inexact frame rejects");

/** On demand, every frame held is owed exact, though the visit owed none up front; one not exact there rejects too. */
check(decide([...both(), ...cell({ fill: false, up: () => 30, exact: (arm, round) => !(arm === "k8" && round === 0) })]).verdict.startsWith("rejected"), "an inexact frame on demand rejects");

/** A visit that failed is re-run, not counted: three failed visits of an arm leave it saturated, not rejected. */
const failing = decide(both({ failures: (arm, round) => (arm === "k2" && round < 3 ? 1 : 0) }));
check(failing.verdict.startsWith("undecided") && failing.cells.some((c) => c.saturated), `failed visits are not kept (${failing.verdict})`);

/** Better forward and later backward by the bar is the owner's trade-off; a fill ×1.03 keeps `off`. */
check(decide(both({ down: (arm) => (arm === "k2" ? 80 : 50) })).verdict.startsWith("trade-off"), "later backward is a trade-off");
check(decide(both({ fillMs: (arm) => (arm === "k2" ? 5150 : 5000) })).verdict === "off stays", "a fill ×1.03 keeps off");

/** An A/A pair 10 ms apart, or a cell left under 10 visits an arm, decides nothing. */
const aa = decide(both({ up: (arm, round) => better(arm, round) + (arm === "offaa" ? 10 : 0) }));
check(aa.verdict.startsWith("undecided") && aa.star === null && aa.cells.every((c) => !c.fill || c.noisy), `A/A beyond 8 ms: no cell decided, no k* (${aa.verdict})`);
const short = decide(both({ voids: (arm, round) => arm === "k4" && round < 3 }));
check(short.verdict.startsWith("undecided") && short.cells.some((c) => c.saturated), `9 visits of an arm: saturated (${short.verdict})`);

/** An A/A pair whose fills differ by ×1.03 is too noisy to decide. */
check(decide(both({ fillMs: (arm) => (arm === "offaa" ? 5150 : 5000) })).verdict.startsWith("undecided"), "an A/A fill ×1.03 decides nothing");

/** k* must be no later than k = 1 in every decided cell: k = 4, no later on Chromium alone, is not it. */
const k4 = ["chromium", "firefox"].flatMap((engine) => [...cell({ engine, up: (arm, round) => better(arm, round) - (arm === "k4" && engine === "chromium" ? 60 : 0) }), ...onDemand(engine)]);
check(decide(k4).star === "k2", `k = 4 later on Firefox is not k* (${decide(k4).star})`);

/** A tie with k = 1 is no later: with k = 4 and 8 the same as k = 1 in every round, k* is 8. */
const ties = ["chromium", "firefox"].flatMap((engine) => [...cell({ engine, up: (arm, round) => 300 + jitter(round) - (arm === "off" || arm === "offaa" ? 0 : 20) }), ...onDemand(engine)]);
check(decide(ties).star === "k8", `ties with k = 1 count (${decide(ties).star})`);

/** Beating `off` by the bar in 8 rounds of 12 is not enough. */
const eight = both({ up: (arm, round) => better(arm, round) + (arm === "k2" && round >= 8 ? 20 : 0) });
check(decide(eight).verdict === "off stays", `8 of 12 keeps off (${decide(eight).verdict})`);

/** A cell where `off`'s reader never outran the fill on 9 steps in 10 is dead: no tie there is a null. */
check(decide(both({ live: 0.09 })).verdict.startsWith("undecided"), "a dead cell decides nothing");

/** A win on one engine alone keeps `off`. */
const oneEngine = [...cell({ engine: "chromium", up: better }), ...cell({ engine: "firefox", up: (arm, round) => 300 + jitter(round) }), ...onDemand("chromium"), ...onDemand("firefox")];
check(decide(oneEngine).verdict === "off stays", "a win on Chromium alone keeps off");

/** An on-demand cell where k* moves the wait by more than the A/A spread keeps `off`. */
const drift = ["chromium", "firefox"].flatMap((engine) => [...cell({ engine, up: better }), ...cell({ engine, fill: false, up: (arm, round) => 30 + jitter(round) + (arm === "k2" ? 12 : 0) })]);
check(decide(drift).verdict === "off stays", "on demand moved 12 ms keeps off");

/** A 24-frame trace climbs to 8, so k = 8 never asks there: that cell gives k = 8 no vote, and a 100-frame cell alone decides it. */
const k8 = (arm, round) => 300 + jitter(round) - ({ k2: 20, k4: 20, k8: 25 }[arm] ?? 0);
const short24 = (arm, round) => 300 + jitter(round) - ({ k2: 20, k4: 20, k8: -40 }[arm] ?? 0);
const voting = decide(["chromium", "firefox"].flatMap((engine) => [...cell({ engine, up: k8 }), ...cell({ engine, set: "dbt", frames: 24, up: short24 }), ...onDemand(engine)]));
check(voting.star === "k8", `k = 8 decided by the 100-frame cells alone (${voting.star})`);

console.log(failed ? `${failed} failed` : "wait-ahead summary: k*, adoption, the guards: ok");
process.exit(failed ? 1 : 0);
