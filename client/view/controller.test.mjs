// node client/view/controller.test.mjs — the controller and the frame store, with a recording paint and a fake downloader client.
import assert from "node:assert/strict";
import { asPainted, Controller } from "./controller.js";
import { windowTable } from "../paint/voi.js";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** A 3×2 16-bit grey frame whose samples are their own index, 0 to 5, row by row. */
const frame = (i) => ({
  frameIndex: i,
  info: { pixels: new Uint16Array([0, 1, 2, 3, 4, 5]).buffer, width: 3, height: 2, bits: 16, components: 1, signed: false, min: 0, max: 5, exact: true, stamps: {} },
});

/** A controller on a series of `frames`, its paints and the client's calls recorded; `held` frames already here; `wants`, the worker view's store. */
function rig({ frames = 4, held = [], fillMode = true, budget, wants, paint, lossy, bitsStored, window = { center: [3], width: [6] } } = {}) {
  const painted = [];
  const calls = [];
  const events = [];
  const c = new Controller({
    meta: { frameCount: frames, bitsStored, ...(window && { window }), ...(lossy && { codec: "av1", lossy, exactSeries: "s" }) },
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

/** Under the lab's `waitAhead` the misses go in ascending order from the current frame, wrapping past the last. */
test("worker view, waitAhead: the want ascends from the current frame and wraps", async () => {
  const wants = [];
  const { c, calls } = rig({ frames: 8, held: [0, 2], wants });
  c.ascending = true;
  c.show(5);
  assert.deepEqual(wants, ["5,6,7,1,3,4"]);
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

/** The ledger hands a lab harness the fill's time once every frame is here and none before, and the session's reads at each frame. */
test("the ledger carries the fill's time and each frame's media reads", async () => {
  const { c } = rig({ frames: 2 });
  c.client.stats = () => ({ resumedAt: [] });
  c.issuedAt = performance.timeOrigin + performance.now() - 40;
  const take = (i) => c.take({ ...frame(i), info: { ...frame(i).info, stamps: { lastByte: 1, mediaReads: 7 + i } } });
  take(0);
  assert.equal((await c.ledger()).fillMs, null);
  take(1);
  const { fillMs, frames } = await c.ledger();
  assert.ok(fillMs >= 40 && fillMs < 1000, `fill ${fillMs} ms`);
  assert.deepEqual(frames.map((f) => f.mediaReads), [7, 8]);
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

/** A lab's `flip` changes one sample before the digest, so a check that compares digests must fail; the frame held is untouched. */
test("the ledger's flip changes the digest, not the frame", async () => {
  const { c } = rig({ frames: 1, held: [0] });
  c.client.stats = () => ({ resumedAt: [] });
  const [plain] = (await c.ledger()).frames;
  const [flipped] = (await c.ledger({ flip: true })).frames;
  const [again] = (await c.ledger()).frames;
  assert.notEqual(flipped.sha, plain.sha);
  assert.equal(again.sha, plain.sha);
});

/** Frame `i` of the exact series: other samples than the lossy one's, and `exact` as its decoder checked it. */
const exactFrame = (i, exact = true) => ({ frameIndex: i, info: { ...frame(i).info, pixels: new Uint16Array([9, 9, 9, 9, 9, 9]).buffer, exact, path: "htj2k", reason: exact === false ? "digest" : undefined } });

/** A lossy series' rig whose exact series answers each ask through `answer(i)`, the asks recorded. */
function lossyRig(answer = (i) => Promise.resolve(exactFrame(i)), opts = {}) {
  const r = rig({ held: [0, 1, 2, 3], lossy: { q: 30, g: 1, depth: 10 }, ...opts });
  r.exactAsks = [];
  r.c.exactSource = { requestExactFrame: (i) => (r.exactAsks.push(i), answer(i)) };
  r.labels = () => r.events.filter(([t]) => t === "shown").map(([, e]) => e.quality);
  return r;
}

/**
 * The exact request paints frame i of the exact series in place of the lossy one and changes nothing else: the store
 * keeps every lossy frame, the downloader is asked nothing, a step away and back paints the lossy frame again.
 */
test("the exact request paints the exact series' frame in place, and nothing else", async () => {
  const { c, painted, calls, exactAsks, labels } = lossyRig();
  const before = [...c.store.keys()].map((i) => c.store.get(i));
  await c.show(1);
  await c.showExact();
  await c.repaint();
  assert.deepEqual(exactAsks, [1]);
  assert.equal(new Uint16Array(painted.at(-1).f.info.pixels)[0], 9);
  assert.equal(labels().at(-1), "lossless");
  assert.deepEqual([...c.store.keys()].map((i) => c.store.get(i)), before);
  assert.equal(new Uint16Array(c.store.get(1).info.pixels)[0], 0);
  assert.equal(c.received, 4);
  await c.show(2);
  assert.equal(painted.at(-1).f, c.store.get(2));
  await c.show(1);
  assert.equal(painted.at(-1).f, c.store.get(1));
  assert.equal(labels().at(-1), "optimal");
  await c.showExact();
  await c.showLossy();
  assert.equal(painted.at(-1).f, c.store.get(1));
  assert.deepEqual(calls, []);
});

/**
 * The label says "lossless" only once the exact frame is painted and its digest matched: never while it is asked,
 * never for a frame whose check failed or had no digest, never for a lossy frame, never for a frame the reader left.
 */
test("the label never says lossless before the checksum passes", async () => {
  const pending = Promise.withResolvers();
  const r = lossyRig(() => pending.promise);
  await r.c.repaint();
  const shownBefore = r.labels().length;
  const asked = r.c.showExact();
  await r.c.repaint();
  assert.deepEqual(r.labels().slice(shownBefore), ["asking", "asking"]);
  pending.resolve(exactFrame(0, false));
  await asked;
  assert.equal(r.labels().at(-1), "failed");
  assert.equal(r.painted.at(-1).f, r.c.store.get(0));
  assert.ok(r.events.some(([t, e]) => t === "failed" && /lossless: not exact/.test(e.reason)));

  const unchecked = lossyRig((i) => Promise.resolve(exactFrame(i, "unchecked")));
  await unchecked.c.showExact();
  assert.ok(!unchecked.labels().includes("lossless"), unchecked.labels().join());

  const late = Promise.withResolvers();
  const left = lossyRig(() => late.promise);
  const leaving = left.c.showExact();
  await left.c.show(1);
  late.resolve(exactFrame(0));
  await leaving;
  await left.c.repaint();
  assert.ok(!left.labels().includes("lossless"), left.labels().join());
  assert.equal(left.painted.at(-1).f, left.c.store.get(1));
  await left.c.show(0);
  assert.equal(left.painted.at(-1).f, left.c.store.get(0));
  assert.equal(left.labels().at(-1), "optimal");

  const draws = [];
  const slow = lossyRig(undefined, { paint: (f) => new Promise((done) => draws.push({ f, done })) });
  const shown = slow.c.showExact();
  for (let k = 0; k < 20 && !draws.some(({ f }) => f.info.path === "htj2k"); k++) {
    draws.shift()?.done();
    await new Promise(setImmediate);
  }
  assert.ok(draws.some(({ f }) => f.info.path === "htj2k"), "the exact frame's paint was started");
  assert.ok(!slow.labels().includes("lossless"), "lossless before the exact frame's paint resolved");
  while (draws.length) {
    draws.shift().done();
    await new Promise(setImmediate);
  }
  await shown;
  assert.equal(slow.labels().at(-1), "lossless");
});

/** After a failed exact request, asking again on the same frame asks the exact series again, and can reach lossless. */
test("a failed exact request can be asked again on the same frame", async () => {
  let answers = [exactFrame(0, false), exactFrame(0)];
  const r = lossyRig(() => Promise.resolve(answers.shift()));
  await r.c.showExact();
  assert.equal(r.labels().at(-1), "failed");
  await r.c.showExact();
  assert.deepEqual(r.exactAsks, [0, 0]);
  assert.equal(r.labels().at(-1), "lossless");
});

/**
 * A depth cut's frames reach the painter with their shift, the exact frame painted in place without one; its window
 * from the decoded range and the sample under the cursor are at full depth.
 */
test("a depth cut's frames are painted with their shift, the exact frame without", async () => {
  const r = lossyRig(undefined, { lossy: { q: 8, g: 1, depth: 10, bitsStored: 12 }, bitsStored: 12, window: null });
  await r.c.repaint();
  assert.equal(r.painted.at(-1).f.info.cut, 2);
  assert.deepEqual(r.painted.at(-1).display.voi, { center: 10, width: 21, function: "LINEAR" });
  r.c.size = { width: 3, height: 2, dpr: 1 };
  assert.deepEqual((await r.c.valueAt(2.5, 1.5)).stored, [20]);
  await r.c.showExact();
  assert.equal(r.painted.at(-1).f.info.path, "htj2k");
  assert.equal(r.painted.at(-1).f.info.cut, undefined);
  assert.equal(r.labels().at(-1), "lossless");

  const plain = lossyRig();
  await plain.c.repaint();
  assert.equal(plain.painted.at(-1).f.info.cut, undefined);
});

/** What the painter is handed of a depth cut's frame keeps its shift: code 249 of D 12 is windowed at 996, not at 249. */
test("a depth cut's frame reaches the painter windowed at full depth", async () => {
  const r = lossyRig(undefined, { lossy: { q: 8, g: 1, depth: 10, bitsStored: 12 }, bitsStored: 12 });
  await r.c.repaint();
  const { f, display } = r.painted.at(-1);
  const painted = asPainted({ ...f.info, bits: 10 });
  const full = windowTable({ bits: 12, signed: false }, display);
  const got = windowTable(painted, display);
  for (let c = 0; c < 1024; c++) assert.equal(got[c], full[c << 2], `code ${c}`);
});

/** A series that is not lossy has no label: the quality rule says nothing of an HTJ2K series. */
test("a series that is not lossy carries no quality label", async () => {
  const { c, events } = rig({ held: [0] });
  await c.repaint();
  assert.equal(events.find(([t]) => t === "shown")[1].quality, null);
});

/** A jump mid-group then a scroll on through it: the group's frames arrived with the jump, so the scroll asks nothing. */
test("a scroll through a group after a jump into it asks nothing", async () => {
  for (const g of [1, 8, 16]) {
    const { c, calls } = rig({ frames: 40, fillMode: false });
    // The downloader's answer to an ask mid-group: the asked frame, the rest of its group as frames nobody waits on.
    c.client.requestExactFrame = (i) => {
      calls.push(`ask ${i}`);
      for (let k = i - (i % g); k < Math.min(i - (i % g) + g, 40); k++) if (k !== i) c.take(frame(k));
      return Promise.resolve(frame(i));
    };
    await c.show(21);
    for (let i = 22; i < 21 - (21 % g) + g; i++) await c.show(i);
    assert.deepEqual(calls, ["ask 21"], `G = ${g}`);
  }
});

let failed = 0;
/** The overlay's data for a painted frame names its decode route and, after a refusal, why WebCodecs refused it. */
test("a shown frame's route and WebCodecs refusal reach the overlay", async () => {
  const { c, events } = rig({ lossy: { q: 8, g: 1, depth: 12 } });
  c.take({ frameIndex: 0, info: { ...frame(0).info, path: "av1-dav1d", refusal: "undecodable: not a key frame", wireBytes: 2048 } });
  await c.repaint();
  const { about } = events.filter(([t]) => t === "shown").at(-1)[1];
  assert.equal(about.path, "av1-dav1d");
  assert.equal(about.refusal, "undecodable: not a key frame");
});

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
