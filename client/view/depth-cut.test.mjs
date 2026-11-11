// node client/view/depth-cut.test.mjs — a depth cut's shift is applied only to frames decoded at the cut's 10 bits.
import assert from "node:assert/strict";
import { Controller } from "./controller.js";

/** A 2×1 grey frame of `bits` bits, as a decoder hands it to the controller. */
const frame = (i, bits) => ({
  frameIndex: i,
  info: { pixels: new Uint16Array([0, 4095]).buffer, width: 2, height: 1, bits, components: 1, signed: false, min: 0, max: 4095, exact: "unchecked", path: "av1-dav1d", stamps: {} },
});

/**
 * Finding: `Controller.take` gives every frame of a depth-cut series the shift D − 10, whatever depth the frame
 * decoded at. A cut series' payload decoded at 12 (or 8) bits is painted ×4 — the wrong depth after the cut — and
 * labelled *Optimal quality*, with no failure on the status line. The frame should be refused by name.
 */
const painted = [];
const events = [];
const c = new Controller({
  meta: { frameCount: 2, bitsStored: 12, codec: "av1", lossy: { q: 8, g: 1, depth: 10, bitsStored: 12 }, exactSeries: "s" },
  fillMode: true,
  size: { width: 2, height: 1, dpr: 1 },
  emit: (type, e) => events.push([type, e]),
  paint: (f) => painted.push(f),
});
c.take(frame(0, 12));
c.take(frame(1, 10));
await c.repaint();
await c.show(1);
await c.show(0);
const wrong = painted.filter((f) => f.info.cut && f.info.bits !== 10);
assert.deepEqual(wrong.map((f) => f.info.bits), [], "a frame not decoded at 10 bits was painted as the cut");
assert.ok(events.some(([t, e]) => t === "failed" && e.i === 0), "the 12-bit frame of a cut series is refused by name");
assert.ok(painted.some((f) => f.info.bits === 10 && f.info.cut === 2), "the 10-bit frame is painted as the cut");
console.log("depth-cut: ok");
