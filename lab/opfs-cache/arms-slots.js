// M5's slot table, shared by the view and the decoders: a state and a take count a slot, then a count of frees.
export const FREE = 0;
export const DECODING = 1;
export const HELD = 2;

export const tableBytes = (count) => (2 * count + 1) * 4;

export function slotsOf(table) {
  const t = new Int32Array(table);
  const count = (t.length - 1) / 2;
  const freed = 2 * count;
  const inState = (state) => [...Array(count).keys()].filter((s) => Atomics.load(t, s) === state).length;
  return {
    count,
    inState,
    anyFree: () => inState(FREE) > 0,
    claim: (s, as) => Atomics.compareExchange(t, s, FREE, as) === FREE,
    /** The take count after this take: a holder compares it before and after a read, a double free showing as a change. */
    taken: (s) => Atomics.add(t, count + s, 1) + 1,
    takeOf: (s) => Atomics.load(t, count + s),
    hold: (s) => Atomics.store(t, s, HELD),
    free(s) {
      Atomics.store(t, s, FREE);
      Atomics.add(t, freed, 1);
      Atomics.notify(t, freed);
    },
    freedCount: () => Atomics.load(t, freed),
    waitFree: (seen) => Atomics.wait(t, freed, seen, 1000),
  };
}
