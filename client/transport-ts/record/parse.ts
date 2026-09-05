/**
 * Length-prefix peek for media streams — reuses the same framing as wire.ts.
 * Kept local so the tap does not pull session.ts into the telemetry graph.
 */

import { MAX_FRAME_LEN } from "../wire.ts";

/** Parse consecutive `[4B BE len][4B BE index][codestream]` frames from a byte buffer. */
export function parseFootprintsFromBytes(
  buf: Uint8Array,
): { footprints: { frame_index: number; start: number; end: number; bytes: number }[]; consumed: number } {
  const footprints: { frame_index: number; start: number; end: number; bytes: number }[] = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = new DataView(buf.buffer, buf.byteOffset + off, 4).getUint32(0, false);
    if (len === 0 || len > MAX_FRAME_LEN) break;
    const total = 4 + len;
    if (off + total > buf.length) break;
    if (len < 4) break;
    const index = new DataView(buf.buffer, buf.byteOffset + off + 4, 4).getUint32(0, false);
    footprints.push({
      frame_index: index,
      start: off,
      end: off + total,
      bytes: len - 4,
    });
    off += total;
  }
  return { footprints, consumed: off };
}

/** Decode FoD body from a control write chunk (LE length + JSON). */
export function parseFodFrames(chunk: Uint8Array): number[] | null {
  if (chunk.length < 4) return null;
  const bodyLen = new DataView(chunk.buffer, chunk.byteOffset, 4).getUint32(0, true);
  if (4 + bodyLen > chunk.length) return null;
  try {
    const body = new TextDecoder().decode(chunk.subarray(4, 4 + bodyLen));
    const msg = JSON.parse(body) as { op?: string; frame?: number; frames?: number[] };
    if (msg.op === "request_frame" && typeof msg.frame === "number") return [msg.frame];
    if (msg.op === "request_frames" && Array.isArray(msg.frames)) return msg.frames.map(Number);
  } catch {
    return null;
  }
  return null;
}
