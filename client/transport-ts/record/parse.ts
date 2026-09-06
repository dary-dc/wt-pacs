/**
 * Length-prefix peek for media streams — reuses the same framing as wire.ts.
 * Kept local so the tap does not pull session.ts into the telemetry graph.
 */

import { MAX_FRAME_LEN } from "../wire.ts";
import type { RowKind } from "./types.ts";

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

export type FodAsk = { kind: RowKind; frames: number[] };

/**
 * Decode every FoD ask in one control write (LE length + JSON, possibly several back to back).
 * Row kind comes from the op, not from how many frames the message carries: a
 * `request_frames` of one is still the batch path on the server.
 */
export function parseFodAsks(chunk: Uint8Array): FodAsk[] {
  const asks: FodAsk[] = [];
  let off = 0;
  const decoder = new TextDecoder();
  while (off + 4 <= chunk.length) {
    const bodyLen = new DataView(chunk.buffer, chunk.byteOffset + off, 4).getUint32(0, true);
    if (off + 4 + bodyLen > chunk.length) break;
    try {
      const msg = JSON.parse(decoder.decode(chunk.subarray(off + 4, off + 4 + bodyLen))) as {
        op?: string;
        frame?: number;
        frames?: number[];
      };
      if (msg.op === "request_frame" && typeof msg.frame === "number") {
        asks.push({ kind: "interaction", frames: [msg.frame] });
      } else if (msg.op === "request_frames" && Array.isArray(msg.frames)) {
        asks.push({ kind: "preload", frames: msg.frames.map(Number) });
      }
    } catch {
      break;
    }
    off += 4 + bodyLen;
  }
  return asks;
}

/** @deprecated kept for callers that want a flat frame list; kind is lost. */
export function parseFodFrames(chunk: Uint8Array): number[] | null {
  const asks = parseFodAsks(chunk);
  if (asks.length === 0) return null;
  return asks.flatMap((a) => a.frames);
}
