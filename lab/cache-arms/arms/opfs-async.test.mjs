// node lab/cache-arms/arms/opfs-async.test.mjs — OPFS-ASYNC (cache-plan.md §7.2, its rows of §7.5) against an OPFS
// kept in memory whose writables keep a swap committed at close, take their chunk's bytes late, and refuse on demand.
import { opfsAsync } from "./opfs-async.js";

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
const settle = async () => { for (let k = 0; k < 20; k++) await tick(); };

const FRAME = 2 ** 19;
const SLOT = FRAME + 28;
const N = 6;
const made = new Map();
const pattern = (i) => made.get(i) ?? made.set(i, Uint8Array.from({ length: FRAME }, (_, k) => (i * 31 + k) & 0xff)).get(i);
const frame = (i) => {
  const b = new Uint8Array(new SharedArrayBuffer(FRAME));
  b.set(pattern(i));
  return b;
};
const meta = (n = N) => ({ digests: [...Array(n).keys()].map(String), frameBytes: FRAME, shape: [32, 64] });
const pilot = (s) => new URLSearchParams(s);
const GROUPED = pilot("group=8MiB");
const G = Math.floor((8 * 2 ** 20) / SLOT);

/** One origin's OPFS. A writable writes into its own swap, which replaces the file at close; a chunk's bytes are copied
 *  when its write runs, a tick after the call, as fs 1213 and 1239 queue it. */
class Disk {
  quota = Infinity;
  refusal = "QuotaExceededError";
  writeRefusals = 0;
  closeRefusals = 0;
  gone = false;
  files = new Set();
  swaps = new Set();
  inFlight = 0;
  maxInFlight = 0;
  writesDone = 0;
  root = this.dir();
  used = () => [...this.files, ...this.swaps].reduce((s, f) => s + f.bytes.length, 0);
  alive() {
    if (this.gone) throw failure("NotFoundError");
  }
  async op(run) {
    this.maxInFlight = Math.max(this.maxInFlight, ++this.inFlight);
    try {
      await tick();
      return run();
    } finally {
      this.inFlight--;
    }
  }
  dir() {
    const disk = this;
    const entries = new Map();
    const forget = (e) => (e.kind === "file" ? disk.files.delete(e.data) : [...e.all()].forEach(forget));
    return {
      kind: "directory",
      all: () => entries.values(),
      names: () => [...entries.keys()],
      entries: async function* () {
        yield* [...entries];
      },
      async getDirectoryHandle(name, { create } = {}) {
        disk.alive();
        if (!entries.has(name) && create) entries.set(name, disk.dir());
        if (entries.get(name)?.kind !== "directory") throw failure("NotFoundError");
        return entries.get(name);
      },
      async getFileHandle(name, { create } = {}) {
        disk.alive();
        if (!entries.has(name) && create) entries.set(name, disk.file());
        if (entries.get(name)?.kind !== "file") throw failure("NotFoundError");
        return entries.get(name);
      },
      async removeEntry(name) {
        disk.alive();
        if (!entries.has(name)) throw failure("NotFoundError");
        forget(entries.get(name));
        entries.delete(name);
      },
    };
  }
  file() {
    const disk = this;
    const data = { bytes: new Uint8Array(0), locked: false, writers: 0 };
    disk.files.add(data);
    const room = (swap, n) => {
      if (n > swap.bytes.length && disk.used() - swap.bytes.length + n > disk.quota) throw failure(disk.refusal);
    };
    const resize = (swap, n) => {
      const b = new Uint8Array(n);
      b.set(swap.bytes.subarray(0, Math.min(n, swap.bytes.length)));
      swap.bytes = b;
    };
    return {
      kind: "file",
      data,
      getFile: async () => {
        disk.alive();
        const snapshot = data.bytes.slice();
        return {
          size: snapshot.length,
          arrayBuffer: async () => snapshot.slice().buffer,
          text: async () => new TextDecoder().decode(snapshot),
          slice: (a, b) => ({ arrayBuffer: async () => snapshot.slice(a, b).buffer }),
        };
      },
      async createWritable({ keepExistingData = false } = {}) {
        disk.alive();
        if (data.locked) throw failure("NoModificationAllowedError");
        const swap = { bytes: keepExistingData ? data.bytes.slice() : new Uint8Array(0) };
        disk.swaps.add(swap);
        data.writers++;
        const end = () => (disk.swaps.delete(swap), data.writers--);
        return {
          write(chunk) {
            const plain = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
            const { position = swap.bytes.length, data: view } = plain instanceof Uint8Array ? { data: plain } : plain;
            // BufferSource is not [AllowShared]: a view of shared memory is refused (fs 1103–1107).
            if (view.buffer instanceof SharedArrayBuffer) return Promise.reject(new TypeError("shared memory"));
            return disk.op(() => {
              disk.alive();
              if (disk.writeRefusals && disk.writeRefusals--) throw failure(disk.refusal);
              room(swap, position + view.byteLength);
              if (position + view.byteLength > swap.bytes.length) resize(swap, position + view.byteLength);
              swap.bytes.set(view, position);
              disk.writesDone++;
            });
          },
          truncate: (n) => disk.op(() => (room(swap, n), resize(swap, n))),
          close: () => disk.op(() => {
            if (disk.closeRefusals && disk.closeRefusals--) throw failure(disk.refusal);
            data.bytes = swap.bytes;
            end();
          }),
          abort: async () => end(),
        };
      },
      async createSyncAccessHandle() {
        disk.alive();
        if (data.locked || data.writers) throw failure("NoModificationAllowedError");
        data.locked = true;
        return {
          getSize: () => data.bytes.length,
          read(view, { at }) {
            disk.alive();
            const src = data.bytes.subarray(at, at + view.byteLength);
            new Uint8Array(view.buffer, view.byteOffset, src.length).set(src);
            return src.length;
          },
          close: () => (data.locked = false),
        };
      },
    };
  }
}

let disk = new Disk();
let clock = 0;
Date.now = () => ++clock;
Object.defineProperty(globalThis, "navigator", { value: { storage: { getDirectory: async () => disk.root } }, configurable: true });
const fresh = () => (disk = new Disk());
const seriesDir = async (series) => (await disk.root.getDirectoryHandle("cache-arms")).getDirectoryHandle(encodeURIComponent(series));
const names = async (series) => (await seriesDir(series)).names().sort();
const groupFile = async (series, k) => (await (await seriesDir(series)).getFileHandle(String(k))).data.bytes;
const exact = (into, i) => {
  const p = pattern(i);
  return into.length === p.length && into.every((b, k) => b === p[k]);
};
const slotView = () => new Uint8Array(new SharedArrayBuffer(FRAME));

/** A new series: nothing present; the probe was taken and aborted, so only the meta is left and no swap holds quota. */
{
  fresh();
  const a = opfsAsync();
  const o = await a.open("A", meta(), { create: true });
  check(o.present.length === 0 && o.meta === null, "a new series: nothing present, no stored meta");
  check((await names("A")).join() === "meta.json" && disk.swaps.size === 0, "the probe leaves nothing behind");
}

/** A frame is copied out of its slot (the writable refuses shared memory), the slot let go before its write runs, and
 *  with G = 1 its file is the frame then its 7-int trailer, committed at close; read back exact by both reads. */
for (const read of ["file", "sync"]) {
  fresh();
  const a = opfsAsync(pilot(`read=${read}`));
  await a.open("A", meta(), { create: true });
  disk.writesDone = 0;
  let releasedAfter = null;
  await a.write(2, frame(2), { release: () => (releasedAfter = disk.writesDone) });
  check(releasedAfter === 0, `${read}: the slot let go once copied, before the write runs`);
  await a.close();
  const bytes = await groupFile("A", 2);
  check(bytes.length === SLOT && exact(bytes.subarray(0, FRAME), 2), `${read}: group 2 holds frame 2 alone`);
  const trailer = new Int32Array(bytes.slice(FRAME).buffer);
  check(trailer.join() === "0,0,32,64,16,1,0", `${read}: the trailer is frame-file.js's 7 ints`);
  const b = opfsAsync(pilot(`read=${read}`));
  await b.open("A", meta(), { create: true });
  const into = slotView();
  check((await b.read(2, into)) && exact(into, 2), `${read}: read back exact from its file`);
  check(!(await b.read(3, into)), `${read}: a frame never written is a miss`);
}

/** A group of G frames is one file, absent until its last frame's write and its close; until then each frame is read
 *  from the arm's own copy, which no later frame overwrites. */
{
  fresh();
  const a = opfsAsync(GROUPED);
  const n = G + 2;
  await a.open("A", meta(n), { create: true });
  const into = slotView();
  for (let i = 0; i < G - 1; i++) await a.write(i, frame(i), {});
  await settle();
  check(!(await names("A")).includes("0") || (await groupFile("A", 0)).length === 0, "an open group: nothing committed");
  let held = true;
  for (let i = 0; i < G - 1; i++) held &&= (await a.read(i, into)) && exact(into, i);
  check(held, "an open group's frames read exact from the arm's copies");
  await a.write(G - 1, frame(G - 1), {});
  await a.write(G, frame(G), {});
  await settle();
  check((await groupFile("A", 0)).length === G * SLOT, "the group commits whole once its last frame is written");
  let fromFile = true;
  for (let i = 0; i < G; i++) fromFile &&= (await a.read(i, into)) && exact(into, i);
  check(fromFile, "a committed group's frames read exact from its file");
  check((await a.read(G, into)) && exact(into, G), "the next group's first frame read from its copy");
}

/** Writes and closes in flight are bounded by the pilot's k, and k is reached. */
for (const k of [1, 3]) {
  fresh();
  const a = opfsAsync(pilot(`inflight=${k}`));
  await a.open("A", meta(12), { create: true });
  disk.maxInFlight = 0;
  for (let i = 0; i < 12; i++) await a.write(i, frame(i), {});
  await a.close();
  check(disk.maxInFlight === k, `inflight=${k}: at most and at least ${k} in flight (saw ${disk.maxInFlight})`);
}

/** A frame handed twice to an open group counts once: the group does not close short of a frame. */
{
  fresh();
  const a = opfsAsync(GROUPED);
  await a.open("A", meta(G), { create: true });
  await a.write(0, frame(0), {});
  for (let i = 0; i < G - 1; i++) await a.write(i, frame(i), {});
  await settle();
  check((await groupFile("A", 0)).length === 0, "a repeated frame does not complete the group");
  await a.write(G - 1, frame(G - 1), {});
  await a.close();
  check((await groupFile("A", 0)).length === G * SLOT, "the last distinct frame does");
}

/** A reopen finds the frames of whole group files; a group left open at close, even one with its last frame and a gap
 *  before it, is not on disk, and any other name in the series' directory (a stale swap, a short group) is removed. */
{
  fresh();
  const a = opfsAsync(GROUPED);
  await a.open("A", meta(G + 3), { create: true });
  for (const i of [...Array(G).keys(), G, G + 2]) await a.write(i, frame(i), {});
  await a.close();
  check((await groupFile("A", 1)).length === 0, "a group with a gap is aborted at close, never committed");
  const dir = await seriesDir("A");
  (await dir.getFileHandle("1.crswap", { create: true })).data.bytes = new Uint8Array(10);
  (await dir.getFileHandle("1", { create: true })).data.bytes = new Uint8Array(SLOT);
  const b = opfsAsync(GROUPED);
  const o = await b.open("A", meta(G + 3), { create: true });
  check(o.present.length === G && o.present.at(-1) === G - 1, "present after reopen: the whole group only");
  check(o.meta?.frameBytes === FRAME && o.meta.lastOpen > 0, "the stored meta comes back");
  check((await names("A")).join() === "0,meta.json", "the stale swap and the short group removed");
}

/** A reading tab misses a frame of a group the writer has open: its file is there, empty, until the close. */
{
  fresh();
  const a = opfsAsync(GROUPED);
  await a.open("A", meta(G), { create: true });
  for (let i = 0; i < 3; i++) await a.write(i, frame(i), {});
  await settle();
  const b = opfsAsync(GROUPED);
  await b.open("A", meta(G), { create: false });
  check(!(await b.read(1, slotView())), "the reading tab: a frame of an open group is a miss");
}

/** §7.5 no store: getDirectory() rejects, and so does open. */
{
  fresh();
  disk.gone = true;
  check((await rejects(opfsAsync().open("A", meta(), { create: true }))) !== null, "no store: open rejects");
}

/** §7.5 does not fit: the probe's truncate is refused as QuotaExceededError, Gecko's name too, nothing left behind. */
for (const refusal of ["QuotaExceededError", "NS_ERROR_FILE_NO_DEVICE_SPACE"]) {
  fresh();
  disk.quota = N * FRAME;
  disk.refusal = refusal;
  const a = opfsAsync();
  const e = await rejects(a.open("A", meta(), { create: true }));
  check(e?.name === "QuotaExceededError", `does not fit (${refusal}): QuotaExceededError`);
  check((await a.list()).length === 0 && disk.files.size === 0 && disk.swaps.size === 0, `does not fit (${refusal}): nothing left`);
  disk.quota = Infinity;
  check((await opfsAsync().open("A", meta(), { create: true })).present.length === 0, `does not fit (${refusal}): a retry with room opens`);
}

/** Only a new series is probed: a reopen with no room left opens and reads what is present (cell Q's reopen). */
{
  fresh();
  const a = opfsAsync();
  await a.open("A", meta(), { create: true });
  for (let i = 0; i < N - 1; i++) await a.write(i, frame(i), {});
  await a.close();
  disk.quota = disk.used() + 4096;
  const b = opfsAsync();
  check((await b.open("A", meta(), { create: true })).present.length === N - 1, "a reopen with no room: present as written");
  const into = slotView();
  check((await b.read(0, into)) && exact(into, 0), "a reopen with no room: read exact");
}

/** §7.5 the disk fills mid-fill: a write or a close refused after its call returned is thrown by the next write as
 *  QuotaExceededError; the store's retry writes that group again from the arm's copies, and every frame lands. */
for (const lever of ["writeRefusals", "closeRefusals"]) for (const refusal of ["QuotaExceededError", "NS_ERROR_FILE_NO_DEVICE_SPACE"]) {
  fresh();
  const a = opfsAsync();
  await a.open("A", meta(), { create: true });
  disk.refusal = refusal;
  disk[lever] = 1;
  await a.write(0, frame(0), {});
  await settle();
  check((await rejects(a.write(1, frame(1), {})))?.name === "QuotaExceededError", `${lever} (${refusal}): the next write throws`);
  const into = slotView();
  check((await a.read(0, into)) && exact(into, 0), `${lever} (${refusal}): the refused frame still read from its copy`);
  await a.write(1, frame(1), {});
  await a.close();
  const o = await opfsAsync().open("A", meta(), { create: true });
  check(o.present.join() === "0,1", `${lever} (${refusal}): the retry lands both frames`);
}

/** §7.5 the origin emptied between opens: no meta, a fresh fill. */
{
  fresh();
  const a = opfsAsync();
  await a.open("A", meta(), { create: true });
  await a.write(0, frame(0), {});
  await a.close();
  fresh();
  const o = await opfsAsync().open("A", meta(), { create: true });
  check(o.present.length === 0 && o.meta === null, "emptied: nothing present, no meta");
}

/** §7.5 the store vanishes while open: a read of a committed frame is a miss, or throws (a miss by the store's rule). */
for (const read of ["file", "sync"]) {
  fresh();
  const a = opfsAsync(pilot(`read=${read}`));
  await a.open("A", meta(), { create: true });
  await a.write(0, frame(0), {});
  await settle();
  disk.gone = true;
  const into = slotView();
  const got = await a.read(0, into).catch(() => "threw");
  check((got === false || got === "threw") && into.every((b) => b === 0), `vanished (${read}): a miss, nothing read`);
}

/** §7.5 two tabs, §8.1: the second tab reads what is present, removes nothing, and writes nothing. */
{
  fresh();
  const a = opfsAsync();
  await a.open("A", meta(), { create: true });
  await a.write(0, frame(0), {});
  await settle();
  const b = opfsAsync();
  const o = await b.open("A", meta(), { create: false });
  check(o.present.join() === "0" && o.meta !== null, "the reading tab sees what is present");
  const into = slotView();
  check((await b.read(0, into)) && exact(into, 0), "the reading tab reads it exact");
  check(!(await b.read(1, into)), "the reading tab misses an absent frame");
  check((await rejects(b.write(1, frame(1), {}))) !== null, "the reading tab cannot write");
  await b.drop(0);
  check(await a.read(0, into), "the reading tab's drop changes nothing");
  check((await opfsAsync().open("B", meta(), { create: false })).present.length === 0, "a reading tab on an absent series: nothing");
}

/** §7.5 a damaged frame: the lever changes one byte through a writable; the drop removes its group's file. */
{
  fresh();
  const a = opfsAsync(GROUPED);
  await a.open("A", meta(G), { create: true });
  for (let i = 0; i < G; i++) await a.write(i, frame(i), {});
  await settle();
  await a.damage(3);
  const into = slotView();
  check((await a.read(3, into)) && !exact(into, 3) && into.filter((b, k) => b !== pattern(3)[k]).length === 1, "damaged: one byte off");
  check((await a.read(4, into)) && exact(into, 4), "damaged: its neighbours untouched");
  await a.drop(3);
  check(!(await a.read(3, into)) && !(await a.read(4, into)), "dropped: its whole group a miss");
}

/** Eviction removes a series; list names each with its last open. */
{
  fresh();
  const a = opfsAsync();
  await a.open("A", meta(), { create: true });
  await a.close();
  await opfsAsync().open("B", meta(), { create: true });
  const l = await a.list();
  check(l.length === 2 && l.find((x) => x.series === "A").lastOpen < l.find((x) => x.series === "B").lastOpen, "list: both, by last open");
  await a.evict("A");
  check((await a.list()).map((x) => x.series).join() === "B", "evicted: A gone");
}

/** The floor: count writables each written whole and closed, then count reads; its file removed after. */
for (const read of ["file", "sync"]) {
  fresh();
  const a = opfsAsync(pilot(`read=${read}`));
  const into = slotView();
  const f = await a.floor(frame(1), into, 5);
  check(f.writeMs.length === 5 && f.readMs.length === 5, `floor (${read}): five each way`);
  check(disk.writesDone === 5 && exact(into, 1), `floor (${read}): five writes, the frame read back`);
  check(disk.files.size === 0 && disk.swaps.size === 0, `floor (${read}): its file removed`);
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("cache-arms: OPFS-ASYNC holds its design and its failure rows");
