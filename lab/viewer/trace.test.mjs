// node lab/viewer/trace.test.mjs — the sawtooth trace and its waits. lab/viewer/trace.js
import { legPath, legWaits, sawtooth, waits } from "./trace.js";

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
};

/** Over 10 frames the trace climbs to 3 and back to 0, three times: 18 steps, frame 0 never a step of its own first. */
const steps = sawtooth(10);
check(steps.join() === "1,2,3,2,1,0,1,2,3,2,1,0,1,2,3,2,1,0", `the sawtooth over 10 frames (${steps})`);
check(sawtooth(24).length === 48 && Math.max(...sawtooth(100)) === 33, "24 frames take 48 steps; 100 frames climb to 33");

/**
 * Steps up to 1, 2, 3 and down to 2 at 0, 40, 80, 120 ms. Frame 1 held before its step waits 0; 2 held at 70 waits
 * 30; 3 held at 200 waits 120; 2 down waits 0. Up is the mean of 0, 30 and 120; one step of three was held at its step.
 */
const held = new Map([[1, -5], [2, 70], [3, 200]]);
const r = waits([{ i: 1, at: 0 }, { i: 2, at: 40 }, { i: 3, at: 80 }, { i: 2, at: 120 }], held);
check(r.waits.join() === "0,30,120,0", `each step's wait (${r.waits})`);
check(r.forwardMs === 50 && r.backwardMs === 0, `up ${r.forwardMs}, down ${r.backwardMs}`);
check(Math.abs(r.live - 2 / 3) < 1e-9, `live: two of three steps up not held (${r.live})`);
check(r.missingMs === (0 + 30 + 40 + 0) / 4, `missing, cut at the next step (${r.missingMs})`);

/** A frame never held leaves its own mean undefined; in the missing time it counts to the next step, or one step's time if last. */
const never = waits([{ i: 1, at: 0 }, { i: 0, at: 40 }], new Map([[0, 0]]));
check(never.forwardMs === null && never.backwardMs === 0 && never.missingMs === 20, `a frame never held (${JSON.stringify(never)})`);
const last = waits([{ i: 1, at: 0 }, { i: 0, at: 40 }], new Map([[1, 0]]));
check(last.forwardMs === 0 && last.backwardMs === null && last.missingMs === 20, `the last step's frame never held (${JSON.stringify(last)})`);

/** Legs of 20 from 15 over 50 frames: 15 approach steps, then nine legs of exactly 20, turning at 35 and 15, the last step of each a turn. */
const path = legPath({ lo: 15, leg: 20, count: 9 }, 50);
const lens = [...Array(10).keys()].map((k) => path.filter((x) => x.leg === k).length);
check(lens.join() === "15,20,20,20,20,20,20,20,20,20", `leg lengths (${lens})`);
check(path[34].i === 35 && path[34].turn && path[54].i === 15 && path[54].turn && path.filter((x) => x.turn).length === 9, "turns at 35 and 15");
check(path.every((x, k) => Math.abs(x.i - (k ? path[k - 1].i : 0)) === 1), "every step one frame from the last: no skip");
check(legPath({ oneWay: true }, 50).map((x) => x.i).join() === [...Array(49).keys()].map((k) => k + 1).join(), "one way: 1 … 49");
let refused = false;
try { legPath({ lo: 5, leg: 45, count: 2 }, 50); } catch { refused = true; }
check(refused, "legs past the series are refused");

/**
 * Two counted legs (2 and 3) of two steps each, leg 1 the first pass: leg 2 waits 0.03 + 0 s, leg 3 0 + 0.1 s; one of
 * the four counted steps was held when due; two frames arrived from the step before leg 2 to the last.
 */
const lw = legWaits([
  { leg: 1, dueMs: 0, heldMs: 500, paintedMs: 500, heldAtDue: false, received: 3 },
  { leg: 2, dueMs: 540, heldMs: 570, paintedMs: 570, heldAtDue: false, received: 4 },
  { leg: 2, dueMs: 610, heldMs: 600, paintedMs: 610, heldAtDue: true, received: 4 },
  { leg: 3, dueMs: 650, heldMs: 650, paintedMs: 650, heldAtDue: false, received: 5 },
  { leg: 3, dueMs: 690, heldMs: 790, paintedMs: 790, heldAtDue: false, received: 5 },
]);
check(lw.perLeg.map((x) => x.toFixed(2)).join() === "0.03,0.10" && Math.abs(lw.meanS - 0.065) < 1e-9, `per leg (${lw.perLeg})`);
check(lw.live === 0.75 && lw.received === 2, `live ${lw.live}, received ${lw.received}`);
/** The pace leaves the waits out: 220 ms from the first counted paint to the last, less 0.13 s waited, over three steps. */
check(Math.abs(lw.stepMs - 30) < 1e-9, `the step without its waits (${lw.stepMs} ms)`);

console.log(failed ? `${failed} failed` : "trace: the sawtooth, each step's wait, the legs: ok");
process.exit(failed ? 1 : 0);
