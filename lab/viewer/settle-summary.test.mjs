// node lab/viewer/settle-summary.test.mjs — the re-measured cine cell's guards and rules. lab/viewer/settle-summary.mjs
import { ARMS, cells, verdicts } from "./settle-summary.mjs";

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
};

/** Firefox as hypothesised: each view late through the task when settled by the read; by the fence, the worker on time. */
const FIREFOX = {
  page: { latePct: 20, gapP99: 290, drawP99: 20 }, pageaa: { latePct: 21, gapP99: 295, drawP99: 20 }, worker: { latePct: 0, gapP99: 117, drawP99: 25 },
  "page-read": { latePct: 25, gapP99: 300, drawP99: 210 }, "worker-read": { latePct: 25, gapP99: 300, drawP99: 200 },
};
/** 12 kept rounds of every arm in one cine cell, `cine(arm, round)` each row's score. */
const cell = (engine, set, cine, rounds = 12, more = () => ({})) => ARMS.flatMap((arm) => Array.from({ length: rounds }, (_, round) => ({
  engine, set, throttle: 1, round, variant: arm, cineS: 10, busy: true, frames: 76, exact: 76, errors: [], failures: 0, void: false,
  tasks: { n: 20, minMs: 200 }, cine: { period: 100, ...cine(arm, round) }, ...more(arm, round),
})));
const as = (table) => (arm) => table[arm];

/** The hypothesis's rows say the wait was the read, and B′ keeps cine on time where A misses. */
const ff = verdicts(cell("firefox", "ct", as(FIREFOX)));
check(ff.firefox.read === "the wait was the read" && ff.firefox.cine === "B′ keeps cine on time where A misses", JSON.stringify(ff));

/** Settled by the fence the worker's draw still waits: not the read, and B′ misses. */
const still = { ...FIREFOX, worker: { latePct: 25, gapP99: 300, drawP99: 200 } };
const v = verdicts(cell("firefox", "ct", as(still)));
check(v.firefox.read === "not the read" && v.firefox.cine === "B′ misses where A misses", JSON.stringify(v));

/** A drawn by the read alone at 150 ms counts as waiting; 149 does not. */
const at = (ms) => verdicts(cell("firefox", "ct", as({ ...FIREFOX, "worker-read": { ...FIREFOX["worker-read"], drawP99: ms } }))).firefox.read;
check(at(150) === "the wait was the read" && at(149) === "not the read", `150 ms ${at(150)}, 149 ms ${at(149)}`);

/** The A/A pair apart by more than 2 points of late frames, or 16.7 ms of gap p99, makes the cell VOID: nothing decided. */
const apart = (d) => cells(cell("firefox", "ct", as({ ...FIREFOX, pageaa: { ...FIREFOX.page, ...d } })))[0].void;
check(apart({ latePct: 23 }) && apart({ gapP99: 307 }) && !apart({ latePct: 22, gapP99: 300 }), "the A/A bar");
check(verdicts(cell("firefox", "ct", as({ ...FIREFOX, pageaa: { ...FIREFOX.page, latePct: 30 } }))).firefox.decided === 0, "a VOID cell decides nothing");

/** The page's fence-settled draw p99 past half the period saturates the cell; under 12 rounds the cell is short. */
check(cells(cell("firefox", "ct", as({ ...FIREFOX, page: { ...FIREFOX.page, drawP99: 51 } })))[0].saturated, "saturated past half the period");
check(cells(cell("firefox", "ct", as(FIREFOX), 11))[0].short, "11 rounds are short");
check(cells(cell("firefox", "ct", as(FIREFOX), 14))[0].rounds === 12, "a cell counts its first 12 rounds");

/** A worker on time in late frames but with a gap p99 past two periods does not keep cine on time. */
const gappy = verdicts(cell("firefox", "ct", as({ ...FIREFOX, worker: { ...FIREFOX.worker, gapP99: 201 } })));
check(gappy.firefox.cine === "B′ misses where A misses", JSON.stringify(gappy));

/** A visit with a short task, an error, or a frame not exact: dropped or the cell not decided. */
const dropped = cells(cell("firefox", "ct", as(FIREFOX), 12, (arm, round) => (arm === "worker" && round === 3 ? { tasks: { n: 20, minMs: 150 } } : {})))[0];
check(dropped.rounds === 11 && dropped.short, `a short task drops its round (${dropped.rounds})`);
check(!cells(cell("firefox", "ct", as(FIREFOX), 12, (arm, round) => (round === 0 && arm === "page" ? { exact: 75 } : {})))[0].decided, "a frame not exact decides nothing");

/** Chromium as §7 found it: neither settle waits, so not the read; B′ on time. */
const CHROMIUM = { ...FIREFOX, "page-read": FIREFOX.page, "worker-read": FIREFOX.worker };
const c = verdicts(cell("chromium", "ct", as(CHROMIUM)));
check(c.chromium.read === "not the read" && c.chromium.cine === "B′ keeps cine on time where A misses", JSON.stringify(c));

console.log(failed ? `${failed} failed` : "settle summary: the rules, the A/A bar, the guards: ok");
process.exit(failed ? 1 : 0);
