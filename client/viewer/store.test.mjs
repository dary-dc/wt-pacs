// node client/viewer/store.test.mjs — the store worker against an OPFS held in memory, whose quota, free disk, crashes
// and other tabs' handles are the test's levers. docs/adr/frame-path.md §Proposed: the client cache in OPFS
import { register } from "node:module";

// The hasher is the test's: what it checks is the store's use of a digest, not XXH3 (xxh3.test.mjs).
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) {
  return s.endsWith("/decode/xxh3.js") ? { url: "data:text/javascript,export const hasher = async () => globalThis.fakeHasher;", shortCircuit: true } : next(s, c);
}`)}`);
globalThis.fakeHasher = {
  init() {
    this.h = 0xcbf29ce484222325n;
    return this;
  },
  update(bytes) {
    for (const b of bytes) this.h = BigInt.asUintN(64, (this.h ^ BigInt(b)) * 0x100000001b3n);
    return this;
  },
  digest: () => globalThis.fakeHasher.h.toString(16).padStart(16, "0"),
};
const digest = (bytes) => fakeHasher.init().update(bytes).digest();

const failure = (name) => Object.assign(new Error(name), { name });

/** One origin's OPFS: `quota` bytes, `writeFails` writes refused as a full disk would, `crashAt` the write that dies half done. */
class Disk {
  quota = Infinity;
  writeFails = 0;
  crashAt = 0;
  writes = 0;
  refused = 0;
  dead = false;
  files = new Set();
  root = this.dir();
  used = () => [...this.files].reduce((a, f) => a + f.bytes.length, 0);
  alive() {
    if (this.dead) throw failure("InvalidStateError");
  }
  /** Every tab closed: every handle released. */
  closeAll() {
    for (const f of this.files) f.locked = false;
    this.dead = false;
    this.crashAt = 0;
  }
  dir() {
    const disk = this;
    const entries = new Map();
    return {
      kind: "directory",
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
      // As the spec has it, no lock is taken: only the store's own probe keeps an open series.
      async removeEntry(name) {
        disk.alive();
        const forget = (e) => (e.kind === "file" ? disk.files.delete(e.data) : [...e.all()].forEach(forget));
        forget(entries.get(name));
        entries.delete(name);
      },
      all: () => entries.values(),
    };
  }
  file() {
    const disk = this;
    const data = { bytes: new Uint8Array(0), locked: false };
    disk.files.add(data);
    const grow = (n) => {
      if (n <= data.bytes.length) return;
      if (disk.used() - data.bytes.length + n > disk.quota) throw (disk.refused++, failure("QuotaExceededError"));
      const b = new Uint8Array(n);
      b.set(data.bytes);
      data.bytes = b;
    };
    return {
      kind: "file",
      data,
      getFile: async () => ({ text: async () => new TextDecoder().decode(data.bytes) }),
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
            const src = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
            if (++disk.writes === disk.crashAt) {
              grow(at + src.length);
              data.bytes.set(src.subarray(0, src.length >> 1), at);
              disk.dead = true;
              throw failure("InvalidStateError");
            }
            if (disk.writeFails && disk.writeFails--) throw failure("InvalidModificationError");
            grow(at + src.length);
            data.bytes.set(src, at);
            return src.length;
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

globalThis.onmessage = null;
let disk;
let clock = 0;
Date.now = () => ++clock;
Object.defineProperty(globalThis, "navigator", { value: { storage: { getDirectory: async () => disk.root } }, configurable: true });
const replies = new Map();
let ids = 0;
let tabs = 0;
globalThis.postMessage = (m) => (replies.get(m.id)(m), replies.delete(m.id));

/** A store worker in a new tab of the origin: `(kind, message)` → its reply. */
async function tab() {
  await import(`./store.js?tab=${++tabs}`);
  const handler = globalThis.onmessage;
  return (kind, m = {}) => new Promise((r) => {
    const id = ++ids;
    replies.set(id, r);
    handler({ data: { kind, id, ...m } });
  });
}

const FRAME = 8;
/** Frame i of series `s`: 2 × 2 16-bit samples, its own bytes. */
function frame(s, i, exact = true) {
  const pixels = new SharedArrayBuffer(FRAME);
  new Uint8Array(pixels).forEach((_, k, a) => (a[k] = (s.charCodeAt(0) * 31 + i * 7 + k) & 0xff));
  return { pixels, width: 2, height: 2, bits: 16, components: 1, signed: false, min: i, max: 100 + i, exact };
}
const digestsOf = (s, n) => [...Array(n).keys()].map((i) => digest(new Uint8Array(frame(s, i).pixels)));
const SERIES = FRAME * 3 + 3 * 12;

/** Opens series `s` of `n` frames in a new tab and writes `frames` of it. */
async function opened(s, n, frames = []) {
  const call = await tab();
  const open = await call("open", { key: `https://host/${s}`, digests: digestsOf(s, n) });
  const written = [];
  for (const i of frames) written.push((await call("write", { index: i, info: frame(s, i) })).written);
  return { call, open, written };
}

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const fresh = () => ((disk = new Disk()), disk);

/** Only a frame checked `true` is stored: `false` and `"unchecked"` are refused, and a reopen lists only the true one. */
{
  fresh();
  const { call } = await opened("a", 3);
  const verdicts = [];
  for (const [i, exact] of [[0, true], [1, false], [2, "unchecked"]]) verdicts.push((await call("write", { index: i, info: frame("a", i, exact) })).written);
  check(String(verdicts) === "true,false,false", `written ${verdicts}, not true,false,false`);
  disk.closeAll();
  const { open } = await opened("a", 3);
  check(String(open.present) === "0", `reopened with ${open.present} present, not 0`);
}

/** A reopened series lists what was written and reads it back exact, its range and shape with it, from the store. */
{
  fresh();
  await opened("a", 3, [0, 2]);
  disk.closeAll();
  const { call, open } = await opened("a", 3);
  check(String(open.present) === "0,2", `present ${open.present}, not 0,2`);
  const { info } = await call("read", { index: 2 });
  const want = frame("a", 2);
  check(info && String(new Uint8Array(info.pixels)) === String(new Uint8Array(want.pixels)), "frame 2 read back with other bytes");
  check(info?.min === 2 && info?.max === 102 && info?.width === 2 && info?.bits === 16 && info?.exact === true && info?.path === "store",
    `frame 2's info ${JSON.stringify({ ...info, pixels: undefined })}`);
}

/** A frame damaged on disk fails its re-check on read, loses its record, and a reopen asks for it again. */
{
  fresh();
  await opened("a", 3, [0, 1]);
  const [frames] = [...disk.files].filter((f) => f.bytes.length === SERIES);
  frames.bytes[FRAME + 3] ^= 1;
  disk.closeAll();
  const { call } = await opened("a", 3);
  const r = await call("read", { index: 1 });
  check(!r.info && /digest/.test(r.miss), `a damaged frame 1 read back as ${JSON.stringify(r)}`);
  check((await call("read", { index: 0 })).info, "frame 0, undamaged, did not read back");
  disk.closeAll();
  const { open } = await opened("a", 3);
  check(String(open.present) === "0", `after the damage, present ${open.present}, not 0`);
}

/** Metadata whose digest list differs drops the series whole: nothing of the old list is read against the new. */
{
  fresh();
  await opened("a", 3, [0, 1, 2]);
  disk.closeAll();
  const call = await tab();
  const open = await call("open", { key: "https://host/a", digests: digestsOf("b", 3) });
  check(open.present?.length === 0, `a changed series reopened with ${open.present} present`);
}

/** A refused size evicts the least recently opened series, not open, until it fits; reopening a series makes it recent. */
{
  fresh();
  await opened("a", 3, [0]);
  await opened("b", 3, [0]);
  disk.closeAll();
  await opened("a", 3);
  disk.closeAll();
  disk.quota = disk.used() + SERIES - 1;
  const c = await opened("c", 3, [0]);
  disk.closeAll();
  const left = [];
  for (const s of ["a", "b", "c"]) left.push(`${s}:${(await opened(s, 3)).open.present}`), disk.closeAll();
  check(c.written[0] === true, "series c was not written");
  check(String(left) === "a:0,b:,c:0", `after c: ${left}, not a kept, b evicted, c written`);
}

/** A series open in another tab is never evicted, however old: the next oldest goes instead. */
{
  fresh();
  await opened("a", 3, [0]);
  disk.closeAll();
  await opened("b", 3, [0]);
  disk.closeAll();
  [...disk.files].find((f) => f.bytes.length === SERIES).locked = true;
  disk.quota = disk.used() + SERIES - 1;
  const c = await opened("c", 3, [0]);
  disk.closeAll();
  const a = (await opened("a", 3)).open.present;
  disk.closeAll();
  const b = (await opened("b", 3)).open.present;
  check(c.written[0] === true && String(a) === "0" && b.length === 0, `c written ${c.written}, a, held, present ${a}, b present ${b}`);
}

/** A series bigger than the store is kept nowhere: nothing written, no byte on disk, and its size not asked again. */
{
  fresh().quota = SERIES - 1;
  const { written, call } = await opened("a", 3, [0, 1]);
  check(String(written) === "false,false", `written ${written}`);
  check(disk.used() === 0, `${disk.used()} bytes left on disk`);
  check(disk.writes === 0 && disk.refused === 1, `${disk.writes} writes tried, ${disk.refused} sizes refused`);
  check(!(await call("read", { index: 0 })).info, "a frame read back from nowhere");
}

/** A write the disk refuses evicts one series and is tried once more; with nothing to evict the series stops, and what it wrote stays. */
{
  fresh();
  await opened("a", 3, [0]);
  disk.closeAll();
  const b = await opened("b", 3, [0]);
  disk.writeFails = 1;
  const retried = (await b.call("write", { index: 1, info: frame("b", 1) })).written;
  disk.writeFails = 1;
  const stopped = (await b.call("write", { index: 2, info: frame("b", 2) })).written;
  const after = (await b.call("write", { index: 2, info: frame("b", 2) })).written;
  disk.closeAll();
  const a = (await opened("a", 3)).open.present;
  disk.closeAll();
  const left = (await opened("b", 3)).open.present;
  check(retried === true && a.length === 0, `after the first refusal: written ${retried}, a present ${a}`);
  check(stopped === false && after === false && String(left) === "0,1", `after the second: written ${stopped}, then ${after}, b present ${left}`);
}

/** A crash at any write, torn half way, leaves the series absent or readable: every frame a reopen lists reads back exact. */
for (let k = 1; k <= 7; k++) {
  fresh().crashAt = k;
  await opened("a", 3, [0, 1, 2]).catch(() => {});
  disk.closeAll();
  const { call, open } = await opened("a", 3);
  for (const i of open.present ?? []) {
    const r = await call("read", { index: i });
    check(r.info && String(new Uint8Array(r.info.pixels)) === String(new Uint8Array(frame("a", i).pixels)), `crash at write ${k}: frame ${i} listed but read ${JSON.stringify(r)}`);
  }
  check(open.present, `crash at write ${k}: reopen failed ${JSON.stringify(open)}`);
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("store: verified frames only, re-checked on read, evicted least recently opened and never open, quota and crash safe");
