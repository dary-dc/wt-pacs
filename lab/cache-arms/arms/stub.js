// The harness's stand-in arm, not a contender: a file per frame, a sync access handle opened and closed per call.
const root = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("cache-arms", { create: true });
const key = (series) => encodeURIComponent(series);

async function withHandle(dir, name, create, use) {
  const h = await (await dir.getFileHandle(name, { create })).createSyncAccessHandle();
  try {
    return use(h);
  } finally {
    h.close();
  }
}
const readMeta = async (dir) => JSON.parse(await (await (await dir.getFileHandle("meta.json")).getFile()).text());
const writeMeta = (dir, meta) => withHandle(dir, "meta.json", true, (h) => {
  const bytes = new TextEncoder().encode(JSON.stringify(meta));
  h.truncate(0);
  h.write(bytes, { at: 0 });
});

export function stub() {
  let top = null;
  let dir = null;
  const a = {
    name: "stub",
    async open(series, meta, { create }) {
      top = await root();
      try {
        dir = await top.getDirectoryHandle(key(series), { create });
      } catch (e) {
        if (e.name === "NotFoundError") return { present: [], meta: null };
        throw e;
      }
      const before = await readMeta(dir).catch(() => null);
      if (create) await writeMeta(dir, { ...meta, lastOpen: Date.now() });
      const present = [];
      for await (const name of dir.keys()) if (/^\d+$/.test(name)) present.push(Number(name));
      return { present: present.sort((x, y) => x - y), meta: before };
    },
    write: (i, bytes) => withHandle(dir, String(i), true, (h) => {
      h.truncate(0);
      if (h.write(bytes, { at: 0 }) !== bytes.length) throw new Error(`frame ${i}: short write`);
    }),
    async read(i, into) {
      try {
        return await withHandle(dir, String(i), false, (h) => h.getSize() === into.length && h.read(into, { at: 0 }) === into.length);
      } catch (e) {
        if (e.name === "NotFoundError") return false;
        throw e;
      }
    },
    drop: (i) => dir.removeEntry(String(i)),
    evict: async (series) => (await root()).removeEntry(key(series), { recursive: true }),
    async list() {
      const out = [];
      for await (const [name, h] of (await root()).entries()) {
        if (h.kind === "directory") out.push({ series: decodeURIComponent(name), lastOpen: (await readMeta(h).catch(() => ({}))).lastOpen ?? 0 });
      }
      return out;
    },
    close: async () => (dir = null),
    damage: (i) => withHandle(dir, String(i), false, (h) => {
      const b = new Uint8Array(1);
      h.read(b, { at: 7 });
      b[0] ^= 0x40;
      h.write(b, { at: 7 });
    }),
    /** The floor: the raw API alone, `count` writes then `count` reads of one frame. */
    async floor(bytes, into, count) {
      const probe = await (await root()).getDirectoryHandle("floor", { create: true });
      const time = async (f) => { const t = performance.now(); await f(); return performance.now() - t; };
      const writeMs = [];
      const readMs = [];
      for (let k = 0; k < count; k++) writeMs.push(await time(() => withHandle(probe, "f", true, (h) => h.write(bytes, { at: 0 }))));
      for (let k = 0; k < count; k++) readMs.push(await time(() => withHandle(probe, "f", false, (h) => h.read(into, { at: 0 }))));
      await (await root()).removeEntry("floor", { recursive: true });
      return { writeMs, readMs };
    },
  };
  return a;
}
export default stub;
