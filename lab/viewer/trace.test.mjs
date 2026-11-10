// node lab/viewer/trace.test.mjs — the sawtooth trace and its waits. lab/viewer/trace.js
import { sawtooth, waits } from "./trace.js";

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

console.log(failed ? `${failed} failed` : "trace: the sawtooth, each step's wait: ok");
process.exit(failed ? 1 : 0);
