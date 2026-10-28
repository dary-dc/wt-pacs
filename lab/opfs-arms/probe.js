// Run once per engine: what the async API takes and refuses beside a sync access handle, here and in a nested worker.
const named = (e) => e?.name ?? String(e);
const attempt = async (f) => { try { const r = await f(); return typeof r === "string" ? r : "ok"; } catch (e) { return named(e); } };

async function here() {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("probe", { create: true });
  const fh = await dir.getFileHandle("f", { create: true });
  const out = { writableStream: typeof FileSystemWritableFileStream, animationFrame: typeof requestAnimationFrame };
  out.writeShared = await attempt(async () => { const w = await fh.createWritable(); try { await w.write(new Uint8Array(new SharedArrayBuffer(8))); } finally { await w.abort().catch(() => {}); } });
  out.writeUnshared = await attempt(async () => { const w = await fh.createWritable(); await w.write(new Uint8Array(8)); await w.close(); });
  const sync = await fh.createSyncAccessHandle();
  out.syncHandle = "ok";
  out.getFileUnderSync = await attempt(async () => `ok, ${(await (await fh.getFile()).arrayBuffer()).byteLength} bytes`);
  out.writableUnderSync = await attempt(() => fh.createWritable());
  sync.close();
  const w = await fh.createWritable();
  out.syncUnderWritable = await attempt(async () => (await fh.createSyncAccessHandle()).close());
  await w.abort();
  return out;
}

if (self.name === "nested") here().catch(named).then((nested) => postMessage({ nested }));
else {
  (async () => {
    const top = await here().catch(named);
    const nested = await new Promise((resolve) => {
      try {
        const n = new Worker(new URL("probe.js", import.meta.url), { type: "module", name: "nested" });
        n.onmessage = ({ data }) => resolve(data.nested);
        n.onerror = (e) => resolve(`nested worker failed: ${e.message}`);
      } catch (e) {
        resolve(`no nested worker: ${named(e)}`);
      }
    });
    postMessage({ top, nested });
  })();
}
