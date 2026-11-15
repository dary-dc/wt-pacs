// The rules above the seam, once for every arm (cache-plan.md §3, §7.0, §7.5, §8.1): the re-check on every read,
// eviction least recently opened first and only to make room, never a series open in a tab, the failure table.
// An arm is the seam: open(series, meta, {create}) → {present, meta}, write(i, bytes, ctx), read(i, into) → bool,
// drop(i), evict(series), list() → [{series, lastOpen}], close(), and settle() → lost indices for an arm whose write
// returns before its frame is stored; README.md §The seam.
const LOCK = "cache-arms";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sameDigests = (a, b) => a.length === b.length && a.every((d, i) => d === b[i]);
const task = () => new Promise((r) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => (ch.port1.close(), r());
  ch.port2.postMessage(0);
});

/** Reads let in while a write waits between its pieces (§7.1, reads first). The view counts a read before posting it,
 *  so a count above the queue is a message not yet dispatched: only a task lets it in, for at most `boundMs`. */
export function readsFirst({ queue, waiting, anyFree, serve, boundMs = 20 }) {
  return async () => {
    for (const t0 = performance.now(); waiting() > queue.length && performance.now() - t0 < boundMs; ) await task();
    while (queue.length && anyFree()) await serve(queue.shift());
  };
}

/** `check(bytes, i)`: the frame's XXH3 against its digest. `locks`: hold(name, opts) → release or null, names(). */
export function store({ arm, ring, check, locks, mutant = "", estimate = null, waitMs = 5000, serveReads = async () => {} }) {
  const s = {
    arm, series: null, meta: null, cache: false, writer: false, stopped: false,
    writes: 0, evicted: [], lost: [], lateRefusal: null, pending: new Map(), letGo: [],

    async open(series, meta) {
      s.series = series;
      s.meta = meta;
      s.letGo.push(await locks.hold(`${LOCK} open ${series}`, { mode: "shared" }));
      const exclusive = await locks.hold(`${LOCK} write ${series}`, { ifAvailable: true });
      s.writer = exclusive !== null;
      if (exclusive) s.letGo.push(exclusive);
      for (;;) {
        try {
          const o = await arm.open(series, meta, { create: s.writer });
          if (o.meta && !sameDigests(o.meta.digests, meta.digests)) {
            if (!s.writer) return { cache: false, writer: false, present: [], why: "digests differ" };
            await arm.close();
            await arm.evict(series);
            continue;
          }
          s.cache = true;
          return { cache: true, writer: s.writer, present: o.present };
        } catch (e) {
          const room = e.name === "QuotaExceededError" && s.writer && (await s.evictOne(meta.digests.length * meta.frameBytes));
          if (!room) return { cache: false, writer: s.writer, present: [], why: e.name ?? String(e) };
        }
      }
    },

    /** The frame in `slot`; the store's hold on the slot is let go once written, or earlier by the arm's `release`. */
    async write(i, slot) {
      let held = true;
      const release = () => {
        if (held && mutant !== "slot-held") ring.release(slot);
        held = false;
        s.pending.delete(i);
      };
      try {
        if (!s.cache || s.stopped || (!s.writer && mutant !== "tab-writes")) return { written: false };
        s.writes++;
        if (mutant === "drop-writes") return { written: true };
        s.pending.set(i, slot);
        for (let retried = false; ; retried = true) {
          try {
            await arm.write(i, ring.bytes(slot, s.meta.frameBytes), { release, readsWaiting: ring.readsWaiting, serveReads });
            return { written: true };
          } catch (e) {
            const room = !retried && e.name === "QuotaExceededError" && (await s.evictOne(s.meta.frameBytes));
            if (!room) return (s.stopped = true), { written: false, why: e.name ?? String(e) };
          }
        }
      } finally {
        s.pending.delete(i);
        release();
      }
    },

    /** Frame i into `into`, re-checked. A frame still pending is copied from its slot (§8.1). */
    async read(i, into) {
      if (!s.cache) return { hit: false };
      const pendingSlot = s.pending.get(i);
      if (pendingSlot !== undefined) into.set(ring.bytes(pendingSlot, into.length));
      else {
        try {
          if (!(await arm.read(i, into))) return { hit: false };
        } catch (e) {
          return { hit: false, why: e.name ?? String(e) };
        }
      }
      if (mutant === "no-recheck" || check(into, i)) return { hit: true, fromPending: pendingSlot !== undefined };
      // In a reading tab the writer may be mid-frame: a miss, never a damaged frame (§8.1).
      if (!s.writer) return { hit: false };
      await arm.drop(i).catch(() => {});
      return { hit: false, damaged: true };
    },

    /** One series out, never `s.series` nor one open in any tab; then a bounded wait for `need` bytes of room. */
    async evictOne(need) {
      const open = new Set((await locks.names()).filter((n) => n.startsWith(`${LOCK} open `)).map((n) => n.slice(LOCK.length + 6)));
      const candidates = (await arm.list()).filter((x) => x.series !== s.series && !open.has(x.series)).sort((a, b) => a.lastOpen - b.lastOpen);
      const victim = mutant === "evict-newest" ? candidates.at(-1) : candidates[0];
      if (!victim) return false;
      await arm.evict(victim.series);
      s.evicted.push(victim.series);
      for (const t0 = performance.now(); estimate && performance.now() - t0 < waitMs; await sleep(20)) {
        const e = await estimate();
        if (e.quota - e.usage >= need) break;
      }
      return true;
    },

    /** Every write the arm took settles: a frame it could not keep (a late refusal) is lost and stops the fill (§7.5). */
    async settle() {
      const lost = s.cache && arm.settle ? await arm.settle() : [];
      if (lost.length) (s.stopped = true), s.lost.push(...lost);
      return lost;
    },

    async close() {
      if (s.cache) {
        try {
          await arm.close();
        } catch (e) {
          s.stopped = true;
          s.lost.push(...(e.lost ?? []));
          s.lateRefusal = e.name ?? String(e);
        }
      }
      s.cache = false;
      for (const letGo of s.letGo.splice(0)) letGo();
    },
  };
  return s;
}

/** The origin's Web Locks in the shape `store` takes. */
export const webLocks = (locks = navigator.locks) => ({
  hold: (name, opts = {}) => new Promise((resolve) => {
    locks.request(name, opts, (lock) => (lock ? new Promise((letGo) => resolve(letGo)) : resolve(null)));
  }),
  names: async () => (await locks.query()).held.map((l) => l.name),
});
