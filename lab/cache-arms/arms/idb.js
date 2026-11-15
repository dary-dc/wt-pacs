// IDB: a record per frame as a Blob, one relaxed transaction a frame, one in flight. cache-plan.md §7.3;
// how this build departs from it, README.md §IDB as built.
const DB = "cache-arms";
const FRAMES = "frames";
const SERIES = "series";

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const committed = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? Object.assign(new Error("transaction aborted"), { name: "AbortError" }));
});
const quotaError = (message) => Object.assign(new Error(message), { name: "QuotaExceededError" });

/** `pilot`: `value` (`blob`, the default, or `buffer`, an ArrayBuffer: Gecko's pilot only). `env` replaces the
 *  worker's globals in tests. */
export function idb(pilot = new URLSearchParams(), env = globalThis) {
  const asBuffer = pilot.get("value") === "buffer";
  const { indexedDB, IDBKeyRange } = env;
  const estimate = () => env.navigator.storage.estimate();
  let db = null;
  let series = null;
  let n = 0;
  let writer = false;
  let scratch = null;
  let refused = null;

  const all = (s) => IDBKeyRange.bound([s, 0], [s, Infinity]);
  const tx = async (stores, mode) => (await connect()).transaction(stores, mode, { durability: "relaxed" });

  async function connect() {
    if (db) return db;
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(FRAMES);
      request.result.createObjectStore(SERIES);
    };
    db = await done(request);
    return db;
  }

  /** One `put` in its own transaction, committed before it resolves: the next write's transaction is made after. */
  async function put(store, value, key) {
    const t = await tx(store, "readwrite");
    t.objectStore(store).put(value, key);
    const c = committed(t);
    t.commit();
    await c;
  }

  async function get(i) {
    const t = await tx(FRAMES, "readonly");
    return done(t.objectStore(FRAMES).get([series, i]));
  }

  const bytesOf = async (value) => new Uint8Array(value instanceof ArrayBuffer ? value : await value.arrayBuffer());

  /** The frame copied out of shared memory into the reused scratch, then into the value the record keeps. */
  function valueOf(bytes) {
    if (scratch?.byteLength !== bytes.length) scratch = new ArrayBuffer(bytes.length);
    new Uint8Array(scratch).set(bytes);
    return asBuffer ? scratch.slice(0) : new Blob([scratch]);
  }

  const a = {
    name: "idb",
    async open(s, meta, { create }) {
      [series, n, writer, refused] = [s, meta.digests.length, create, null];
      const t = await tx([FRAMES, SERIES], "readonly");
      const [before, keys] = await Promise.all([
        done(t.objectStore(SERIES).get(s)),
        done(t.objectStore(FRAMES).getAllKeys(IDBKeyRange.bound([s, 0], [s, n - 1]))),
      ]);
      if (!create && !before) return { present: [], meta: null };
      if (create && !before) {
        const { quota, usage } = await estimate();
        if (quota - usage < n * meta.frameBytes) throw quotaError(`${quota - usage} bytes left for ${n * meta.frameBytes}`);
      }
      if (create) await put(SERIES, { ...meta, series: s, lastOpen: Date.now() }, s);
      return { present: keys.map(([, i]) => i), meta: before ?? null };
    },

    /** Resolves once the frame's transaction is committed. A refused frame keeps its value, since its slot is let go:
     *  the store's retry of the same frame writes it. */
    async write(i, bytes, { release = () => {} } = {}) {
      if (!writer) throw new Error("a reading tab writes nothing");
      const value = refused?.i === i ? refused.value : valueOf(bytes);
      release();
      refused = null;
      try {
        await put(FRAMES, value, [series, i]);
      } catch (e) {
        refused = { i, value };
        throw e;
      }
    },

    async read(i, into) {
      const value = await get(i);
      if (value === undefined) return false;
      const bytes = await bytesOf(value);
      if (bytes.length !== into.length) return false;
      into.set(bytes);
      return true;
    },
    async drop(i) {
      if (!writer) return;
      const t = await tx(FRAMES, "readwrite");
      t.objectStore(FRAMES).delete([series, i]);
      await committed(t);
    },
    /** The series whole or not at all: its frames and its record in one transaction. */
    async evict(s) {
      const t = await tx([FRAMES, SERIES], "readwrite");
      t.objectStore(FRAMES).delete(all(s));
      t.objectStore(SERIES).delete(s);
      await committed(t);
    },
    async list() {
      const t = await tx(SERIES, "readonly");
      return (await done(t.objectStore(SERIES).getAll())).map((m) => ({ series: m.series, lastOpen: m.lastOpen ?? 0 }));
    },
    async close() {
      [series, scratch, refused] = [null, null, null];
      db?.close();
      db = null;
    },
    async damage(i) {
      const bytes = await bytesOf(await get(i));
      bytes[7] ^= 0x40;
      await put(FRAMES, asBuffer ? bytes.buffer : new Blob([bytes]), [series, i]);
    },
    /** The floor: `count` one-`put` transactions of a Blob, then of an ArrayBuffer (what Chromium's Snappy pass costs,
     *  §7.3), then `count` gets read into `into`; the copy out of shared memory is made once, outside the timing. */
    async floor(bytes, into, count) {
      const own = bytes.slice().buffer;
      const key = (k) => ["floor", k];
      const time = async (f) => { const t = performance.now(); await f(); return performance.now() - t; };
      const writeMs = [];
      const writeBufferMs = [];
      const readMs = [];
      try {
        for (let k = 0; k < count; k++) writeMs.push(await time(() => put(FRAMES, new Blob([own]), key(k))));
        for (let k = 0; k < count; k++) writeBufferMs.push(await time(() => put(FRAMES, own, key(count + k))));
        for (let k = 0; k < count; k++) {
          readMs.push(await time(async () => {
            const t = await tx(FRAMES, "readonly");
            into.set(await bytesOf(await done(t.objectStore(FRAMES).get(key(k)))));
          }));
        }
      } finally {
        await a.evict("floor");
      }
      return { writeMs, writeBufferMs, readMs };
    },
  };
  return a;
}
export default idb;
