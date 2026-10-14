// A series bundle read whole in the page: docs/FIXTURES.md §SBND.

/** `buf`: the bundle's bytes. Returns its metadata and each frame's bytes, views into `buf`. */
export function readBundle(buf) {
  const v = new DataView(buf);
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (magic !== "SBND" || v.getUint32(4, true) !== 1) throw new Error(`not an SBND v1 bundle (${magic})`);
  const metaLen = v.getUint32(8, true);
  const count = v.getUint32(12, true);
  // 16-byte header, then a 12-byte entry a frame: offset u64, length u32.
  const tableEnd = 16 + 12 * count;
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, tableEnd, metaLen)));
  const frames = [];
  for (let i = 0; i < count; i++) {
    const at = 16 + 12 * i;
    const offset = Number(v.getBigUint64(at, true));
    const length = v.getUint32(at + 8, true);
    if (offset + length > buf.byteLength) throw new Error(`frame ${i} runs past the bundle`);
    frames.push(new Uint8Array(buf, offset, length));
  }
  return { meta, frames };
}
