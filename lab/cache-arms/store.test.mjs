// node lab/cache-arms/store.test.mjs — the ring and the rules above the seam, on an arm kept in memory.
import { ring as makeRing } from "./ring.js";
import { store as makeStore } from "./store.js";

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};

const FRAME = 64;
const N = 8;
const field = (i) => Uint8Array.from({ length: FRAME }, (_, k) => (i * 31 + k) & 0xff);
const hash = (b) => b.reduce((h, x) => Math.imul(h ^ x, 16777619) >>> 0, 2166136261).toString(16);
const digests = [...Array(N).keys()].map((i) => hash(field(i)));
const meta = (d = digests) => ({ digests: d, frameBytes: FRAME, shape: [8, 4] });

/** A store kept in a Map shared by every store built on it, as one origin's disk is shared by its tabs and processes. */
function memoryArm(disk, faults = {}) {
  let open = null;
  const quota = faults.quota ?? Infinity;
  const used = () => [...disk.values()].reduce((s, d) => s + d.reserved, 0);
  return {
    name: "memory",
    async open(series, m, { create }) {
      const known = disk.get(series);
      if (!known && !create) return { present: [], meta: null };
      if (!known && used() + m.digests.length * FRAME > quota) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      if (!known) disk.set(series, { meta: m, frames: new Map(), reserved: m.digests.length * FRAME });
      const d = disk.get(series);
      const before = d.meta;
      d.meta = { ...m, lastOpen: faults.clock?.() ?? 0 };
      open = series;
      return { present: [...d.frames.keys()], meta: before };
    },
    async write(i, bytes, ctx) {
      if (faults.writeThrows?.()) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      const copy = bytes.slice();
      if (faults.releaseEarly) ctx.release();
      disk.get(open).frames.set(i, copy);
    },
    async read(i, into) {
      const f = disk.get(open)?.frames.get(i);
      if (!f) return false;
      into.set(f);
      return true;
    },
    async drop(i) { disk.get(open)?.frames.delete(i); },
    async evict(series) { disk.delete(series); },
    async list() { return [...disk].map(([series, d]) => ({ series, lastOpen: d.meta.lastOpen ?? 0, bytes: d.frames.size * FRAME })); },
    async close() { open = null; },
    async damage(i) { disk.get(open).frames.get(i)[0] ^= 1; },
  };
}

/** One origin's Web Locks: held names, a request that may wait or give up at once. */
function memoryLocks() {
  const held = new Map();
  return {
    async hold(name, { ifAvailable = false } = {}) {
      if (held.has(name) && ifAvailable) return null;
      held.set(name, (held.get(name) ?? 0) + 1);
      return () => (held.get(name) > 1 ? held.set(name, held.get(name) - 1) : held.delete(name));
    },
    async names() { return [...held.keys()]; },
  };
}

function rig({ disk = new Map(), locks = memoryLocks(), faults = {}, mutant = "", estimate } = {}) {
  const r = makeRing(new SharedArrayBuffer(4 * FRAME), new SharedArrayBuffer(makeRing.tableBytes(4)), FRAME);
  const s = makeStore({ arm: memoryArm(disk, faults), ring: r, check: (b, i) => hash(b) === digests[i], locks, mutant, estimate, waitMs: 50 });
  /** Frame i into a slot held by the view and the store, as a feeder leaves it. */
  const feed = (i) => {
    const slot = r.claim(2);
    r.bytes(slot).set(field(i));
    return slot;
  };
  return { r, s, disk, locks, feed };
}

// The ring: a slot is free only once every holder released it, and a free counts once.
{
  const r = makeRing(new SharedArrayBuffer(2 * FRAME), new SharedArrayBuffer(makeRing.tableBytes(2)), FRAME);
  const a = r.claim(2);
  const b = r.claim(1);
  check(a !== b && r.claim(1) === -1, "two slots, two claims, a third refused");
  r.release(a);
  check(r.claim(1) === -1, "a slot with one holder left is not free");
  r.release(a);
  check(r.freed() === 1 && r.claim(1) === a, "the last release frees it, counted once");
  r.readAsked();
  r.readAsked();
  r.readServed();
  check(r.readsWaiting() === 1, "the reads-first count: two asked, one served");
}

// A frame written and read back is exact; its slot is free once the store has written it and the view let it go.
{
  const { r, s, feed } = rig();
  check((await s.open("A", meta())).cache, "a store opens");
  const slot = feed(3);
  await s.write(3, slot);
  r.release(slot);
  check(r.claim(1) !== -1 && r.freed() === 1, "the slot is free after the write and the view's release");
  const into = new Uint8Array(FRAME);
  const got = await s.read(3, into);
  check(got.hit && hash(into) === digests[3], "read back exact");
  check(!(await s.read(4, into)).hit, "a frame never written is a miss");
}

// Mutant slot-held: the store never lets the slot go.
{
  const { r, s, feed } = rig({ mutant: "slot-held" });
  await s.open("A", meta());
  const slot = feed(1);
  await s.write(1, slot);
  r.release(slot);
  check(r.freed() === 0, "slot-held: the slot stays held (the mutant the delivered-rate bar catches)");
}

// A store that holds its own copy frees the slot before its write ends (8.1).
{
  const { r, s, feed } = rig({ faults: { releaseEarly: true } });
  await s.open("A", meta());
  const slot = feed(2);
  r.release(slot);
  await s.write(2, slot);
  check(r.freed() === 1, "an early release frees the slot once, not twice");
}

// Every read is re-checked: a damaged frame is a miss, reported, and its record dropped so the fill asks it again.
for (const mutant of ["", "no-recheck"]) {
  const { s, feed, disk } = rig({ mutant });
  await s.open("A", meta());
  await s.write(5, feed(5));
  disk.get("A").frames.get(5)[7] ^= 0x40;
  const got = await s.read(5, new Uint8Array(FRAME));
  const caught = !got.hit && got.damaged && !disk.get("A").frames.has(5);
  check(mutant ? !caught : caught, `${mutant || "unmutated"}: a damaged frame ${mutant ? "goes unseen" : "is caught and dropped"}`);
}

// Mutant drop-writes: the store says written and keeps nothing.
{
  const { s, feed } = rig({ mutant: "drop-writes" });
  await s.open("A", meta());
  const w = await s.write(0, feed(0));
  check(w.written && !(await s.read(0, new Uint8Array(FRAME))).hit, "drop-writes: written said, nothing read back");
}

// A miss on a frame whose write is pending is answered from the slot the store still holds (8.1).
{
  let release = null;
  const gate = new Promise((r) => (release = r));
  const { s, feed } = rig();
  await s.open("A", meta());
  const arm = s.arm;
  const write = arm.write.bind(arm);
  arm.write = async (...a) => (await gate, write(...a));
  const pending = s.write(6, feed(6));
  const into = new Uint8Array(FRAME);
  const got = await s.read(6, into);
  check(got.hit && got.fromPending && hash(into) === digests[6], "a pending frame is read from its slot");
  release();
  await pending;
}

// A digest list that differs at open drops the series.
{
  const disk = new Map();
  const a = rig({ disk });
  await a.s.open("A", meta());
  await a.s.write(1, a.feed(1));
  await a.s.close();
  const b = rig({ disk });
  const other = digests.map((d, i) => (i === 1 ? "0" : d));
  const o = await b.s.open("A", meta(other));
  check(o.present.length === 0, "a changed digest list opens empty");
}

// Eviction: only to make room, least recently opened first, never a series open in a tab; mutant evict-newest.
for (const mutant of ["", "evict-newest"]) {
  const disk = new Map();
  let t = 0;
  const locks = memoryLocks();
  const faults = { quota: 2 * N * FRAME, clock: () => ++t };
  const opened = [];
  for (const name of ["A", "B"]) {
    const x = rig({ disk, locks, faults, mutant });
    await x.s.open(name, meta());
    opened.push(x);
  }
  await opened[0].s.close();
  await opened[1].s.close();
  const c = rig({ disk, locks, faults, mutant });
  check((await c.s.open("C", meta())).cache, `${mutant || "unmutated"}: C opens by evicting`);
  const kept = [...disk.keys()].sort().join("");
  check(mutant ? kept !== "BC" : kept === "BC", `${mutant || "unmutated"}: after C, ${kept} (least recently opened, A, evicted)`);
}
{
  const disk = new Map();
  const locks = memoryLocks();
  let t = 0;
  const faults = { quota: 2 * N * FRAME, clock: () => ++t };
  const a = rig({ disk, locks, faults });
  await a.s.open("A", meta());
  const b = rig({ disk, locks, faults });
  await b.s.open("B", meta());
  await b.s.close();
  const c = rig({ disk, locks, faults });
  await c.s.open("C", meta());
  check(disk.has("A") && !disk.has("B"), "A, held open in a tab, is skipped; B evicted");
  const d = rig({ disk, locks, faults });
  const o = await d.s.open("D", meta());
  check(!o.cache && disk.has("A") && disk.has("C"), "nothing evictable: no cache, nothing open removed");
}

// The disk fills mid-fill: evict one, retry once, else stop writing; nothing escapes, the fill goes on.
{
  const disk = new Map();
  let t = 0;
  const locks = memoryLocks();
  for (const name of ["old", "older", "oldest"].reverse()) {
    const old = rig({ disk, locks, faults: { clock: () => ++t } });
    await old.s.open(name, meta());
    await old.s.close();
  }
  let throws = 1;
  const x = rig({ disk, locks, faults: { clock: () => ++t, writeThrows: () => throws-- > 0 } });
  await x.s.open("A", meta());
  const w = await x.s.write(0, x.feed(0));
  check(w.written && !disk.has("oldest") && disk.has("older"), "one refusal: the oldest series evicted and the write retried");
  throws = 2;
  const w2 = await x.s.write(1, x.feed(1));
  check(!w2.written && x.s.stopped && disk.has("old"), "a refusal after the retry: writing stops, one series evicted a write");
  const w3 = await x.s.write(2, x.feed(2));
  check(!w3.written, "after a stop, a write is refused without an exception");
}

// The retry after an eviction waits for estimate() to show the room, at most the bound.
{
  const disk = new Map();
  let t = 0;
  const locks = memoryLocks();
  const faults = { quota: N * FRAME, clock: () => ++t };
  const a = rig({ disk, locks, faults });
  await a.s.open("A", meta());
  await a.s.close();
  let calls = 0;
  const estimate = async () => (++calls < 3 ? { quota: N * FRAME, usage: N * FRAME } : { quota: N * FRAME, usage: 0 });
  const b = rig({ disk, locks, faults, estimate });
  const o = await b.s.open("B", meta());
  check(o.cache && calls >= 3, `the retry waited for the room (${calls} estimates)`);
}

// Two tabs on one series: the second reads what is present and writes nothing; mutant tab-writes.
for (const mutant of ["", "tab-writes"]) {
  const disk = new Map();
  const locks = memoryLocks();
  const one = rig({ disk, locks });
  await one.s.open("A", meta());
  await one.s.write(0, one.feed(0));
  const two = rig({ disk, locks, mutant });
  const o = await two.s.open("A", meta());
  check(o.cache && !o.writer && o.present.includes(0), `${mutant || "unmutated"}: tab 2 opens as a reader with frame 0 present`);
  await two.s.write(1, two.feed(1));
  check(mutant ? two.s.writes === 1 : two.s.writes === 0, `${mutant || "unmutated"}: tab 2 wrote ${two.s.writes}`);
  check((await two.s.read(0, new Uint8Array(FRAME))).hit, "tab 2 reads a present frame");
  disk.get("A").frames.get(0)[0] ^= 1;
  const bad = await two.s.read(0, new Uint8Array(FRAME));
  check(!bad.hit && !bad.damaged && disk.get("A").frames.has(0), "in tab 2 a failed re-check is a miss, not a damaged frame: nothing dropped");
}

// The `none` arm and a store that cannot open: no cache, every write refused quietly, every read a miss.
{
  const { none } = await import("./arms/none.js");
  const r = makeRing(new SharedArrayBuffer(FRAME), new SharedArrayBuffer(makeRing.tableBytes(1)), FRAME);
  const s = makeStore({ arm: none(), ring: r, check: () => true, locks: memoryLocks() });
  const o = await s.open("A", meta());
  const slot = r.claim(1);
  const w = await s.write(0, slot);
  check(!o.cache && !w.written && r.freed() === 1, "none: no cache, the slot let go at once");
  check(!(await s.read(0, new Uint8Array(FRAME))).hit, "none: a read is a miss");
}

// An arm that writes in pieces is handed the store worker's way to let waiting reads in (§7.1, reads first).
{
  const r = makeRing(new SharedArrayBuffer(FRAME), new SharedArrayBuffer(makeRing.tableBytes(1)), FRAME);
  const serveReads = async () => {};
  let given = null;
  const arm = { ...memoryArm(new Map()), write: async (i, b, ctx) => (given = ctx) };
  const s = makeStore({ arm, ring: r, check: () => true, locks: memoryLocks(), serveReads });
  await s.open("A", meta());
  await s.write(0, r.claim(1));
  check(given?.serveReads === serveReads && given.readsWaiting === r.readsWaiting, "the write's context carries serveReads and readsWaiting");
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("cache-arms: the ring and the rules above the seam hold");
