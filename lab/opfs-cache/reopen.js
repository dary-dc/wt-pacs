// A series reopened through the product's store worker, every frame read back and then hashed again by the rig.
const q = new URLSearchParams(location.search);

async function names() {
  const all = await (await navigator.storage.getDirectory()).getDirectoryHandle("series", { create: true });
  const out = [];
  for await (const name of all.keys()) out.push(decodeURIComponent(name));
  return out;
}

async function reopen() {
  const meta = await (await fetch(q.get("metadata"))).json();
  const sha = await (await fetch(q.get("sha"))).json();
  const digests = meta.digests.frames;
  const t0 = performance.now();
  const worker = new Worker("/client/viewer/store.js", { type: "module" });
  const replies = new Map();
  let id = 0;
  worker.onmessage = ({ data }) => (replies.get(data.id)(data), replies.delete(data.id));
  const call = (kind, m) => new Promise((resolve) => (replies.set(++id, resolve), worker.postMessage({ kind, id, ...m })));
  const opened = await call("open", { key: q.get("key"), digests });
  if (opened.error) return { error: opened.error };
  const read = [];
  const misses = [];
  for (const i of opened.present) {
    const r = await call("read", { index: i });
    if (r.info) read.push([i, r.info.pixels]);
    else misses.push({ i, why: r.miss ?? r.error });
  }
  const ms = performance.now() - t0;
  worker.terminate();
  const wrong = [];
  for (const [i, pixels] of read) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(pixels).slice()));
    if ([...h].map((b) => b.toString(16).padStart(2, "0")).join("") !== sha[i % sha.length]) wrong.push(i);
  }
  return { ms, n: digests.length, present: opened.present.length, read: read.length, misses, wrong };
}

globalThis.result = (q.get("list") ? names() : reopen()).catch((e) => ({ error: String(e?.message ?? e) }));
