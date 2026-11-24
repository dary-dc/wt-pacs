/** The hold key and the never-skipping display of `asking` §6's cells: docs/reviews/page-runs.md §4 (claude/page-runs) */
import { now } from "../../client/view/clock.js";
import { legPath, STEP_MS } from "./trace.js";

/** Which frame the store lets go first, as `docs/client/evidence/ask-model.md` §5 simulates it; `centred` is the product's own. */
export const HOLDS = ["behind", "ahead34", "struck", "rule", "centred"];
/** Past either end of any series, and small enough that the store's ranks stay exact. */
const FAR = 1e6;

/** The rank of a frame `delta` from the display, positive ahead in the reader's direction: the highest goes first. */
export function key(hold, delta, moving, rho) {
  const behindFirst = delta >= 0 ? delta : 1e6 - delta;
  if (hold === "behind") return behindFirst;
  if (hold === "ahead34") return delta >= 0 ? delta / 3 : -delta;
  if (hold === "struck") return delta >= 0 ? delta / rho : -delta;
  if (hold === "rule") return moving ? behindFirst : Math.abs(delta);
  if (hold === "centred") return Math.abs(delta);
  throw new Error(`refused: hold ${JSON.stringify(hold)} — ${HOLDS.join(", ")}`);
}

/** The `w` frames of `n` the hold keeps around `s`, the one it would let go last first; at equal rank the lower index. */
export function windowOf(hold, { s, dir, moving, rho, w, n }) {
  const rank = (i) => key(hold, (i - s) * dir, moving, rho);
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b).slice(0, w);
}

/**
 * The lab hold on a page view's controller: its want becomes the hold's window and, past the budget, the store lets go
 * the frame the hold ranks last. The store's own rule lets go the farthest from `near`; a victim at either end of what
 * is held is made the farthest by moving `near` past the other end for that one put. Returns the state the driver sets.
 */
export function install(controller, hold, { rho, w, n }) {
  const state = { dir: 1, moving: true, interior: 0 };
  if (hold === "centred") return state;
  const store = controller.store;
  controller.want = () => windowOf(hold, { s: controller.current, dir: state.dir, moving: state.moving, rho, w, n });
  const put = store.put.bind(store);
  store.put = (i, frame, ack) => {
    const held = new Set([...store.keys(), i]);
    if (held.size > w && !store.has(i)) {
      const s = controller.current;
      const rank = (k) => key(hold, (k - s) * state.dir, state.moving, rho);
      const victim = [...held].filter((k) => k !== s).reduce((a, b) => (rank(b) > rank(a) || (rank(b) === rank(a) && b < a) ? b : a));
      const ends = [Math.min(...held), Math.max(...held)];
      if (victim === ends[0]) store.near = FAR;
      else if (victim === ends[1]) store.near = -FAR;
      else state.interior += 1;
    }
    try {
      put(i, frame, ack);
    } finally {
      store.near = controller.current;
    }
  };
  return state;
}

/**
 * The reader of a leg trace on a display that never skips: each step's frame is shown once held, the next step due one
 * step after it, a dwell at each turn. `aim` tells the hold the reader's direction and whether it moves; the input names
 * the next frame before the display reaches it, so the hold is told at the step's due time.
 */
export async function drive({ spec, n, controller, show, errors, hold }) {
  const path = legPath(spec, n);
  const state = hold.state;
  const rewant = () => controller.store.want(controller.want());
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
  const steps = [];
  let s = controller.current;
  let due = performance.now() + STEP_MS;
  for (const { i, turn, leg } of path) {
    if (Math.abs(i - s) !== 1) throw new Error(`refused: a step from ${s} to ${i} skips`);
    await sleep(due - performance.now());
    state.dir = Math.sign(i - s);
    state.moving = true;
    const heldAtDue = controller.store.has(i);
    rewant();
    while (!controller.store.has(i) && !errors.length) {
      await Promise.race([controller.store.arrival(i), sleep(STEP_MS)]);
      if (!controller.store.has(i)) rewant();
    }
    if (errors.length) break;
    const shownAt = performance.now();
    await show(i);
    steps.push({ i, leg, dueMs: due, heldMs: shownAt, heldAtDue, received: controller.received });
    s = i;
    due = Math.max(due, shownAt) + STEP_MS;
    if (turn && spec.dwellMs) {
      // The client sees a dwell only once no step has come for two steps' time.
      await sleep(2 * STEP_MS);
      state.moving = false;
      rewant();
      await sleep(spec.dwellMs - 2 * STEP_MS);
      due = performance.now();
    }
  }
  for (let k = 1; k <= spec.count; k++) {
    const got = steps.filter((x) => x.leg === k).length;
    if (!spec.oneWay && got !== spec.leg) throw new Error(`leg ${k} took ${got} steps, not ${spec.leg}`);
  }
  return { steps, interior: state.interior, at: now() };
}
