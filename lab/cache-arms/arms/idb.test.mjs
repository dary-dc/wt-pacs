// node lab/cache-arms/arms/idb.test.mjs — IDB (cache-plan.md §7.3, its rows of §7.5) against an IndexedDB kept in
// memory whose transactions commit a tick after their last request, refuse past a quota, and can vanish.
import { idb } from "./idb.js";

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

const FRAME = 4096;
const N = 6;
const pattern = (i) => Uint8Array.from({ length: FRAME }, (_, k) => (i * 31 + k) & 0xff);
const frame = (i) => {
  const b = new Uint8Array(new SharedArrayBuffer(FRAME));
  b.set(pattern(i));
  return b;
};
const meta = (n = N) => ({ digests: [...Array(n).keys()].map(String), frameBytes: FRAME, shape: [32, 64] });
const same = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);

const cmp = (a, b) => {
  if (Array.isArray(a)) {
    for (let k = 0; k < Math.min(a.length, b.length); k++) if (cmp(a[k], b[k])) return cmp(a[k], b[k]);
    return a.length - b.length;
  }
  if (typeof a !== typeof b) return typeof a === "number" ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
};
const IDBKeyRange = { bound: (lower, upper) => ({ includes: (k) => cmp(lower, k) <= 0 && cmp(k, upper) <= 0 }) };
const inRange = (q, k) => (Array.isArray(q) || typeof q !== "object" ? cmp(q, k) === 0 : q.includes(k));
const sizeOf = (v) => v?.size ?? v?.byteLength ?? JSON.stringify(v).length;

/** One origin's IndexedDB: a transaction's writes are staged and land at its commit, a tick after its last request;
 *  a commit past `quota` aborts it with `QuotaExceededError`; `gone` makes every new transaction throw. */
class Origin {
  quota = Infinity;
  room = Infinity;
  gone = false;
  stores = new Map();
  log = [];
  kinds = [];
  open = 0;
  maxOpenWrites = 0;
  estimates = 0;
  used = () => [...this.stores.values()].reduce((s, m) => s + [...m.values()].reduce((t, r) => t + sizeOf(r.v), 0), 0);
  env() {
    const o = this;
    return {
      IDBKeyRange,
      navigator: { storage: { estimate: async () => (o.estimates++, { quota: o.room, usage: 0 }) } },
      indexedDB: {
        open() {
          const request = {};
          setTimeout(() => {
            request.result = o.db();
            if (!o.stores.size) request.onupgradeneeded?.();
            request.onsuccess?.();
          });
          return request;
        },
      },
    };
  }
  db() {
    const o = this;
    return {
      createObjectStore: (name) => o.stores.set(name, new Map()),
      close() {},
      transaction(names, mode, opts) {
        if (o.gone) throw failure("InvalidStateError");
        return o.tx([names].flat(), mode, opts);
      },
    };
  }
  tx(names, mode, opts) {
    const o = this;
    const staged = [];
    let pending = 0;
    let committing = false;
    let finished = false;
    if (mode === "readwrite") o.maxOpenWrites = Math.max(o.maxOpenWrites, ++o.open);
    const t = { mode, durability: opts?.durability, error: null, committed: false };
    o.log.push(t);
    const finish = () => {
      if (finished || pending) return;
      finished = true;
      if (mode === "readwrite") o.open--;
      const before = new Map([...o.stores].map(([k, m]) => [k, new Map(m)]));
      for (const op of staged) op();
      if (o.used() > o.quota) {
        o.stores = before;
        t.error = failure("QuotaExceededError");
        return t.onabort?.();
      }
      t.committed = true;
      t.oncomplete?.();
    };
    const request = (run) => {
      const r = {};
      pending++;
      setTimeout(() => {
        pending--;
        try {
          r.result = run();
          r.onsuccess?.();
        } catch (e) {
          r.error = e;
          r.onerror?.();
        }
        setTimeout(() => committing || !pending ? finish() : null);
      });
      return r;
    };
    t.commit = () => {
      committing = true;
      t.commitCalled = true;
    };
    t.objectStore = (name) => {
      if (!names.includes(name)) throw failure("NotFoundError");
      const m = () => o.stores.get(name);
      const keys = (q) => [...m().keys()].map((k) => m().get(k).k).filter((k) => q === undefined || inRange(q, k)).sort(cmp);
      const write = (op) => {
        if (mode !== "readwrite") throw failure("ReadOnlyError");
        return request(() => void staged.push(op));
      };
      return {
        put: (v, k) => (o.kinds.push(v?.constructor?.name), write(() => m().set(JSON.stringify(k), { k, v }))),
        delete: (q) => write(() => { for (const k of keys(q)) m().delete(JSON.stringify(k)); }),
        get: (k) => request(() => m().get(JSON.stringify(k))?.v),
        getAll: () => request(() => keys().map((k) => m().get(JSON.stringify(k)).v)),
        getAllKeys: (q) => request(() => keys(q)),
      };
    };
    return t;
  }
  record(series, i) {
    return this.stores.get("frames").get(JSON.stringify([series, i]))?.v;
  }
}

const valueBytes = async (v) => new Uint8Array(v instanceof ArrayBuffer ? v : await v.arrayBuffer());
const readBack = async (a, i) => {
  const into = new Uint8Array(new SharedArrayBuffer(FRAME));
  return (await a.read(i, into)) ? into : null;
};

/** A frame written is a Blob under [series, i], in a relaxed transaction its write commits, and reads back exact. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  check(same((await a.open("s", meta(), { create: true })).present, []), "a new series has nothing present");
  for (let i = 0; i < N; i++) await a.write(i, frame(i));
  check(o.record("s", 2) instanceof Blob, "the value is a Blob");
  const writes = o.log.filter((t) => t.mode === "readwrite");
  check(writes.every((t) => t.durability === "relaxed"), "every transaction relaxed");
  check(writes.every((t) => t.commitCalled), "commit() called after the put");
  check(o.maxOpenWrites === 1, `one write transaction in flight (${o.maxOpenWrites})`);
  for (let i = 0; i < N; i++) check(same(await readBack(a, i), pattern(i)), `frame ${i} reads back exact`);
}

/** A write resolves only once its transaction committed: the record is there when it returns. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  check(o.record("s", 0) !== undefined && o.log.at(-1).committed, "the frame committed when write returns");
}

/** The slot is let go once the value holds its own copy: a slot reused at release does not change the frame. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("s", meta(), { create: true });
  const slot = frame(1);
  let released = 0;
  await a.write(1, slot, { release: () => (released++, slot.fill(0)) });
  check(released === 1, "released once");
  check(same(await valueBytes(o.record("s", 1)), pattern(1)), "the value kept the frame, not the reused slot");
  await a.write(2, frame(2));
  check(same(await readBack(a, 1), pattern(1)), "the scratch reused for the next frame leaves the first intact");
}

/** Present at open: the series' own keys, not another series' with a shared prefix. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
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

/** Does it fit: a new series is refused at open when estimate() is short, before its record is written. */
{
  const o = new Origin();
  o.room = N * FRAME - 1;
  const a = idb(undefined, o.env());
  const e = await rejects(a.open("s", meta(), { create: true }));
  check(e?.name === "QuotaExceededError", `refused at open (${e?.name})`);
  check((await a.list()).length === 0, "no series record left by the refusal");
  o.room = N * FRAME;
  check(!(await rejects(a.open("s", meta(), { create: true }))), "opens when the room is exactly the series");
}

/** A series already present is not estimated again at its reopen. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.close();
  o.room = 0;
  const before = o.estimates;
  check(!(await rejects(a.open("s", meta(), { create: true }))), "a present series reopens");
  check(o.estimates === before, "no estimate at a reopen");
}

/** The disk fills mid-fill: the transaction aborts, write throws QuotaExceededError, and the store's retry of the
 *  same frame writes its kept value although the slot was let go and reused. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  o.quota = o.used() + FRAME - 1;
  const slot = frame(1);
  const e = await rejects(a.write(1, slot, { release: () => slot.fill(9) }));
  check(e?.name === "QuotaExceededError", `mid-fill refusal (${e?.name})`);
  check(o.record("s", 1) === undefined, "nothing of the refused frame landed");
  o.quota = Infinity;
  await a.write(1, slot);
  check(same(await readBack(a, 1), pattern(1)), "the retry wrote the frame, not the reused slot");
  await a.write(2, frame(2));
  check(same(await readBack(a, 2), pattern(2)), "the next frame is its own");
}

/** The origin emptied between opens: no series record, a fresh fill; a reading tab finds nothing. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  await a.close();
  await a.evict("s");
  const r = await a.open("s", meta(), { create: false });
  check(r.meta === null && r.present.length === 0, "a reader finds nothing");
  const w = await a.open("s", meta(), { create: true });
  check(w.meta === null && w.present.length === 0, "a writer starts fresh");
}

/** The store vanishes while open: a read rejects, which the store takes as a miss. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  o.gone = true;
  check(await rejects(readBack(a, 0)), "a read rejects");
}

/** A reading tab: open writes no record, write throws, drop deletes nothing. */
{
  const o = new Origin();
  const w = idb(undefined, o.env());
  await w.open("s", meta(), { create: true });
  await w.write(0, frame(0));
  const lastOpen = (await w.list())[0].lastOpen;
  const r = idb(undefined, o.env());
  await new Promise((res) => setTimeout(res, 2));
  check(same((await r.open("s", meta(), { create: false })).present, [0]), "the reader sees what is present");
  check((await r.list())[0].lastOpen === lastOpen, "the reader wrote no record");
  check(await rejects(r.write(1, frame(1))), "the reader's write throws");
  await r.drop(0);
  check(o.record("s", 0) !== undefined, "the reader's drop deletes nothing");
}

/** A damaged frame fails its exact read; drop deletes its record, and the frame then reads as absent. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  await a.write(1, frame(1));
  await a.damage(0);
  const got = await readBack(a, 0);
  check(got && !same(got, pattern(0)) && got.filter((x, k) => x !== pattern(0)[k]).length === 1, "one byte damaged");
  await a.drop(0);
  check((await readBack(a, 0)) === null, "dropped reads as absent");
  check(same(await readBack(a, 1), pattern(1)), "its neighbour stays");
}

/** Eviction takes a series whole, its frames and its record in one transaction, and no other series. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  for (const s of ["a", "b"]) {
    await a.open(s, meta(), { create: true });
    for (let i = 0; i < 3; i++) await a.write(i, frame(i));
    await a.close();
  }
  const before = o.log.length;
  await a.evict("a");
  check(o.log.length === before + 1, "one transaction");
  check(same((await a.list()).map((x) => x.series), ["b"]), "only b's record stays");
  check([0, 1, 2].every((i) => o.record("a", i) === undefined), "a's frames gone");
  check([0, 1, 2].every((i) => o.record("b", i) !== undefined), "b's frames stay");
}

/** list gives each series with its last open. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("x", meta(), { create: true });
  await a.close();
  await new Promise((res) => setTimeout(res, 2));
  await a.open("y", meta(), { create: true });
  const l = Object.fromEntries((await a.list()).map((x) => [x.series, x.lastOpen]));
  check(l.x > 0 && l.y > l.x, "lastOpen per series");
}

/** A frame of another size reads as absent, never into a slot it does not fill. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  check(!(await a.read(0, new Uint8Array(FRAME / 2))), "a short slot is not filled");
}

/** Gecko's pilot alternative: the value an ArrayBuffer, a copy of its own, reading back exact. */
{
  const o = new Origin();
  const a = idb(new URLSearchParams("value=buffer"), o.env());
  await a.open("s", meta(), { create: true });
  await a.write(0, frame(0));
  await a.write(1, frame(1));
  check(o.record("s", 0) instanceof ArrayBuffer, "the value is an ArrayBuffer");
  check(same(await readBack(a, 0), pattern(0)), "frame 0 kept, not overwritten by the reused scratch");
  await a.damage(1);
  check(o.record("s", 1) instanceof ArrayBuffer, "damage keeps the value's kind");
}

/** The floor: count one-put transactions of a Blob and of an ArrayBuffer, count reads into `into`, nothing left. */
{
  const o = new Origin();
  const a = idb(undefined, o.env());
  await a.open("s", meta(), { create: true });
  const into = new Uint8Array(new SharedArrayBuffer(FRAME));
  o.kinds = [];
  const f = await a.floor(frame(4), into, 3);
  check(f.writeMs.length === 3 && f.writeBufferMs.length === 3 && f.readMs.length === 3, "three of each");
  check(same(o.kinds, ["Blob", "Blob", "Blob", "ArrayBuffer", "ArrayBuffer", "ArrayBuffer"]), `a Blob then an ArrayBuffer put (${o.kinds})`);
  check(same(into, pattern(4)), "the read filled into");
  check(o.stores.get("frames").size === 0 && (await a.list()).length === 1, "the floor's records removed");
}

await tick();
console.log(failed ? `${failed} failed` : "cache-arms: IDB holds its design and its failure rows");
process.exit(failed ? 1 : 0);
