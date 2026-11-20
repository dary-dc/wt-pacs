// node lab/viewer/start-summary.test.mjs — the start timing's guards and corrected bars over made-up rows. lab/viewer/start-summary.mjs
import { busyShare, cells, decide } from "./start-summary.mjs";

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
};
const ARMS = ["page", "pageaa", "worker"];
const jitter = (round) => (round % 3) - 1;

/** 12 rounds of every arm in one quiet cell; `f(arm, round)` gives the row's own figures. */
function cell(engine, f = () => ({}), set = "ct", frames = 76) {
  return ARMS.flatMap((arm) => Array.from({ length: 12 }, (_, round) => ({
    engine, set, throttle: 1, round, variant: arm, owed: frames, frames, exact: frames, errors: [], failures: 0, void: false,
    firstMs: 600 + jitter(round), firstHeldMs: 580 + jitter(round), lastHeldMs: 3580 + jitter(round), cores: { start: 0.5, fill: 0.8 },
    boot: { metadata: 100, connect: 300, dial: 320, sessionOpen: 420 },
    ...f(arm, round),
  })));
}
const both = (f, set, frames) => [...cell("chromium", f, set, frames), ...cell("firefox", f, set, frames)];
const verdict = (rows) => decide(rows, ARMS).verdicts.worker;

/** The busy share is the busy ticks over all ticks between the samples bracketing the window. */
const samples = [[0, 0, 0], [20, 3, 6], [40, 9, 12], [60, 9, 18]];
check(busyShare(samples, 10, 40) === 0.75, `busy over the bracketing samples (${busyShare(samples, 10, 40)})`);
check(busyShare(samples, 40, 60) === 0, `an idle window is 0 (${busyShare(samples, 40, 60)})`);
check(busyShare(samples, 10, 70) === null, `a window no sample closes is null (${busyShare(samples, 10, 70)})`);

/** Arms apart by no more than their jitter tie A. */
check(verdict(both()) === "ties A", `the same arms tie (${verdict(both())})`);

/** The worker's first frame 40 ms later in every round is behind A on latency, though its fill after it ties. */
const later = (arm, round) => (arm === "worker" ? { firstMs: 640 + jitter(round), firstHeldMs: 620, lastHeldMs: 3620 } : {});
check(verdict(both(later)) === "behind A: chromium ct 1x first, firefox ct 1x first", `40 ms later is behind (${verdict(both(later))})`);

/** A first frame 20 ms sooner is not a loss. */
const sooner = (arm, round) => (arm === "worker" ? { firstMs: 580 + jitter(round), firstHeldMs: 560, lastHeldMs: 3560 } : {});
const s = cells(both(sooner), ARMS)[0].arms.worker;
check(s.latency === "sooner" && verdict(both(sooner)) === "ties A", `sooner reads sooner and ties or beats A (${s.latency}, ${verdict(both(sooner))})`);

/** The fill after the first frame ×1.05 is slower; the start before it does not enter the ratio. */
const slowFill = (arm) => (arm === "worker" ? { firstMs: 700, firstHeldMs: 680, lastHeldMs: 680 + 3000 * 1.05 } : {});
const sf = cells(both(slowFill), ARMS)[0].arms.worker;
check(sf.throughput === "slower" && Math.abs(sf.fill - 1.05) < 0.002, `the fill after the first frame is the ratio (×${sf.fill})`);
const shifted = (arm) => (arm === "worker" ? { firstMs: 610, firstHeldMs: 590, lastHeldMs: 3590 } : {});
check(cells(both(shifted), ARMS)[0].arms.worker.throughput === "tie", "a start 10 ms later moves no fill");

/** A one-frame series has no throughput bar: a later last frame there is no loss. */
const mammo = (arm) => (arm === "worker" ? { lastHeldMs: 9000 } : { lastHeldMs: 580 });
const one = cells(both(mammo, "mammo", 1), ARMS)[0];
check(one.oneFrame && one.arms.worker.throughput === null && verdict(both(mammo, "mammo", 1)) === "ties A", `one frame, no fill bar (${verdict(both(mammo, "mammo", 1))})`);

/** A/A apart by 20 ms is VOID, so a later worker there decides nothing. */
const apart = (arm, round) => ({ ...later(arm, round), ...(arm === "pageaa" && { firstMs: 620 + jitter(round) }) });
check(cells(both(apart), ARMS).every((c) => c.void) && verdict(both(apart)).startsWith("undecided"), `A/A apart voids the cell (${verdict(both(apart))})`);
/** An A/A fill apart by ×1.03 voids it too. */
const fillApart = (arm) => (arm === "pageaa" ? { lastHeldMs: 580 + 3000 * 1.03 } : {});
check(cells(both(fillApart), ARMS).every((c) => c.void), "an A/A fill apart voids the cell");

/** A start whose cores were saturated in A judges no latency. */
const busy = (arm, round) => ({ ...later(arm, round), cores: { start: 0.97, fill: 0.5 } });
check(verdict(both(busy)).startsWith("undecided"), `a saturated start claims nothing (${verdict(both(busy))})`);
/** A saturated fill judges no throughput, but the start still decides. */
const busyFill = (arm) => ({ ...slowFill(arm), cores: { start: 0.5, fill: 0.99 } });
check(verdict(both(busyFill)) === "behind A: chromium ct 1x first, firefox ct 1x first", `a saturated fill is not judged (${verdict(both(busyFill))})`);

/** A visit with an inexact frame is not kept, so a cell left with 11 rounds decides nothing. */
const inexact = (arm, round) => ({ ...later(arm, round), ...(arm === "worker" && round === 3 && { exact: 75 }) });
check(cells(both(inexact), ARMS)[0].short && verdict(both(inexact)).startsWith("undecided"), `an inexact visit is dropped (${verdict(both(inexact))})`);

/** Each stamp's median per arm, the first frame held and drawn among them. */
const steps = cells(both(), ARMS)[0].steps.page;
check(steps.dial === 320 && steps.firstHeld === 580 && steps.firstDrawn === 600, `steps (${JSON.stringify(steps)})`);

console.log(failed ? `${failed} failed` : "start summary: busy share, ties, later and sooner, the fill after the first frame, one frame, A/A, saturation, dropped visits, steps: ok");
process.exit(failed ? 1 : 0);
