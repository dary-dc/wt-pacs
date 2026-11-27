// node client/viewer/slider.test.mjs — the slice slider steps and jumps by touch, and keys never step twice.
import assert from "node:assert/strict";
import { RANGE_KEYS, sliceSlider } from "./slider.js";

const shown = [];
let paused = 0;
const el = {};
const follow = sliceSlider(el, 56, { show: (i) => shown.push(i), pause: () => (paused += 1) });

/** The slider spans the series, first slice to last, one slice a step. */
assert.equal(el.max, "55");

/** Moving it shows its slice, the last one included (the far jump), and pauses cine first. */
el.value = "55";
el.oninput();
el.value = "3";
el.oninput();
assert.deepEqual(shown, [55, 3]);
assert.equal(paused, 2);

/** A slice shown any other way (a key, the wheel, cine) moves the slider to it. */
follow(41);
assert.equal(el.value, "41");

/** A focused slider answers the stepping keys itself, so the page skips exactly those; `l`, space and the rest stay the page's. */
for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) assert.ok(RANGE_KEYS.has(k), k);
for (const k of ["l", " ", "+", "i", "Escape"]) assert.ok(!RANGE_KEYS.has(k), k);

console.log("slider: ok");
