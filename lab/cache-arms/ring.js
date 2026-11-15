// M5's ring of slots (claude/core-m5:lab/opfs-cache/arms-slots.js), here with a count of holders a slot: a feeder
// claims a slot for the view and the store, and it is free once both let it go. cache-plan.md §7.0
const FREED = 0;
const READS = 1;

/** Int32 table: [freed, reads waiting, holders of slot 0, …]. */
export function ring(samples, table, slotBytes) {
  const t = new Int32Array(table);
  const count = t.length - 2;
  return {
    count,
    slotBytes,
    samples,
    table,
    /** A free slot now held by `holders`, or −1 with none free. */
    claim(holders) {
      for (let s = 0; s < count; s++) if (Atomics.compareExchange(t, 2 + s, 0, holders) === 0) return s;
      return -1;
    },
    bytes: (s, length = slotBytes) => new Uint8Array(samples, s * slotBytes, length),
    release(s) {
      const before = Atomics.sub(t, 2 + s, 1);
      if (before < 1) throw new Error(`slot ${s} released with no holder`);
      if (before === 1) Atomics.add(t, FREED, 1), Atomics.notify(t, FREED);
    },
    holders: (s) => Atomics.load(t, 2 + s),
    freed: () => Atomics.load(t, FREED),
    /** Waits (a worker only) until a slot is freed after `seen`, at most `ms`. */
    waitFreed: (seen, ms) => Atomics.wait(t, FREED, seen, ms),
    readAsked: () => Atomics.add(t, READS, 1),
    readServed: () => Atomics.sub(t, READS, 1),
    readsWaiting: () => Atomics.load(t, READS),
  };
}
ring.tableBytes = (count) => (count + 2) * 4;
