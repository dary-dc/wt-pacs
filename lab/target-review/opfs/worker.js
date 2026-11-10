// OPFS probe worker: each command times one cell and posts its rows. lab/target-review/opfs/README.md
const now = () => performance.now();
const name = (k) => `frame-${k}`;

async function series(label) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(label, { create: true });
}

async function open(dir, k, create) {
  let t = now();
  const file = await dir.getFileHandle(name(k), { create });
  const handle = now() - t;
  t = now();
  const h = await file.createSyncAccessHandle();
  return { h, handle, sync: now() - t };
}

function timed(f) {
  const t = now();
  const v = f();
  return [now() - t, v];
}

async function write({ series: label, size, frames, preopen }) {
  let t = now();
  const dir = await series(label);
  const dirMs = now() - t;
  const bytes = new Uint8Array(size).fill(0xa5);
  const opened = [];
  if (preopen) for (let k = 0; k < frames; k++) opened.push(await open(dir, k, true));
  const rows = [];
  for (let k = 0; k < frames; k++) {
    const { h, handle, sync } = opened[k] ?? (await open(dir, k, true));
    const [write, n] = timed(() => h.write(bytes, { at: 0 }));
    if (n !== size) throw new Error(`short write ${n}/${size}`);
    const [close] = timed(() => h.close());
    rows.push({ handle, sync, write, close });
  }
  return { dir: dirMs, rows };
}

async function read({ series: label, size, frames }) {
  const dir = await series(label);
  const buf = new Uint8Array(size);
  const rows = [];
  for (let k = 0; k < frames; k++) {
    const { h, handle, sync } = await open(dir, k, false);
    const [getSize, n] = timed(() => h.getSize());
    if (n !== size) throw new Error(`size ${n}/${size}`);
    const [read, got] = timed(() => h.read(buf, { at: 0 }));
    if (got !== size) throw new Error(`short read ${got}/${size}`);
    const [close] = timed(() => h.close());
    rows.push({ handle, sync, getSize, read, close });
  }
  return { rows };
}

async function list({ count }) {
  const dir = await series("many");
  let t = now();
  for (let i = 0; i < count; i++) await dir.getFileHandle(`f${i}`, { create: true });
  const create = now() - t;
  t = now();
  let n = 0;
  for await (const k of dir.keys()) if (k) n++;
  return { create, keys: now() - t, n };
}

async function estimate() {
  const exists = typeof navigator.storage?.estimate === "function";
  return { exists, value: exists ? await navigator.storage.estimate() : null };
}

function ask(w, req) {
  return new Promise((res, rej) => {
    w.onmessage = (e) => (e.data.error ? rej(new Error(e.data.error)) : res(e.data.result));
    w.onerror = (e) => rej(new Error(e.message));
    w.postMessage(req);
  });
}

async function nested({ inner }) {
  const w = new Worker("nested.js");
  try {
    return await ask(w, inner);
  } finally {
    w.terminate();
  }
}

const commands = { write, read, list, estimate, nested };
onmessage = async (e) => {
  try {
    postMessage({ result: await commands[e.data.cmd](e.data) });
  } catch (err) {
    postMessage({ error: `${err?.name ?? "Error"}: ${err?.message ?? err}` });
  }
};
