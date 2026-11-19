// cache-plan.md §8.6's API probe, in a dedicated worker: each value is true or the error's name.
const has = async (f) => { try { return await f(); } catch (e) { return String(e?.name || e); } };
const file = () => navigator.storage.getDirectory().then((d) => d.getFileHandle("probe", { create: true }));

(async () => postMessage({
  sharedArrayBuffer: typeof SharedArrayBuffer === "function",
  getDirectory: await has(async () => !!(await navigator.storage.getDirectory())),
  createSyncAccessHandle: await has(async () => { const h = await (await file()).createSyncAccessHandle(); h.close(); return true; }),
  createWritable: await has(async () => { const w = await (await file()).createWritable(); await w.close(); return true; }),
  indexedDB: await has(() => new Promise((ok, no) => {
    const r = indexedDB.open("probe");
    r.onsuccess = () => { r.result.close(); ok(true); };
    r.onerror = () => no(r.error);
  })),
  caches: await has(async () => !!(await caches.open("probe"))),
}))();
