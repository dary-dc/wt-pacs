// OPFS-ASYNC: a file per group of G frames by createWritable, each frame copied out of its slot. cache-plan.md §7.2;
// how this build departs from it, README.md §OPFS-ASYNC.
const TRAILER_BYTES = 28;
const GROUP_BYTES = 8 * 2 ** 20;
const root = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("cache-arms", { create: true });
const key = (series) => encodeURIComponent(series);
const quotaError = (e) => (e?.name === "NS_ERROR_FILE_NO_DEVICE_SPACE" ? Object.assign(new Error(e.message), { name: "QuotaExceededError" }) : e);
const readMeta = async (dir) => JSON.parse(await (await (await dir.getFileHandle("meta.json")).getFile()).text());
const ignore = () => {};

async function writeMeta(dir, meta) {
  const w = await (await dir.getFileHandle("meta.json", { create: true })).createWritable();
  await w.write(JSON.stringify(meta));
  await w.close();
}

/** `pilot`: `group` (`1`, the default, or `8MiB`), `inflight` (writes and closes at once, 1 by default), `read`
 *  (`file`, the default, by getFile(); or `sync`, by a sync handle a read). */
export function opfsAsync(pilot = new URLSearchParams()) {
  const grouped = pilot.get("group") === "8MiB";
  const inFlight = Number(pilot.get("inflight") ?? 1);
  const syncRead = pilot.get("read") === "sync";
  let dir = null;
  let writer = false;
  let n = 0;
  let frameBytes = 0;
  let G = 1;
  let trailer = null;
  let groups = new Map();
  let copies = new Map();
  let spare = [];
  let ops = new Set();
  let refused = null;

  const slotBytes = () => frameBytes + TRAILER_BYTES;
  const groupSize = (k) => Math.min(G, n - k * G);
  const track = (p) => {
    const op = p.finally(() => ops.delete(op));
    ops.add(op);
  };
  const room = async () => { while (ops.size >= inFlight) await Promise.race(ops); };

  function groupOf(i) {
    const k = Math.floor(i / G);
    if (!groups.has(k)) groups.set(k, { k, frames: new Map(), writable: null, writes: [] });
    return groups.get(k);
  }

  /** A refused write or close loses the group's swap, not its copies: the next write throws, its retry writes them again. */
  function fail(g, w, e) {
    if (g.writable !== w) return;
    g.writable = null;
    g.writes = [];
    g.retry = true;
    w.abort().catch(ignore);
    refused ??= quotaError(e);
  }

  /** Invariant: a copy goes back to the spares only once its group is committed, so a read until then is served from it. */
  function commit(g) {
    for (const [i, copy] of g.frames) copies.delete(i), spare.push(copy);
    groups.delete(g.k);
  }

  /** One frame into its group's writable; the frame that makes the group whole closes it in the same op, so an op is
   *  one call at a time and `inflight` bounds the calls. */
  async function put(g, i, copy, whole) {
    await room();
    g.writable ??= await (await dir.getFileHandle(String(g.k), { create: true })).createWritable();
    const w = g.writable;
    const before = whole ? [...g.writes] : [];
    const p = w.write({ type: "write", position: (i - g.k * G) * slotBytes(), data: copy })
      .then(() => whole && Promise.all(before).then(() => g.writable === w && w.close().then(() => commit(g))))
      .catch((e) => fail(g, w, e));
    g.writes.push(p);
    track(p);
  }

  const throwRefused = () => {
    const e = refused;
    refused = null;
    if (e) throw e;
  };

  async function readFile(k, at, into) {
    const handle = await dir.getFileHandle(String(k));
    const expected = groupSize(k) * slotBytes();
    if (!syncRead) {
      const file = await handle.getFile();
      if (file.size !== expected) return false;
      into.set(new Uint8Array(await file.slice(at, at + into.length).arrayBuffer()));
      return true;
    }
    const h = await handle.createSyncAccessHandle();
    try {
      return h.getSize() === expected && h.read(into, { at }) === into.length;
    } finally {
      h.close();
    }
  }

  /** A new series' room checked, not reserved: a writable's truncate to the whole series, then aborted. */
  async function probe(top, series) {
    const w = await (await dir.getFileHandle("probe", { create: true })).createWritable();
    try {
      await w.truncate(n * slotBytes());
    } catch (e) {
      await w.abort().catch(ignore);
      await top.removeEntry(key(series), { recursive: true });
      throw quotaError(e);
    }
    await w.abort();
    await dir.removeEntry("probe");
  }

  const a = {
    name: "opfs-async",
    async open(series, meta, { create }) {
      const top = await root();
      try {
        dir = await top.getDirectoryHandle(key(series), { create });
      } catch (e) {
        if (e.name === "NotFoundError") return { present: [], meta: null };
        throw e;
      }
      ({ frameBytes } = meta);
      n = meta.digests.length;
      G = grouped ? Math.max(1, Math.floor(GROUP_BYTES / slotBytes())) : 1;
      trailer = new Uint8Array(Int32Array.of(0, 0, meta.shape[0], meta.shape[1], 16, 1, 0).buffer);
      [writer, groups, copies, spare, ops, refused] = [create, new Map(), new Map(), [], new Set(), null];
      const before = await readMeta(dir).catch(() => null);
      if (!create && !before) return { present: [], meta: null };
      const present = [];
      const entries = [];
      for await (const entry of dir.entries()) entries.push(entry);
      for (const [name, h] of entries) {
        if (name === "meta.json") continue;
        const k = /^\d+$/.test(name) ? Number(name) : -1;
        const whole = k >= 0 && k * G < n && h.kind === "file" && (await h.getFile()).size === groupSize(k) * slotBytes();
        if (whole) for (let j = 0; j < groupSize(k); j++) present.push(k * G + j);
        else if (create) await dir.removeEntry(name, { recursive: true });
      }
      if (create) {
        if (!before) await probe(top, series);
        await writeMeta(dir, { ...meta, lastOpen: Date.now() });
      }
      return { present: present.sort((x, y) => x - y), meta: before };
    },

    /** Returns once the frame's write is issued, not done: the frame is on disk when its group's close resolves. */
    async write(i, bytes, { release = ignore } = {}) {
      if (!writer) throw new Error("a reading tab writes nothing");
      throwRefused();
      for (const g of groups.values()) {
        if (!g.retry) continue;
        g.retry = false;
        const frames = [...g.frames];
        const whole = frames.length === groupSize(g.k);
        for (const [x, [j, copy]] of frames.entries()) await put(g, j, copy, whole && x === frames.length - 1);
      }
      await room();
      throwRefused();
      const g = groupOf(i);
      const copy = spare.pop() ?? new Uint8Array(slotBytes());
      copy.set(bytes);
      copy.set(trailer, frameBytes);
      release();
      copies.set(i, copy);
      g.frames.set(i, copy);
      await put(g, i, copy, g.frames.size === groupSize(g.k));
    },

    async read(i, into) {
      const copy = copies.get(i);
      if (copy) return into.set(copy.subarray(0, frameBytes)), true;
      const k = Math.floor(i / G);
      try {
        return await readFile(k, (i - k * G) * slotBytes(), into);
      } catch (e) {
        if (e.name === "NotFoundError") return false;
        throw e;
      }
    },
    drop: async (i) => writer && dir.removeEntry(String(Math.floor(i / G))).catch(ignore),
    evict: async (series) => (await root()).removeEntry(key(series), { recursive: true }),
    async list() {
      const out = [];
      for await (const [name, h] of (await root()).entries()) {
        if (h.kind === "directory") out.push({ series: decodeURIComponent(name), lastOpen: (await readMeta(h).catch(() => ({}))).lastOpen ?? 0 });
      }
      return out;
    },
    /** In-flight writes and closes settle; a group still short of frames is aborted, never committed. */
    async close() {
      while (ops.size) await Promise.race(ops);
      for (const g of groups.values()) await g.writable?.abort().catch(ignore);
      [groups, copies, spare, refused, dir] = [new Map(), new Map(), [], null, null];
    },
    async damage(i) {
      const k = Math.floor(i / G);
      const at = (i - k * G) * slotBytes() + 7;
      const handle = await dir.getFileHandle(String(k));
      const b = new Uint8Array(await (await handle.getFile()).slice(at, at + 1).arrayBuffer());
      b[0] ^= 0x40;
      const w = await handle.createWritable({ keepExistingData: true });
      await w.write({ type: "write", position: at, data: b });
      await w.close();
    },
    /** The floor: `count` writables each written with the whole frame and closed, then `count` reads by the pilot's
     *  read; the copy out of shared memory is made once, outside the timing. */
    async floor(bytes, into, count) {
      const top = await root();
      const handle = await (await top.getDirectoryHandle("floor", { create: true })).getFileHandle("f", { create: true });
      const own = bytes.slice();
      const time = async (f) => { const t = performance.now(); await f(); return performance.now() - t; };
      const writeMs = [];
      const readMs = [];
      try {
        for (let k = 0; k < count; k++) {
          writeMs.push(await time(async () => {
            const w = await handle.createWritable();
            await w.write(own);
            await w.close();
          }));
        }
        for (let k = 0; k < count; k++) {
          readMs.push(await time(async () => {
            if (!syncRead) return into.set(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
            const h = await handle.createSyncAccessHandle();
            try {
              h.read(into, { at: 0 });
            } finally {
              h.close();
            }
          }));
        }
      } finally {
        await top.removeEntry("floor", { recursive: true });
      }
      return { writeMs, readMs };
    },
  };
  return a;
}
export default opfsAsync;
