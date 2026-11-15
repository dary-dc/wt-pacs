// node lab/cache-arms/arms/cachestorage.test.mjs — CACHESTORAGE (cache-plan.md §7.4, its rows of §7.5) against a Cache
// Storage kept in memory whose puts read their whole body, store a tick later, refuse past a quota, and can vanish.
import { cachestorage } from "./cachestorage.js";

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const failure = (name) => Object.assign(new Error(name), { name });
const rejects = async (p) => p.then(() => null, (e) => e);
const tick = () => new Promise((r) => setTimeout(r, 0));

const FRAME = 2 ** 20 + 4096;
const N = 6;
const patterns = new Map();
const pattern = (i) => {
  if (!patterns.has(i)) patterns.set(i, new Uint8Array(FRAME).map((_, k) => (i * 31 + k) & 0xff));
  return patterns.get(i);
};
const frame = (i) => {
  const b = new Uint8Array(new SharedArrayBuffer(FRAME));
  b.set(pattern(i));
  return b;
};
const meta = (n = N) => ({ digests: [...Array(n).keys()].map(String), frameBytes: FRAME, shape: [32, 64] });
const same = (a, b) => a.length === b.length && (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)
  ? Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0
  : [...a].every((x, k) => x === b[k]));
const pilot = (s) => new URLSearchParams(s);

/** Every Response the arm builds, with the body it was given. */
const bodies = [];
globalThis.Response = class extends Response {
  constructor(body, init) {
    super(body, init);
    bodies.push(body);
  }
};

/** One origin's Cache Storage: a put reads its body whole, then stores it a tick later unless that passes `quota`
 *  (rejected, nothing stored); `gone` rejects every call. */
class Origin {
  quota = Infinity;
  room = Infinity;
  gone = false;
  caches = new Map();
  flying = 0;
  maxFlying = 0;
  keyKinds = new Set();
  chunks = [];
  estimates = 0;
  used = () => [...this.caches.values()].reduce((s, c) => s + [...c.values()].reduce((t, b) => t + b.length, 0), 0);
  env() {
    const o = this;
    const live = async () => { if (o.gone) throw failure("InvalidStateError"); };
    return {
      navigator: { storage: { estimate: async () => (o.estimates++, { quota: o.room, usage: 0 }) } },
      caches: {
        has: async (name) => (await live(), o.caches.has(name)),
        async open(name) {
          await live();
          if (!o.caches.has(name)) o.caches.set(name, new Map());
          return o.cache(name);
        },
        delete: async (name) => (await live(), o.caches.delete(name)),
        keys: async () => (await live(), [...o.caches.keys()]),
      },
    };
  }
  cache(name) {
    const o = this;
    const records = () => o.caches.get(name) ?? new Map();
    const url = (key) => new URL(key, "https://origin.test").href;
    const live = async () => { if (o.gone) throw failure("InvalidStateError"); };
    return {
      async put(key, response) {
        await live();
        o.maxFlying = Math.max(o.maxFlying, ++o.flying);
        o.keyKinds.add(typeof key);
        try {
          const parts = [];
          for await (const chunk of response.body) parts.push(chunk);
          o.chunks.push(parts);
          const bytes = new Uint8Array(Buffer.concat(parts.map((c) => Buffer.from(c))));
          await tick();
          if (o.used() + bytes.length > o.quota) throw failure("QuotaExceededError");
          records().set(url(key), bytes);
        } finally {
          o.flying--;
        }
      },
      async match(key) {
        await live();
        const b = records().get(url(key));
        return b && new Response(b.slice());
      },
      keys: async () => (await live(), [...records().keys()].map((u) => ({ url: u }))),
      delete: async (key) => (await live(), records().delete(url(key))),
    };
  }
  record(series, i) {
    return this.caches.get(`frames ${series}`)?.get(`https://origin.test/frame-cache/${encodeURIComponent(series)}/${i}`);
  }
}

const readBack = async (a, i) => {
  const into = new Uint8Array(new SharedArrayBuffer(FRAME));
  return (await a.read(i, into)) ? into : null;
};

/** Buffered: a frame is a response under /frame-cache/<series>/i in the series' Cache, one put in flight, exact. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  check(same((await a.open("s/1", meta(), { create: true })).present, []), "a new series has nothing present");
  for (let i = 0; i < N; i++) await a.write(i, frame(i));
  check(o.record("s/1", 2) !== undefined, "the key is the series' encoded path and the index");
  check(o.caches.get("frames s/1").has("https://origin.test/frame-cache/s%2F1/manifest"), "the manifest is one more record");
  check(o.maxFlying === 1, `one put in flight (${o.maxFlying})`);
  check(same([...o.keyKinds], ["string"]), "every key a string, no Request built");
  for (let i = 0; i < N; i++) check(same(await readBack(a, i), pattern(i)), `frame ${i} reads back exact`);
}

/** Buffered: each body is the arm's own ArrayBuffer, never shared memory, and one buffer serves every put. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  bodies.length = 0;
  for (let i = 0; i < 3; i++) await a.write(i, frame(i));
  check(bodies.every((b) => b instanceof ArrayBuffer), "the bodies are ArrayBuffers");
  check(new Set(bodies).size === 1, `one buffer reused (${new Set(bodies).size})`);
}

/** A write at one put in flight resolves only once its frame is stored. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  check(o.record("s", 0) !== undefined, "the frame stored when write returns");
}

/** The slot is let go once the arm's buffer holds the frame; a reused slot or buffer changes no stored frame. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  const slot = frame(1);
  let released = 0;
  await a.write(1, slot, { release: () => (released++, slot.fill(0)) });
  check(released === 1, "released once");
  check(same(o.record("s", 1), pattern(1)), "the stored frame is the arm's copy, not the reused slot");
  await a.write(2, frame(2));
  check(same(await readBack(a, 1), pattern(1)), "the buffer reused for the next frame leaves the first intact");
}

/** inflight=3: up to three puts at once, write returning before its frame is stored; a read of a frame in flight
 *  waits for it; close lets every put land. */
{
  const o = new Origin();
  const a = cachestorage(pilot("inflight=3"), o.env());
  await a.open("s", meta(), { create: true });
  for (let i = 0; i < 3; i++) await a.write(i, frame(i));
  check(o.record("s", 2) === undefined, "the third write returned before its frame was stored");
  check(same(await readBack(a, 2), pattern(2)), "a read of a frame in flight waits and reads it exact");
  for (let i = 3; i < N; i++) await a.write(i, frame(i));
  check(o.maxFlying === 3, `three puts in flight (${o.maxFlying})`);
  await a.close();
  check([...Array(N).keys()].every((i) => same(o.record("s", i), pattern(i))), "every frame stored after close");
}

/** At one put in flight the disk fills mid-fill: write throws QuotaExceededError, nothing of the frame lands, and
 *  the store's retry of the same frame puts the arm's copy although the slot was let go and reused. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  o.quota = o.used() + FRAME - 1;
  const slot = frame(1);
  const e = await rejects(a.write(1, slot, { release: () => slot.fill(9) }));
  check(e?.name === "QuotaExceededError", `mid-fill refusal (${e?.name})`);
  check(o.record("s", 1) === undefined, "nothing of the refused frame landed");
  check(same(await readBack(a, 1), pattern(1)), "a refused frame reads from the arm's copy");
  o.quota = Infinity;
  await a.write(1, slot);
  check(same(o.record("s", 1), pattern(1)), "the retry stored the frame, not the reused slot");
  await a.write(2, frame(2));
  check(same(await readBack(a, 2), pattern(2)), "the next frame is its own");
}

/** inflight=3: a put refused after its write returned is thrown by a later write; that write's retry puts the
 *  refused frame first and does not take its own frame from the slot a second time. */
{
  const o = new Origin();
  const a = cachestorage(pilot("inflight=3"), o.env());
  await a.open("s", meta(), { create: true });
  o.quota = o.used() + FRAME;
  const slots = [0, 1, 2, 3].map(frame);
  const errors = [];
  for (let i = 0; i < 4; i++) {
    const e = await rejects(a.write(i, slots[i], { release: () => slots[i].fill(7) }));
    if (e) {
      errors.push([i, e.name]);
      o.quota = Infinity;
      await a.write(i, slots[i]);
    }
  }
  await a.close();
  check(errors.length === 1 && errors[0][1] === "QuotaExceededError", `one refusal thrown (${JSON.stringify(errors)})`);
  check([0, 1, 2, 3].every((i) => same(o.record("s", i) ?? [], pattern(i))), "every frame stored exact after the retry");
}

/** Streamed: the body is the slot's own views, the slot held until the frame is stored, and a read streamed into
 *  the slot; one put in flight whatever `inflight` asks. */
{
  const o = new Origin();
  const a = cachestorage(pilot("body=streamed&inflight=3"), o.env());
  await a.open("s", meta(), { create: true });
  let released = 0;
  for (let i = 0; i < N; i++) await a.write(i, frame(i), { release: () => released++ });
  check(released === 0, "the arm lets no slot go: the store does once written");
  check(o.maxFlying === 1, `one put in flight (${o.maxFlying})`);
  check(o.record("s", 5) !== undefined, "the last frame stored when its write returns");
  const chunks = o.chunks.slice(1).flat();
  check(chunks.every((c) => c.buffer instanceof SharedArrayBuffer && c.length <= 2 ** 20), "the body is the slot's own views, 1 MiB at most");
  for (let i = 0; i < N; i++) check(same(await readBack(a, i), pattern(i)), `frame ${i} streamed back exact`);
  check(!(await a.read(0, new Uint8Array(FRAME - 1))), "a streamed read into a short slot is refused");
  check(!(await a.read(0, new Uint8Array(FRAME + 1))), "a streamed read that does not fill its slot is refused");
}

/** Streamed, the disk fills: the put rejects and the store's retry streams the frame again from its held slot. */
{
  const o = new Origin();
  const a = cachestorage(pilot("body=streamed"), o.env());
  await a.open("s", meta(), { create: true });
  o.quota = o.used() + FRAME - 1;
  const slot = frame(0);
  check((await rejects(a.write(0, slot)))?.name === "QuotaExceededError", "the streamed put refused");
  o.quota = Infinity;
  await a.write(0, slot);
  check(same(o.record("s", 0), pattern(0)), "the retry stored the frame");
}

/** Present at open: the series' frames, not its manifest nor another series' frames; the stored manifest back. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  for (const i of [0, 3, 5]) await a.write(i, frame(i));
  await a.close();
  await a.open("s2", meta(), { create: true });
  await a.write(1, frame(1));
  await a.close();
  const r = await a.open("s", meta(), { create: false });
  check(same(r.present, [0, 3, 5]), `present at reopen (${r.present})`);
  check(same(r.meta.digests, meta().digests), "the stored manifest comes back");
}

/** Does it fit: a new series is refused at open when estimate() is short, before its Cache is made. */
{
  const o = new Origin();
  o.room = N * FRAME - 1;
  const a = cachestorage(undefined, o.env());
  const e = await rejects(a.open("s", meta(), { create: true }));
  check(e?.name === "QuotaExceededError", `refused at open (${e?.name})`);
  check(o.caches.size === 0, "no Cache left by the refusal");
  o.room = N * FRAME;
  check(!(await rejects(a.open("s", meta(), { create: true }))), "opens when the room is exactly the series");
}

/** A series already present is not estimated again at its reopen. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.close();
  o.room = 0;
  const before = o.estimates;
  check(!(await rejects(a.open("s", meta(), { create: true }))), "a present series reopens");
  check(o.estimates === before, "no estimate at a reopen");
}

/** The origin emptied between opens: a reading tab finds nothing and makes no Cache; a writer starts fresh. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  await a.close();
  await a.evict("s");
  const r = await a.open("s", meta(), { create: false });
  check(r.meta === null && r.present.length === 0, "a reader finds nothing");
  check(!o.caches.has("frames s"), "the reader made no Cache");
  const w = await a.open("s", meta(), { create: true });
  check(w.meta === null && w.present.length === 0, "a writer starts fresh");
}

/** The store vanishes while open: a read rejects, which the store takes as a miss. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  o.gone = true;
  check(await rejects(readBack(a, 0)), "a read rejects");
}

/** A reading tab: open writes no manifest, write throws, drop deletes nothing. */
{
  const o = new Origin();
  const w = cachestorage(undefined, o.env());
  await w.open("s", meta(), { create: true });
  await w.write(0, frame(0));
  const lastOpen = (await w.list())[0].lastOpen;
  const r = cachestorage(undefined, o.env());
  await new Promise((res) => setTimeout(res, 2));
  check(same((await r.open("s", meta(), { create: false })).present, [0]), "the reader sees what is present");
  check((await r.list())[0].lastOpen === lastOpen, "the reader wrote no manifest");
  check(await rejects(r.write(1, frame(1))), "the reader's write throws");
  await r.drop(0);
  check(o.record("s", 0) !== undefined, "the reader's drop deletes nothing");
}

/** A damaged frame fails its exact read; drop deletes its response, and the frame then reads as absent. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  await a.write(1, frame(1));
  await a.damage(0);
  const got = await readBack(a, 0);
  check(got && got.reduce((d, x, k) => d + (x !== pattern(0)[k]), 0) === 1, "one byte damaged");
  await a.drop(0);
  check((await readBack(a, 0)) === null, "dropped reads as absent");
  check(same(await readBack(a, 1), pattern(1)), "its neighbour stays");
}

/** Eviction deletes a series' Cache whole, its frames and its manifest, and no other series. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  for (const s of ["a", "b"]) {
    await a.open(s, meta(), { create: true });
    for (let i = 0; i < 3; i++) await a.write(i, frame(i));
    await a.close();
  }
  await a.evict("a");
  check(same((await a.list()).map((x) => x.series), ["b"]), "only b stays");
  check([0, 1, 2].every((i) => o.record("b", i) !== undefined), "b's frames stay");
}

/** list gives each series with its last open, and nothing that is not a series. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("x", meta(), { create: true });
  await a.close();
  await new Promise((res) => setTimeout(res, 2));
  await a.open("y", meta(), { create: true });
  await o.env().caches.open("another");
  const l = Object.fromEntries((await a.list()).map((x) => [x.series, x.lastOpen]));
  check(same(Object.keys(l), ["x", "y"]), `only series listed (${Object.keys(l)})`);
  check(l.x > 0 && l.y > l.x, "lastOpen per series");
}

/** A frame of another size reads as absent, never into a slot it does not fill. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  check(!(await a.read(0, new Uint8Array(FRAME / 2))), "a short slot is not filled");
}

/** The floor: count puts and count reads into `into`, in a Cache of its own that is gone after. */
{
  const o = new Origin();
  const a = cachestorage(undefined, o.env());
  await a.open("s", meta(), { create: true });
  const into = new Uint8Array(new SharedArrayBuffer(FRAME));
  const f = await a.floor(frame(4), into, 3);
  check(f.writeMs.length === 3 && f.readMs.length === 3, "three of each");
  check(same(into, pattern(4)), "the read filled into");
  check(same([...o.caches.keys()], ["frames s"]), `the floor's Cache removed (${[...o.caches.keys()]})`);
}

await tick();
console.log(failed ? `${failed} failed` : "cache-arms: CACHESTORAGE holds its design and its failure rows");
process.exit(failed ? 1 : 0);
