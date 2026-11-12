/**
 * The lab store: one OPFS directory per series key, one file per record (a picture, or a strip's coded bands), read
 * back on a reopen. It stands in for the product store plus I4's two record kinds. lab/htj2k-tiles/improve/README.md §Stage 3
 */
let dir = null;

async function put(name, bytes) {
  const h = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
  h.truncate(0);
  h.write(bytes, { at: 0 });
  h.flush();
  h.close();
}

async function get(name) {
  try {
    return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
  } catch {
    return null;
  }
}

let queue = Promise.resolve();
// One operation at a time: a sync access handle is exclusive.
onmessage = ({ data: m }) => (queue = queue.then(() => handle(m)));

async function handle(m) {
  if (m.hang) return new Promise(() => {});
  if (m.debug) console.log("store", m.op, m.name ?? "");
  try {
    if (m.op === "open") dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(m.key, { create: true });
    if (m.op === "put") await put(m.name, new Uint8Array(m.bytes));
    if (m.op === "drop") await dir.removeEntry(m.name).catch(() => {});
    if (m.op === "names") {
      const names = [];
      for await (const n of dir.keys()) names.push(n);
      return postMessage({ id: m.id, names });
    }
    if (m.op === "get") {
      const bytes = await get(m.name);
      return postMessage({ id: m.id, bytes }, bytes ? [bytes.buffer] : []);
    }
    postMessage({ id: m.id });
  } catch (e) {
    postMessage({ id: m.id, error: String(e?.message ?? e) });
  }
}
