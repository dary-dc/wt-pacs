/** A frame's cache entry as a file of its own, written by a decoder or the view worker. docs/adr/frame-path.md §3, *Built* */

/** Int32s after the samples: min, max, width, height, bits, components, signed. */
const TRAILER = 7;

export async function seriesDir(key) {
  const frames = await (await navigator.storage.getDirectory()).getDirectoryHandle("frames", { create: true });
  return frames.getDirectoryHandle(encodeURIComponent(key), { create: true });
}

/** Never flushed: a torn entry fails its digest on read. */
export async function writeEntry(dir, i, info) {
  const h = await (await dir.getFileHandle(String(i), { create: true })).createSyncAccessHandle();
  try {
    const n = info.pixels.byteLength;
    h.write(new Uint8Array(info.pixels), { at: 0 });
    h.write(new Int32Array([info.min, info.max, info.width, info.height, info.bits, info.components, info.signed ? 1 : 0]), { at: n });
    h.truncate(n + TRAILER * 4);
  } finally {
    h.close();
  }
}

/** The entry's samples in a new SharedArrayBuffer, not yet checked against its digest. */
export async function readEntry(dir, i) {
  const h = await (await dir.getFileHandle(String(i))).createSyncAccessHandle();
  try {
    const n = h.getSize() - TRAILER * 4;
    const pixels = new SharedArrayBuffer(n);
    const t = new Int32Array(TRAILER);
    h.read(new Uint8Array(pixels), { at: 0 });
    h.read(t, { at: n });
    const [min, max, width, height, bits, components, signed] = t;
    return { pixels, min, max, width, height, bits, components, signed: signed === 1 };
  } finally {
    h.close();
  }
}
