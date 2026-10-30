// node client/view/controller.test.mjs — the controller and the frame store, with a recording paint and a fake downloader client.
import assert from "node:assert/strict";
import { Controller } from "./controller.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** A 3×2 16-bit grey frame whose samples are their own index, 0 to 5, row by row. */
const frame = (i) => ({
  frameIndex: i,
  info: { pixels: new Uint16Array([0, 1, 2, 3, 4, 5]).buffer, width: 3, height: 2, bits: 16, components: 1, signed: false, min: 0, max: 5, exact: true, stamps: {} },
});

/** A controller on a 4-frame series, its paints and the client's calls recorded; `held` frames already here. */
function rig({ held = [], fillMode = true, budget } = {}) {
  const painted = [];
  const calls = [];
  const events = [];
  const c = new Controller({
    meta: { frameCount: 4, window: { center: [3], width: [6] } },
    fillMode,
    size: { width: 2, height: 3, dpr: 1 },
    emit: (type, e) => events.push([type, e]),
    paint: (f, display) => (painted.push({ f, display }), { uploaded: painted.at(-2)?.f !== f }),
    budget,
  });
  c.client = {
    requestExactFrame: (i) => (calls.push(`ask ${i}`), Promise.resolve(frame(i))),
    cancel: () => (calls.push("cancel"), Promise.resolve()),
    fill: (all) => calls.push(`fill ${all}`),
  };
  for (const i of held) c.take(frame(i));
  return { c, painted, calls, events };
}

/** A step to a held frame paints it and sends the downloader nothing. */
test("a held frame is painted without a word to the downloader", async () => {
  const { c, painted, calls } = rig({ held: [0, 2] });
  await c.repaint();
  const before = painted.length;
  await c.show(2);
  assert.equal(painted.length, before + 1);
  assert.equal(painted.at(-1).f, c.store.get(2));
  assert.deepEqual(calls, []);
});

/** A step to a frame not here asks the downloader for it, once, and paints it when it comes. */
test("a miss is asked of the downloader, and painted on arrival", async () => {
  const { c, painted, calls } = rig({ held: [0] });
  await c.show(3);
  await c.repaint();
  assert.deepEqual(calls, ["ask 3"]);
  assert.equal(painted.at(-1).f, c.store.get(3));
});

/** A window change paints the current frame again from the same frame object: nothing moves, nothing is asked. */
test("a window change repaints the same frame with the new window", async () => {
  const { c, painted, calls } = rig({ held: [0] });
  await c.repaint();
  await c.setDisplay({ window: { center: 10, width: 4, function: "LINEAR" } });
  assert.equal(painted.at(-1).f, painted.at(-2).f);
  assert.deepEqual(painted.at(-1).display.voi, { center: 10, width: 4, function: "LINEAR" });
  assert.deepEqual(calls, []);
  await c.setDisplay({ window: null });
  assert.deepEqual(painted.at(-1).display.voi, { center: 3, width: 6, function: "LINEAR" });
});

/** A frame arriving twice is counted and painted once. */
test("a frame already here is not taken again", async () => {
  const { c, painted, events } = rig({ held: [0] });
  await c.repaint();
  const before = painted.length;
  c.take(frame(0));
  await new Promise(setImmediate);
  assert.equal(c.received, 1);
  assert.equal(events.filter(([t]) => t === "progress").length, 1);
  assert.equal(painted.length, before);
});

/** Turned a quarter clockwise on a 2×3 canvas, the top-left pixel is the image's bottom-left sample; off the image is null. */
test("valueAt maps a canvas point back through the pose", async () => {
  const { c } = rig({ held: [0] });
  c.setDisplay({ pose: { fit: false, zoom: 1, panX: 0, panY: 0, rotate: 90, flipH: false, flipV: false } });
  assert.deepEqual(await c.valueAt(0, 0), { i: 0, x: 0, y: 1, stored: [3], modality: [3] });
  assert.deepEqual((await c.valueAt(1, 2)).stored, [2]);
  c.setDisplay({ pose: { fit: false, zoom: 1, panX: 0, panY: 0, rotate: 90, flipH: true, flipV: false } });
  assert.deepEqual((await c.valueAt(0, 0)).stored, [0]);
  c.size = { width: 4, height: 3, dpr: 1 };
  assert.equal(await c.valueAt(3, 0), null);
});

/** Past its budget the store lets go of the frame farthest from the current one, and a step back to it asks again. */
test("the memory window lets the farthest frame go", async () => {
  const { c, calls } = rig({ budget: 2 });
  for (const i of [0, 1, 3]) c.take(frame(i));
  assert.deepEqual([...c.store.keys()].sort(), [0, 1]);
  await c.show(3);
  assert.deepEqual(calls, ["ask 3"]);
  assert.deepEqual([...c.store.keys()].sort(), [1, 3]);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`controller: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
