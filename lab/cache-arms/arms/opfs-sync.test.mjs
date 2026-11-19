// node lab/cache-arms/arms/opfs-sync.test.mjs — OPFS-SYNC (cache-plan.md §7.1, its rows of §7.5) against an OPFS
// kept in memory, whose quota, refusal names, locks and vanishing are the test's levers.
import { opfsSync } from "./opfs-sync.js";

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const failure = (name) => Object.assign(new Error(name), { name });
const rejects = async (p) => p.then(() => null, (e) => e);

const FRAME = 4096;
const N = 6;
const frame = (i) => {
  const b = new Uint8Array(new SharedArrayBuffer(FRAME));
  for (let k = 0; k < FRAME; k++) b[k] = (i * 31 + k) & 0xff;
  return b;
};
const meta = (n = N) => ({ digests: [...Array(n).keys()].map(String), frameBytes: FRAME, shape: [32, 64] });

/** One origin's OPFS. Every handle's write is logged with its buffer, offset and length. */
class Disk {
  quota = Infinity;
  refusal = "QuotaExceededError";
  writeRefusals = 0;
  shortWrites = 0;
  gone = false;
  files = new Set();
  log = [];
  root = this.dir();
  used = () => [...this.files].reduce((s, f) => s + f.bytes.length, 0);
  alive() {
    if (this.gone) throw failure("NotFoundError");
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
        const locked = (e) => (e.kind === "file" ? e.data.locked : [...e.all()].some(locked));
        // As Chromium refuses it: no removal under any handle (cache-plan.md §7.1, eviction).
        if (locked(entries.get(name))) throw failure("NoModificationAllowedError");
        forget(entries.get(name));
        entries.delete(name);
      },
    };
  }
  file() {
    const disk = this;
    const data = { bytes: new Uint8Array(0), locked: false };
    disk.files.add(data);
    const grow = (n) => {
      if (n <= data.bytes.length) return;
      if (disk.used() - data.bytes.length + n > disk.quota) throw failure(disk.refusal);
      const b = new Uint8Array(n);
      b.set(data.bytes);
      data.bytes = b;
    };
    return {
      kind: "file",
      data,
      getFile: async () => {
        disk.alive();
        const snapshot = data.bytes.slice();
        return {
          text: async () => new TextDecoder().decode(snapshot),
          slice: (a, b) => ({ arrayBuffer: async () => snapshot.slice(a, b).buffer }),
        };
      },
      async createSyncAccessHandle() {
        disk.alive();
        if (data.locked) throw failure("NoModificationAllowedError");
        data.locked = true;
        return {
          read(view, { at }) {
            disk.alive();
            const src = data.bytes.subarray(at, at + view.byteLength);
            new Uint8Array(view.buffer, view.byteOffset, src.length).set(src);
            return src.length;
          },
          write(view, { at }) {
            disk.alive();
            if (disk.writeRefusals && disk.writeRefusals--) throw failure(disk.refusal);
            const length = disk.shortWrites && disk.shortWrites-- ? view.byteLength >> 1 : view.byteLength;
            disk.log.push({ buffer: view.buffer, at, length });
            grow(at + length);
            data.bytes.set(new Uint8Array(view.buffer, view.byteOffset, length), at);
            return length;
          },
          truncate(n) {
            disk.alive();
            if (n > data.bytes.length) grow(n);
            else data.bytes = data.bytes.slice(0, n);
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
const seriesFile = async (series) => (await (await (await disk.root.getDirectoryHandle("cache-arms")).getDirectoryHandle(encodeURIComponent(series))).getFileHandle("frames")).data;
const exact = (into, i) => into.every((b, k) => b === frame(i)[k]);

/** A new series is sized at open, to its frames and their records, before any frame is written. */
{
  fresh();
  const a = opfsSync();
  const o = await a.open("A", meta(), { create: true });
  check(o.present.length === 0 && o.meta === null, "a new series: nothing present, no stored meta");
  check((await seriesFile("A")).bytes.length === N * (FRAME + 12), "sized at open: n × (frameBytes + 12)");
}

/** A frame is written from its slot itself, no copy in script, and read back exact; absent frames are misses. */
{
  fresh();
  const a = opfsSync();
  await a.open("A", meta(), { create: true });
  const f = frame(2);
  disk.log.length = 0;
  await a.write(2, f, {});
  check(disk.log[0].buffer === f.buffer && disk.log[0].at === 2 * FRAME && disk.log[0].length === FRAME, "the slot's own buffer, at i × frameBytes, whole");
  const into = new Uint8Array(new SharedArrayBuffer(FRAME));
  check((await a.read(2, into)) && exact(into, 2), "read back exact");
  check(!(await a.read(3, into)), "a frame never written is a miss");
}

/** In pieces, waiting reads are let in between them, and the record is written after the last piece only. */
{
  fresh();
  const a = opfsSync(new URLSearchParams("piece=1024"));
  await a.open("A", meta(), { create: true });
  let waiting = 2;
  const served = [];
  const order = [];
  const ctx = { readsWaiting: () => waiting, serveReads: async () => (served.push(disk.log.length), (waiting = 0)) };
  disk.log.length = 0;
  const writing = a.write(1, frame(1), ctx);
  await writing;
  for (const w of disk.log) order.push(w.at);
  check(disk.log.slice(0, 4).every((w, k) => w.length === 1024 && w.at === FRAME + k * 1024), "four pieces of 1 024 bytes, in order");
  check(served.length === 1 && served[0] === 1, "the waiting reads let in after the first piece, once");
  check(order.at(-1) === N * FRAME + 12 && order.length === 5, "the record after the last piece");
  disk.log.length = 0;
  await a.write(3, frame(3), { readsWaiting: () => 0, serveReads: async () => check(false, "no read waiting: none let in") });
  check(disk.log.length === 5, "four pieces and the record with no read waiting");
}

/** The pilot's piece in the plan's own spelling, `2MiB` or `1KiB`, is that many bytes; a misspelt one refuses to
 *  start, never falls back to whole frames (review, OPFS-SYNC M2). */
{
  fresh();
  const a = opfsSync(new URLSearchParams("piece=1KiB"));
  await a.open("A", meta(), { create: true });
  disk.log.length = 0;
  await a.write(1, frame(1), { readsWaiting: () => 0, serveReads: async () => {} });
  check(disk.log.slice(0, 4).every((w) => w.length === 1024), "piece=1KiB: pieces of 1 024 bytes");
  let threw = null;
  try { opfsSync(new URLSearchParams("piece=2MB")); } catch (e) { threw = e; }
  check(threw !== null, "piece=2MB: refused");
}

/** A reopen finds what was written, not what was dropped, and the stored meta with a later last open. */
{
  fresh();
  const a = opfsSync();
  await a.open("A", meta(), { create: true });
  for (const i of [0, 2, 4]) await a.write(i, frame(i), {});
  await a.drop(2);
  await a.close();
  const b = opfsSync();
  const o = await b.open("A", meta(), { create: true });
  check(o.present.join() === "0,4", "present after reopen: written, less dropped");
  check(o.meta?.frameBytes === FRAME && o.meta.lastOpen > 0, "the stored meta comes back");
  const into = new Uint8Array(new SharedArrayBuffer(FRAME));
  check((await b.read(4, into)) && exact(into, 4), "a frame read back after reopen");
  check((await seriesFile("A")).bytes.length === N * (FRAME + 12), "a reopen does not resize");
}

/** §7.5 no store: getDirectory() rejects, and so does open. */
{
  fresh();
  const a = opfsSync();
  disk.gone = true;
  check((await rejects(a.open("A", meta(), { create: true }))) !== null, "no store: open rejects");
}

/** §7.5 does not fit: the truncate at open is refused as QuotaExceededError, Gecko's name too, nothing left behind. */
for (const refusal of ["QuotaExceededError", "NS_ERROR_FILE_NO_DEVICE_SPACE"]) {
  fresh();
  disk.quota = N * FRAME;
  disk.refusal = refusal;
  const a = opfsSync();
  const e = await rejects(a.open("A", meta(), { create: true }));
  check(e?.name === "QuotaExceededError", `does not fit (${refusal}): QuotaExceededError`);
  check((await a.list()).length === 0 && disk.files.size === 0, `does not fit (${refusal}): nothing left on disk`);
  disk.quota = Infinity;
  check((await opfsSync().open("A", meta(), { create: true })).present.length === 0, `does not fit (${refusal}): a retry with room opens`);
}

/** §7.5 the disk fills mid-fill: a refused write throws QuotaExceededError, and no record says the frame is there. */
for (const refusal of ["QuotaExceededError", "NS_ERROR_FILE_NO_DEVICE_SPACE"]) {
  fresh();
  const a = opfsSync();
  await a.open("A", meta(), { create: true });
  disk.refusal = refusal;
  disk.writeRefusals = 1;
  check((await rejects(a.write(1, frame(1), {})))?.name === "QuotaExceededError", `mid-fill (${refusal}): QuotaExceededError`);
  check(!(await a.read(1, new Uint8Array(new SharedArrayBuffer(FRAME)))), `mid-fill (${refusal}): the frame is not present`);
  await a.write(1, frame(1), {});
  check(await a.read(1, new Uint8Array(new SharedArrayBuffer(FRAME))), `mid-fill (${refusal}): the retry writes it`);
}

/** A short write throws, and leaves no record saying the frame is there. */
{
  fresh();
  const a = opfsSync();
  await a.open("A", meta(), { create: true });
  disk.shortWrites = 1;
  check((await rejects(a.write(1, frame(1), {}))) !== null, "a short write throws");
  check(!(await a.read(1, new Uint8Array(new SharedArrayBuffer(FRAME)))), "a short write: the frame is not present");
}

/** §7.5 the origin emptied between opens: no meta, a fresh fill. */
{
  fresh();
  const a = opfsSync();
  await a.open("A", meta(), { create: true });
  await a.write(0, frame(0), {});
  await a.close();
  fresh();
  const o = await opfsSync().open("A", meta(), { create: true });
  check(o.present.length === 0 && o.meta === null, "emptied: nothing present, no meta");
}

/** §7.5 the store vanishes while open: a read throws (the store's rule makes it a miss), never a wrong frame. */
{
  fresh();
  const a = opfsSync();
  await a.open("A", meta(), { create: true });
  await a.write(0, frame(0), {});
  disk.gone = true;
  check((await rejects(a.read(0, new Uint8Array(new SharedArrayBuffer(FRAME))))) !== null, "vanished: the read throws");
}

/** §7.5 two tabs, §8.1: the second tab takes no handle, reads what is present by getFile(), and has nothing to write with. */
{
  fresh();
  const a = opfsSync();
  await a.open("A", meta(), { create: true });
  await a.write(0, frame(0), {});
  const b = opfsSync();
  const o = await b.open("A", meta(), { create: false });
  check(o.present.join() === "0" && o.meta !== null, "the reading tab sees what is present, beside the writer's handle");
  const into = new Uint8Array(new SharedArrayBuffer(FRAME));
  check((await b.read(0, into)) && exact(into, 0), "the reading tab reads it exact");
  check(!(await b.read(1, into)), "the reading tab misses an absent frame");
  check((await rejects(b.write(1, frame(1), {}))) !== null, "the reading tab cannot write");
  await b.drop(0);
  check(await a.read(0, into), "the reading tab's drop changes nothing");
  check((await rejects(opfsSync().open("A", meta(), { create: true })))?.name === "NoModificationAllowedError", "a second writer is refused by the lock");
  check((await opfsSync().open("B", meta(), { create: false })).present.length === 0, "a reading tab on an absent series: nothing");
}

/** §7.5 a damaged frame: the lever changes one byte through the handle; the drop then clears its record. */
{
  fresh();
  const a = opfsSync();
  await a.open("A", meta(), { create: true });
  await a.write(3, frame(3), {});
  await a.damage(3);
  const into = new Uint8Array(new SharedArrayBuffer(FRAME));
  check((await a.read(3, into)) && !exact(into, 3), "damaged: read, one byte off");
  await a.drop(3);
  check(!(await a.read(3, into)), "dropped: a miss");
}

/** Eviction removes a series; list names each with its last open. */
{
  fresh();
  const a = opfsSync();
  await a.open("A", meta(), { create: true });
  await a.close();
  await opfsSync().open("B", meta(), { create: true });
  const l = await a.list();
  check(l.length === 2 && l.every((x) => x.lastOpen > 0) && l.find((x) => x.series === "A").lastOpen < l.find((x) => x.series === "B").lastOpen, "list: both, ordered by last open");
  await a.evict("A");
  check((await a.list()).map((x) => x.series).join() === "B", "evicted: A gone");
}

/** The floor: count whole-frame writes then reads on one handle, its file removed after. */
{
  fresh();
  const a = opfsSync();
  disk.log.length = 0;
  const f = await a.floor(frame(1), new Uint8Array(new SharedArrayBuffer(FRAME)), 5);
  check(f.writeMs.length === 5 && f.readMs.length === 5, "the floor: five each way");
  check(disk.log.length === 5 && disk.log.every((w) => w.length === FRAME), "the floor: whole-frame writes only");
  check(disk.files.size === 0, "the floor: its file removed");
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("cache-arms: OPFS-SYNC holds its design and its failure rows");
