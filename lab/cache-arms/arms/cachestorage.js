// CACHESTORAGE: a Cache per series, a response per frame under a same-origin path never fetched. cache-plan.md §7.4;
// how this build departs from it, README.md §CACHESTORAGE as built.
const BASE = "/frame-cache/";
const NAME = "frames ";
const PIECE = 2 ** 20;
const quotaError = (message) => Object.assign(new Error(message), { name: "QuotaExceededError" });

/** The frame's shared views, one a chunk: a stream body copies nothing in script. */
const streamOf = (bytes) => {
  let at = 0;
  return new ReadableStream({
    pull(c) {
      if (at >= bytes.length) return c.close();
      c.enqueue(bytes.subarray(at, (at += PIECE)));
    },
  });
};

/** `pilot`: `inflight` (puts at once, 1 or 3; buffered only) and `body` (`buffered`, the default, or `streamed`).
 *  `env` replaces the worker's globals in tests. */
export function cachestorage(pilot = new URLSearchParams(), env = globalThis) {
  const streamed = pilot.get("body") === "streamed";
  const inflight = streamed ? 1 : Number(pilot.get("inflight") ?? 1);
  const { caches } = env;
  const estimate = () => env.navigator.storage.estimate();
  let cache = null;
  let base = "";
  let writer = false;
  let pool = [];
  const flying = new Map();
  let refused = [];
  let takenBy = null;

  const key = (i) => base + i;
  const prefix = (s) => `${BASE}${encodeURIComponent(s)}/`;
  const readManifest = async (c, s) => (await c.match(prefix(s) + "manifest"))?.json() ?? null;

  async function bodyInto(response, into) {
    if (!streamed) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== into.length) return false;
      into.set(bytes);
      return true;
    }
    const reader = response.body.getReader();
    let at = 0;
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      if (at + r.value.length > into.length) {
        await reader.cancel();
        return false;
      }
      into.set(r.value, at);
      at += r.value.length;
    }
    return at === into.length;
  }

  /** A buffered put: its buffer back to the pool once stored, kept with its error when refused. */
  function putOwn(i, buf) {
    const p = cache.put(key(i), new Response(buf)).then(
      () => pool.push(buf),
      (error) => refused.push({ i, buf, error }),
    ).finally(() => flying.get(i) === p && flying.delete(i));
    flying.set(i, p);
    return p;
  }

  /** The refused frames put again from their own copies; one still refused throws. */
  async function retryRefused() {
    const again = refused.splice(0);
    await Promise.all(again.map((r) => putOwn(r.i, r.buf)));
    if (refused.length) throw refused[0].error;
    return again.map((r) => r.i);
  }

  const a = {
    name: "cachestorage",
    async open(s, meta, { create }) {
      [base, writer, refused, takenBy] = [prefix(s), create, [], null];
      const name = NAME + s;
      const exists = await caches.has(name);
      if (!create && !exists) return { present: [], meta: null };
      if (create && !exists) {
        const { quota, usage } = await estimate();
        if (quota - usage < meta.digests.length * meta.frameBytes) {
          throw quotaError(`${quota - usage} bytes left for ${meta.digests.length * meta.frameBytes}`);
        }
      }
      cache = await caches.open(name);
      const before = await readManifest(cache, s);
      const present = (await cache.keys()).map((r) => r.url.slice(r.url.lastIndexOf("/") + 1)).filter((k) => /^\d+$/.test(k));
      if (create) await cache.put(key("manifest"), new Response(JSON.stringify({ ...meta, lastOpen: Date.now() })));
      return { present: present.map(Number).sort((x, y) => x - y), meta: before };
    },

    /** Buffered: the slot copied into a buffer of its own, let go, and put; returns once fewer than `inflight` puts
     *  are in flight, so a refusal may be thrown by a later write, whose retry puts the refused frames first. */
    async write(i, bytes, { release = () => {} } = {}) {
      if (!writer) throw new Error("a reading tab writes nothing");
      if (streamed) return void (await cache.put(key(i), new Response(streamOf(bytes))));
      const retried = await retryRefused();
      if (takenBy !== i && !retried.includes(i)) {
        let buf = pool.pop();
        if (buf?.byteLength !== bytes.length) buf = new ArrayBuffer(bytes.length);
        new Uint8Array(buf).set(bytes);
        release();
        putOwn(i, buf);
      }
      takenBy = null;
      while (flying.size >= inflight) await Promise.race(flying.values());
      if (refused.length) {
        takenBy = i;
        throw refused[0].error;
      }
    },

    async read(i, into) {
      await flying.get(i);
      const kept = refused.find((r) => r.i === i);
      if (kept) {
        if (kept.buf.byteLength !== into.length) return false;
        into.set(new Uint8Array(kept.buf));
        return true;
      }
      const response = await cache.match(key(i));
      return response ? bodyInto(response, into) : false;
    },
    async drop(i) {
      if (writer) await cache.delete(key(i));
    },
    evict: (s) => caches.delete(NAME + s),
    async list() {
      const out = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith(NAME)) continue;
        const s = name.slice(NAME.length);
        out.push({ series: s, lastOpen: (await readManifest(await caches.open(name), s))?.lastOpen ?? 0 });
      }
      return out;
    },
    async close() {
      await Promise.allSettled(flying.values());
      [cache, pool, refused, takenBy] = [null, [], [], null];
    },
    async damage(i) {
      const bytes = new Uint8Array(await (await cache.match(key(i))).arrayBuffer());
      bytes[7] ^= 0x40;
      await cache.put(key(i), new Response(bytes));
    },
    /** The floor: `count` puts of one frame's own buffer, then `count` matches read into `into`, in a cache of its
     *  own; the copy out of shared memory is made once, outside the timing. */
    async floor(bytes, into, count) {
      const own = bytes.slice().buffer;
      const c = await caches.open("floor");
      const time = async (f) => { const t = performance.now(); await f(); return performance.now() - t; };
      const writeMs = [];
      const readMs = [];
      try {
        for (let k = 0; k < count; k++) writeMs.push(await time(() => c.put(`${BASE}floor/${k}`, new Response(own))));
        for (let k = 0; k < count; k++) {
          readMs.push(await time(async () => into.set(new Uint8Array(await (await c.match(`${BASE}floor/${k}`)).arrayBuffer()))));
        }
      } finally {
        await caches.delete("floor");
      }
      return { writeMs, readMs };
    },
  };
  return a;
}
export default cachestorage;
