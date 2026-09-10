/** Read one media envelope into its final buffer. `docs/improvements/2026-09-10.md`. */

export const MAX_MEDIA_LEN = 64 * 1024 * 1024;

export async function readExactByob(
  reader: ReadableStreamBYOBReader,
  n: number,
): Promise<Uint8Array | null> {
  let buf = new ArrayBuffer(n);
  let filled = 0;
  while (filled < n) {
    const { value, done } = await reader.read(new Uint8Array(buf, filled, n - filled));
    if (done) {
      if (filled === 0) return null;
      throw new Error("stream ended mid-frame");
    }
    filled += value.byteLength;
    buf = value.buffer;
  }
  return new Uint8Array(buf, 0, n);
}

export async function readLengthPrefixedByob(
  reader: ReadableStreamBYOBReader,
): Promise<Uint8Array | null> {
  const header = await readExactByob(reader, 4);
  if (!header) return null;
  const len = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, false);
  if (len === 0 || len > MAX_MEDIA_LEN) {
    throw new Error(`invalid frame length ${len}`);
  }
  const body = await readExactByob(reader, len);
  if (!body) throw new Error("uni stream ended mid-frame");
  return body;
}
