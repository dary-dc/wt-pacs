/**
 * The OPFS cache behind the frame store in the view worker: what is on disk, a read checked against the frame digest,
 * and a write by one of three writers. docs/adr/frame-path.md §3, *Built*
 */
import { hasher } from "../decode/xxh3.js";
import { readEntry, seriesDir, writeEntry } from "./frame-file.js";

/** The series' cache, or null when this tab cannot hold it; either failure is said once, as the cache's. */
export async function openCache({ writer, key, digests, emit }) {
  const said = (reason) => emit("failed", { scope: "cache", reason });
  let cache;
  try {
    cache = writer === "store" ? await storeWorker(key, digests) : await files(writer, key, digests);
  } catch (e) {
    said(`not opened: ${e?.message ?? e}`);
    return null;
  }
  let stopped = false;
  return {
    present: new Set(cache.present),
    read: (i) => cache.read(i).then((info) => (info ? { ...info, exact: true, path: "cache" } : null), () => null),
    /** Paint first: the frame store calls this once the frame's paint has drawn. */
    async write(i, frame) {
      if (stopped) return false;
      const ok = await cache.write(i, frame).then(Boolean, () => false);
      if (!ok && !stopped) said(`stopped at frame ${i}: no frame after it is written`);
      stopped ||= !ok;
      return ok;
    },
  };
}

/** The packed file of client/viewer/store.js, in a worker of its own: writes and reads leave this thread. */
async function storeWorker(key, digests) {
  const worker = new Worker(new URL("../viewer/store.js", import.meta.url), { type: "module" });
  const replies = new Map();
  let id = 0;
  const call = (kind, m, transfer = []) => new Promise((resolve) => (replies.set(++id, resolve), worker.postMessage({ kind, id, ...m }, transfer)));
  worker.onmessage = ({ data }) => (replies.get(data.id)(data), replies.delete(data.id));
  worker.onerror = (e) => {
    for (const r of replies.values()) r({ error: `the store worker failed: ${e.message || "its script did not load"}` });
    replies.clear();
  };
  const { present, error } = await call("open", { key, digests });
  if (error) {
    worker.terminate();
    throw new Error(error === "NoModificationAllowedError" ? "another tab holds this series' cache" : error);
  }
  return {
    present,
    read: async (index) => (await call("read", { index })).info,
    // A copy handed over: a SharedArrayBuffer sent to the store worker is never collected there.
    write: async (index, { info }, pixels = new Uint8Array(info.pixels).slice().buffer) =>
      (await call("write", { index, info: { ...info, pixels } }, [pixels])).written,
  };
}

/** A file per frame, written by the decoder that decoded it, or by this thread (the lab's writer `view`). */
async function files(writer, key, digests) {
  // A file per frame has no series-wide lock as the packed file does, so the series takes a Web Lock for the tab's life.
  const held = await new Promise((resolve) => navigator.locks.request(`frame cache ${key}`, { ifAvailable: true }, (lock) => {
    resolve(lock !== null);
    return lock && new Promise(() => {});
  }));
  if (!held) throw new Error("another tab holds this series' cache");
  const [dir, xxh3] = await Promise.all([seriesDir(key), hasher()]);
  const present = [];
  for await (const name of dir.keys()) if (digests[name]) present.push(Number(name));
  return {
    present,
    async read(i) {
      const info = await readEntry(dir, i);
      return xxh3.init().update(new Uint8Array(info.pixels)).digest("hex") === digests[i] ? info : null;
    },
    write: writer === "view" ? (i, { info }) => writeEntry(dir, i, info).then(() => true) : (i, frame) => frame.write?.() ?? false,
  };
}
