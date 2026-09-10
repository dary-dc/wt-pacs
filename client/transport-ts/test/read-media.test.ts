/**
 * A BYOB read of `[4B BE len][payload]` lands the payload in the buffer the
 * stream filled — no accumulator copy. `docs/improvements/2026-09-10.md`.
 */
import { readLengthPrefixedByob } from "../read-media.ts";

function bytesStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    type: "bytes",
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

function prefix(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

const payload = new Uint8Array(64);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;

const stream = bytesStream([prefix(payload)]);
const reader = stream.getReader({ mode: "byob" });
const got = await readLengthPrefixedByob(reader);
if (!got) throw new Error("expected a payload");
if (got.length !== payload.length) throw new Error(`length ${got.length}`);
for (let i = 0; i < payload.length; i++) {
  if (got[i] !== payload[i]) throw new Error(`byte ${i}`);
}
if (got.buffer.byteLength < payload.length) {
  throw new Error("payload is not a view of a BYOB buffer");
}

const empty = bytesStream([]);
const emptyReader = empty.getReader({ mode: "byob" });
const eof = await readLengthPrefixedByob(emptyReader);
if (eof !== null) throw new Error("clean EOF must be null");

console.log("read-media BYOB ok");
