// OPFS-SYNC: one packed file a series, one sync handle, written from the ring's slot in pieces, reads first.
// cache-plan.md §7.1; the layout is client/viewer/store.js's.
const RECORD_BYTES = 12;
const PRESENT = 2;
const root = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("cache-arms", { create: true });
const key = (series) => encodeURIComponent(series);
const quotaError = (e) => (e?.name === "NS_ERROR_FILE_NO_DEVICE_SPACE" ? Object.assign(new Error(e.message), { name: "QuotaExceededError" }) : e);
const readMeta = async (dir) => JSON.parse(await (await (await dir.getFileHandle("meta.json")).getFile()).text());

async function writeMeta(dir, meta) {
  const h = await (await dir.getFileHandle("meta.json", { create: true })).createSyncAccessHandle();
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(meta));
    h.truncate(0);
    h.write(bytes, { at: 0 });
  } finally {
    h.close();
  }
}

/** `pilot`: `piece`, the bytes a write is cut into (0, the default, a whole frame). */
export function opfsSync(pilot = new URLSearchParams()) {
  const piece = Number(pilot.get("piece") ?? 0);
  let dir = null;
  let handle = null;
  let n = 0;
  let frameBytes = 0;
  const recordAt = (i) => n * frameBytes + i * RECORD_BYTES;

  /** A reading tab has no handle: it reads the file as it stands, `getFile()` taking no lock. */
  async function readAt(at, into) {
    if (handle) return handle.read(into, { at });
    const file = await (await dir.getFileHandle("frames")).getFile();
    const got = new Uint8Array(await file.slice(at, at + into.byteLength).arrayBuffer());
    new Uint8Array(into.buffer, into.byteOffset, got.length).set(got);
    return got.length;
  }

  const putRecord = (i, present) => handle.write(Int32Array.of(0, 0, present ? 1 : 0), { at: recordAt(i) });

  const a = {
    name: "opfs-sync",
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
      const before = await readMeta(dir).catch(() => null);
      if (create) {
        handle = await (await dir.getFileHandle("frames", { create: true })).createSyncAccessHandle();
        if (!before) {
          try {
            handle.truncate(n * (frameBytes + RECORD_BYTES));
          } catch (e) {
            handle.close();
            handle = null;
            await top.removeEntry(key(series), { recursive: true });
            throw quotaError(e);
          }
        }
        await writeMeta(dir, { ...meta, lastOpen: Date.now() });
      } else if (!before) return { present: [], meta: null };
      const records = new Int32Array(n * (RECORD_BYTES / 4));
      if (before) await readAt(recordAt(0), records);
      return { present: [...Array(n).keys()].filter((i) => records[i * 3 + PRESENT] === 1), meta: before };
    },

    /** From the slot itself; between pieces, waiting reads are let in. Its record only after its last piece. */
    async write(i, bytes, { readsWaiting = () => 0, serveReads = async () => {} } = {}) {
      const step = piece > 0 ? piece : bytes.length;
      for (let off = 0; off < bytes.length; off += step) {
        if (off > 0 && readsWaiting() > 0) await serveReads();
        const part = bytes.subarray(off, Math.min(off + step, bytes.length));
        let wrote;
        try {
          wrote = handle.write(part, { at: i * frameBytes + off });
        } catch (e) {
          throw quotaError(e);
        }
        if (wrote !== part.length) throw new Error(`frame ${i}: ${wrote} of ${part.length} bytes written`);
      }
      putRecord(i, true);
    },

    async read(i, into) {
      const record = new Int32Array(3);
      if ((await readAt(recordAt(i), record)) !== RECORD_BYTES || record[PRESENT] !== 1) return false;
      return (await readAt(i * frameBytes, into)) === into.length;
    },
    drop: async (i) => handle && putRecord(i, false),
    evict: async (series) => (await root()).removeEntry(key(series), { recursive: true }),
    async list() {
      const out = [];
      for await (const [name, h] of (await root()).entries()) {
        if (h.kind === "directory") out.push({ series: decodeURIComponent(name), lastOpen: (await readMeta(h).catch(() => ({}))).lastOpen ?? 0 });
      }
      return out;
    },
    async close() {
      handle?.close();
      handle = null;
      dir = null;
    },
    async damage(i) {
      const b = new Uint8Array(1);
      handle.read(b, { at: i * frameBytes + 7 });
      b[0] ^= 0x40;
      handle.write(b, { at: i * frameBytes + 7 });
    },
    /** The floor: one handle on a file of the frame's size, `count` whole-frame writes then reads. */
    async floor(bytes, into, count) {
      const top = await root();
      const h = await (await (await top.getDirectoryHandle("floor", { create: true })).getFileHandle("f", { create: true })).createSyncAccessHandle();
      const writeMs = [];
      const readMs = [];
      try {
        h.truncate(bytes.length);
        for (let k = 0; k < count; k++) {
          const t = performance.now();
          h.write(bytes, { at: 0 });
          writeMs.push(performance.now() - t);
        }
        for (let k = 0; k < count; k++) {
          const t = performance.now();
          h.read(into, { at: 0 });
          readMs.push(performance.now() - t);
        }
      } finally {
        h.close();
        await top.removeEntry("floor", { recursive: true });
      }
      return { writeMs, readMs };
    },
  };
  return a;
}
export default opfsSync;
