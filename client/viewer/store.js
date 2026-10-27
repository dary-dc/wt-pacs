/**
 * The store worker: a series' frames checked `true`, packed in one OPFS file, frame i at i × frameBytes, and read back
 * re-checked. docs/adr/frame-path.md §Proposed: the client cache in OPFS
 */
import { hasher } from "../decode/xxh3.js";

/** Per frame, after the frames: min, max, present. Written after its frame and never flushed: the re-check guards it. */
const RECORD = 3;

let series = null;
let all = null;
let xxh3 = null;

const named = (e) => e?.name ?? String(e);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function manifestOf(dir) {
  try {
    return JSON.parse(await (await (await dir.getFileHandle("manifest")).getFile()).text());
  } catch {
    return null;
  }
}

async function writeManifest(dir, m) {
  const h = await (await dir.getFileHandle("manifest", { create: true })).createSyncAccessHandle();
  const bytes = new TextEncoder().encode(JSON.stringify(m));
  h.truncate(0);
  h.write(bytes, { at: 0 });
  h.close();
}

/** Deletes the least recently opened series not open in any tab; false when none is left. */
async function evictOne() {
  const others = [];
  for await (const [name, dir] of all.entries()) if (name !== series.name) others.push({ name, opened: (await manifestOf(dir))?.opened ?? 0 });
  others.sort((a, b) => a.opened - b.opened);
  for (const { name } of others) {
    try {
      // Another tab's handle on it throws here; Chromium also refuses the removal under any handle, ours included.
      const frames = await (await all.getDirectoryHandle(name)).getFileHandle("frames", { create: true });
      (await frames.createSyncAccessHandle()).close();
      await all.removeEntry(name, { recursive: true });
      return true;
    } catch {
      /* open in another tab: never evicted */
    }
  }
  return false;
}

async function open({ key, digests }) {
  all = await (await navigator.storage.getDirectory()).getDirectoryHandle("series", { create: true });
  series = { name: encodeURIComponent(key), digests, n: digests.length, handle: null, stopped: false };
  const dir = await all.getDirectoryHandle(series.name).catch(() => null);
  if (!dir) return { present: [] };
  // The lock first: another tab holding the series throws here, before anything is dropped.
  const handle = await (await dir.getFileHandle("frames", { create: true })).createSyncAccessHandle();
  const m = await manifestOf(dir);
  if (!m || !same(m.digests, digests)) {
    handle.close();
    await all.removeEntry(series.name, { recursive: true });
    return { present: [] };
  }
  series.handle = handle;
  Object.assign(series, { frameBytes: m.frameBytes, shape: m.shape });
  await writeManifest(dir, { ...m, opened: Date.now() });
  const records = new Int32Array(series.n * RECORD);
  series.handle.read(records, { at: series.n * m.frameBytes });
  return { present: [...Array(series.n).keys()].filter((i) => records[i * RECORD + 2] === 1) };
}

/** Sizes the file at the first frame, whose size the series shares; a refused size evicts until it fits. */
async function create(info) {
  const { width, height, bits, components, signed } = info;
  series.frameBytes = info.pixels.byteLength;
  series.shape = { width, height, bits, components, signed };
  const dir = await all.getDirectoryHandle(series.name, { create: true });
  series.handle = await (await dir.getFileHandle("frames", { create: true })).createSyncAccessHandle();
  for (;;) {
    try {
      series.handle.truncate(series.n * (series.frameBytes + RECORD * 4));
      break;
    } catch (e) {
      if (!(named(e) === "QuotaExceededError" && (await evictOne()))) throw e;
    }
  }
  await writeManifest(dir, { digests: series.digests, frameBytes: series.frameBytes, shape: series.shape, opened: Date.now() });
}

const recordAt = (i) => series.n * series.frameBytes + i * RECORD * 4;
const putRecord = (i, record) => series.handle.write(new Int32Array(record), { at: recordAt(i) });

function getRecord(i) {
  const record = new Int32Array(RECORD);
  series.handle.read(record, { at: recordAt(i) });
  return record;
}

function putFrame(i, pixels) {
  try {
    series.handle.write(new Uint8Array(pixels), { at: i * series.frameBytes });
    return true;
  } catch {
    return false;
  }
}

async function write({ index, info }) {
  if (info.exact !== true || series.stopped) return { written: false };
  if (!series.handle) await create(info).catch(() => (series.stopped = true));
  if (series.stopped || info.pixels.byteLength !== series.frameBytes) return { written: false };
  // The file is sparse, so a full disk can refuse a write its size passed: evict one and retry once, else stop.
  if (!putFrame(index, info.pixels) && !((await evictOne()) && putFrame(index, info.pixels))) {
    series.stopped = true;
    return { written: false };
  }
  putRecord(index, [info.min, info.max, 1]);
  return { written: true };
}

/** A frame read back is hashed against its digest; one that fails loses its record and is fetched again. */
async function read({ index }) {
  xxh3 ??= await hasher();
  const pixels = new SharedArrayBuffer(series.frameBytes);
  const bytes = new Uint8Array(pixels);
  const [min, max] = getRecord(index);
  series.handle.read(bytes, { at: index * series.frameBytes });
  if (xxh3.init().update(bytes).digest("hex") !== series.digests[index]) {
    putRecord(index, [0, 0, 0]);
    return { miss: "its digest did not match" };
  }
  return { info: { ...series.shape, pixels, min, max, exact: true, path: "store" } };
}

const kinds = { open, write, read };
let queue = Promise.resolve();
onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      postMessage({ id: data.id, ...(await kinds[data.kind](data)) });
    } catch (e) {
      postMessage({ id: data.id, error: named(e) });
    }
  });
};
