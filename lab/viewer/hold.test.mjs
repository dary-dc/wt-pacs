// node lab/viewer/hold.test.mjs — the hold keys, their windows, and the hold on the product's store. lab/viewer/hold.js
import { FrameStore } from "../../client/view/store.js";
import { install, windowOf } from "./hold.js";

let failed = 0;
const check = (ok, what) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok" : "FAIL"}: ${what}`);
};
const at = (hold, s, dir, moving = true, rho = 0.216) => windowOf(hold, { s, dir, moving, rho, w: 15, n: 50 }).sort((a, b) => a - b);
const span = (xs) => `${xs[0]}…${xs.at(-1)}`;

/** Moving up from 20 with 15 frames: behind first keeps 20 … 34, centred 13 … 27, three quarters ahead 3 behind (11 of 14 ahead), the struck split 12. */
check(span(at("behind", 20, 1)) === "20…34", `behind first (${span(at("behind", 20, 1))})`);
check(span(at("centred", 20, 1)) === "13…27", `centred (${span(at("centred", 20, 1))})`);
check(span(at("ahead34", 20, 1)) === "17…31", `three quarters ahead (${span(at("ahead34", 20, 1))})`);
check(span(at("struck", 20, 1)) === "8…22", `the struck split at ρ 0.216 (${span(at("struck", 20, 1))})`);
/** Moving down, behind first keeps the frames below; the rule is behind first moving and centred dwelling. */
check(span(at("behind", 20, -1)) === "6…20", `behind first moving down (${span(at("behind", 20, -1))})`);
check(span(at("rule", 20, 1, true)) === "20…34" && span(at("rule", 20, 1, false)) === "13…27", "the rule: behind first moving, centred dwelling");
/** At the series' edge the window stays inside it, and the frame in view is wanted first. */
check(span(at("behind", 45, 1)) === "35…49" && windowOf("behind", { s: 45, dir: 1, moving: true, rho: 0.216, w: 15, n: 50 })[0] === 45, "behind first at 45: 35 … 49, 45 first");

/**
 * The hold on the product's FrameStore: 15 frames 20 … 34 held moving up at 20, then the reader turns. Frame 19 arrives
 * past the budget: behind first (now facing down) lets go 34, the far end. Moving up again at 21 with 20 … 34 held, frame 35 arrives: behind first lets go 20, the end
 * behind; the struck split lets go 35 itself, the end it ranks last; centred installs nothing, and the product's own
 * store lets go 35 too, the farthest from 21.
 */
function controllerWith(hold, held, current) {
  const store = new FrameStore({ arrived: () => {}, budget: 15 });
  for (const i of held) store.put(i, { info: {} });
  const c = { store, current, want: () => [] };
  store.near = current;
  return { c, state: install(c, hold, { rho: 0.216, w: 15, n: 50 }) };
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const keys = (store) => [...store.keys()].sort((a, b) => a - b);
{
  const { c, state } = controllerWith("behind", range(20, 34), 20);
  state.dir = -1;
  c.store.put(19, { info: {} });
  check(span(keys(c.store)) === "19…33" && c.store.near === 20, `behind first, turned at 20, takes 19 and lets go 34 (${span(keys(c.store))})`);
}
{
  const { c, state } = controllerWith("behind", range(20, 34), 21);
  state.dir = 1;
  c.store.put(35, { info: {} });
  check(span(keys(c.store)) === "21…35", `behind first moving up at 21 takes 35 and lets go 20 (${span(keys(c.store))})`);
}
{
  const { c, state } = controllerWith("struck", range(20, 34), 21);
  state.dir = 1;
  c.store.put(35, { info: {} });
  check(span(keys(c.store)) === "20…34", `the struck split at 21 lets go 35, the frame it ranks last (${span(keys(c.store))})`);
  check(c.want().length === 15 && c.want()[0] === 21, "the hold's want: 15 frames, the one in view first");
}
{
  const { c } = controllerWith("centred", range(20, 34), 21);
  c.store.put(35, { info: {} });
  check(span(keys(c.store)) === "20…34" && c.want().length === 0, `centred is the product's own store: 35 let go, the want untouched (${span(keys(c.store))})`);
}

console.log(failed ? `${failed} failed` : "hold: the keys, the windows, the hold on the store: ok");
process.exit(failed ? 1 : 0);
