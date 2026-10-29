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

/** A controller on a series of `frames`, its paints and the client's calls recorded; `held` frames already here; `wants`, the worker view's store. */
function rig({ frames = 4, held = [], fillMode = true, budget, wants, paint } = {}) {
  const painted = [];
  const calls = [];
  const events = [];
  const c = new Controller({
    meta: { frameCount: frames, window: { center: [3], width: [6] } },
    fillMode,
    size: { width: 2, height: 3, dpr: 1 },
    emit: (type, e) => events.push([type, e]),
    paint: paint ?? ((f, display) => (painted.push({ f, display }), { uploaded: painted.at(-2)?.f !== f })),
    budget,
  });
  c.client = {
    requestExactFrame: (i) => (calls.push(`ask ${i}`), Promise.resolve(frame(i))),
    cancel: () => (calls.push("cancel"), Promise.resolve()),
    fill: (all) => calls.push(`fill ${all}`),
  };
  for (const i of held) c.take(frame(i));
  if (wants) c.store.downloader = { want: (misses) => wants.push(misses.join()) };
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

/** Under the worker view a step to a held frame paints it and sends the downloader nothing, on demand and filling. */
test("worker view: a held frame is painted with no downloader message", async () => {
  for (const fillMode of [false, true]) {
    const wants = [];
    const { c, painted, calls } = rig({ held: [0, 1, 2, 3], fillMode, wants });
    await c.repaint();
    const before = painted.length;
    await c.show(2);
    assert.equal(painted.length, before + 1);
    assert.equal(painted.at(-1).f, c.store.get(2));
    assert.deepEqual([wants, calls], [[], []]);
  }
});

/** The store sends the misses alone, in the controller's order, nearest the current frame first; the same misses are not sent twice. */
test("worker view: the misses go to the downloader in the want's order, once", async () => {
  const wants = [];
  const { c, calls } = rig({ frames: 8, held: [0, 2], wants });
  c.show(5);
  c.show(1);
  c.show(1);
  assert.deepEqual(wants, ["5,6,4,7,3,1", "1,3,4,5,6,7"]);
  assert.deepEqual(calls, []);
});

/** A frame of a replaced want that arrives is kept, and only the current frame is painted; on demand the want is that frame alone. */
test("worker view: a frame of a replaced want is kept", async () => {
  const wants = [];
  const { c, painted } = rig({ held: [0], fillMode: false, wants });
  await c.repaint();
  const before = painted.length;
  const first = c.show(1);
  const second = c.show(2);
  c.take(frame(1));
  await first;
  assert.equal(painted.length, before);
  c.take(frame(2));
  await second;
  await c.repaint();
  assert.deepEqual(wants, ["1", "2"]);
  assert.deepEqual([...c.store.keys()].sort(), [0, 1, 2]);
  assert.equal(painted.at(-1).f, c.store.get(2));
});

/** Each failure reaches the page as `failed` with its scope by name: a frame, the series (index -1), the paint as the worker's. */
test("each failure is said with its scope", async () => {
  const wants = [];
  const { c, events } = rig({ held: [0], fillMode: false, wants, paint: () => Promise.reject(new Error("context lost")) });
  c.show(3);
  c.refused(3, "refused by the server");
  c.refused(-1, "no decoder");
  await c.repaint();
  const failures = events.filter(([t]) => t === "failed").map(([, e]) => e);
  assert.deepEqual(failures, [
    { scope: "frame", i: 3, reason: "refused by the server" },
    { scope: "series", reason: "no decoder" },
    { scope: "worker", reason: "paint: context lost" },
  ]);
  // A refused frame is no longer owed: the same want sends it again.
  c.show(3);
  assert.deepEqual(wants, ["3", "3"]);
});

/** A cache holding `present`, whose reads answer `read(i)` (null: the check failed) and whose writes are logged in `log`. */
function cacheOf(present, log, read = (i) => frame(i).info) {
  return {
    present: new Set(present),
    read: async (i) => (log.push(`read ${i}`), read(i) && { ...read(i), path: "cache" }),
    write: async (i) => (log.push(`write ${i}`), true),
  };
}
const settled = () => new Promise(setImmediate);

/** A frame on disk is read and painted when stepped to, and the downloader hears nothing: it is no miss. */
test("cache: a frame on disk is painted with no downloader message", async () => {
  const wants = [];
  const log = [];
  const { c, painted } = rig({ held: [0], fillMode: false, wants });
  c.store.cache = cacheOf([2], log);
  await c.show(2);
  await c.repaint();
  assert.deepEqual(wants, []);
  assert.deepEqual(log, ["read 2"]);
  assert.equal(painted.at(-1).f, c.store.get(2));
  assert.equal(c.store.get(2).info.path, "cache");
});

/** A read-back that fails its check is asked of the downloader at its own place in the want, and painted when it comes. */
test("cache: a corrupted entry is asked again at its want position", async () => {
  const wants = [];
  const { c, painted } = rig({ frames: 5, held: [0], wants });
  c.store.cache = cacheOf([1, 3], [], (i) => i !== 1 && frame(i).info);
  c.show(2);
  await settled();
  assert.deepEqual(wants, ["2,4", "2,1,4"]);
  assert.equal(c.store.reasked, 1);
  c.take(frame(1));
  c.show(1);
  await c.repaint();
  assert.equal(painted.at(-1).f.info.path, undefined);
  assert.equal(painted.at(-1).f, c.store.get(1));
});

/** The frame on screen is painted before its write is asked, and a frame read from the cache is not written again. */
test("cache: the write lands after the paint", async () => {
  const log = [];
  const draw = Promise.withResolvers();
  const { c } = rig({ held: [], paint: async (f) => (await draw.promise, log.push(`painted ${f.info.path ?? "wire"}`)), wants: [] });
  c.store.cache = cacheOf([1], log);
  c.store.want(c.want());
  c.take(frame(0));
  await settled();
  draw.resolve();
  await c.store.painted();
  await settled();
  assert.deepEqual(log, ["read 1", "painted wire", "write 0"]);
});

/** A reopen whose frames are all on disk sends the downloader no miss, at the start or after it, and reads them in the want's order. */
test("cache: a reopen asks nothing for stored frames", async () => {
  const wants = [];
  const log = [];
  const { c } = rig({ frames: 4, held: [], wants: null });
  c.store.cache = cacheOf([0, 1, 2, 3], log);
  c.current = 2;
  const sent = c.store.want(c.want());
  c.store.link({ want: (m) => wants.push(m.join()) }, sent);
  await settled();
  assert.deepEqual([sent, wants], [[], []]);
  assert.deepEqual(log, ["read 2", "read 3", "read 1", "read 0"]);
  assert.equal(c.received, 4);
});

/** Past the memory budget, a frame read from disk and let go is not read again under the same want. */
test("cache: a frame on disk is read once a want", async () => {
  const log = [];
  const { c } = rig({ frames: 4, budget: 2, held: [], wants: [] });
  c.store.cache = cacheOf([0, 1, 2, 3], log);
  c.store.want(c.want());
  await settled();
  assert.deepEqual(log, ["read 0", "read 1", "read 2", "read 3"]);
  assert.deepEqual([...c.store.keys()].sort(), [0, 1]);
});

/** A miss found while the downloader connects reaches it once linked, beside the want that rode its start. */
test("cache: a miss found before the downloader is linked is sent on link", async () => {
  const wants = [];
  const { c } = rig({ frames: 3, held: [], wants: null });
  c.store.cache = cacheOf([0, 1], [], (i) => i !== 0 && frame(i).info);
  const sent = c.store.want(c.want());
  await settled();
  c.store.link({ want: (m) => wants.push(m.join()) }, sent);
  assert.deepEqual([sent, wants], [[2], ["0,2"]]);
});

/** The store acks a frame it holds at once, and one past its budget only once the frame is written. */
test("cache: a frame is acked once held within the budget or written", async () => {
  const acks = [];
  const write = Promise.withResolvers();
  const { c } = rig({ frames: 4, budget: 1, held: [] });
  c.store.cache = { present: new Set(), read: async () => null, write: () => write.promise };
  c.take({ ...frame(0), ack: () => acks.push(0) });
  c.take({ ...frame(3), ack: () => acks.push(3) });
  await settled();
  assert.deepEqual(acks, [0]);
  write.resolve(true);
  await settled();
  assert.deepEqual(acks, [0, 3]);
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
