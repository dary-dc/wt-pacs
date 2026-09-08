/** Same framing constant as transport-ts/wire.ts; shared by both arms, pulls no session. */

import { MAX_FRAME_LEN } from "../transport-ts/wire.ts";
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

/** One FoD message decoded from the control stream (either direction). */
export type FodMessage =
  | { op: "request_frame"; frame: number }
  | { op: "request_frames"; frames: number[] }
  | { op: "stream_frames"; from?: number; to?: number }
  | { op: "end_stream" }
  | { op: "frame_error"; frame_index: number; reason: string }
  | { op: "other"; raw: string };

/** LE length + JSON, possibly several back to back. Returns the messages and the bytes they
 * consumed; a trailing partial message is left for the next read. */
export function parseFodMessages(buf: Uint8Array): { messages: FodMessage[]; consumed: number } {
  const messages: FodMessage[] = [];
  const decoder = new TextDecoder();
  let off = 0;
  while (off + 4 <= buf.length) {
    const bodyLen = new DataView(buf.buffer, buf.byteOffset + off, 4).getUint32(0, true);
    if (off + 4 + bodyLen > buf.length) break;
    const text = decoder.decode(buf.subarray(off + 4, off + 4 + bodyLen));
    off += 4 + bodyLen;
    try {
      const msg = JSON.parse(text) as {
        op?: string;
        frame?: number;
        frames?: number[];
        from?: number;
        to?: number;
        frame_index?: number;
        reason?: string;
      };
      if (msg.op === "request_frame" && typeof msg.frame === "number") {
        messages.push({ op: "request_frame", frame: msg.frame });
      } else if (msg.op === "request_frames" && Array.isArray(msg.frames)) {
        messages.push({ op: "request_frames", frames: msg.frames.map(Number) });
      } else if (msg.op === "stream_frames") {
        messages.push({
          op: "stream_frames",
          from: typeof msg.from === "number" ? msg.from : undefined,
          to: typeof msg.to === "number" ? msg.to : undefined,
        });
      } else if (msg.op === "end_stream") {
        messages.push({ op: "end_stream" });
      } else if (msg.op === "frame_error" && typeof msg.frame_index === "number") {
        messages.push({ op: "frame_error", frame_index: msg.frame_index, reason: msg.reason ?? "" });
      } else {
        messages.push({ op: "other", raw: text });
      }
    } catch {
      messages.push({ op: "other", raw: text });
    }
  }
  return { messages, consumed: off };
}

/** Kind comes from the op, not the frame count: a `request_frames` of one is still a batch. */
export function parseFodAsks(chunk: Uint8Array): FodAsk[] {
  const asks: FodAsk[] = [];
  for (const m of parseFodMessages(chunk).messages) {
    if (m.op === "request_frame") asks.push({ kind: "interaction", frames: [m.frame] });
    else if (m.op === "request_frames") asks.push({ kind: "preload", frames: m.frames });
    else if (m.op === "stream_frames") {
      const from = m.from ?? 0;
      asks.push({
        kind: "preload",
        frames: typeof m.to === "number" ? Array.from({ length: m.to - from + 1 }, (_, i) => from + i) : [],
      });
    }
  }
  return asks;
}

/** @deprecated kept for callers that want a flat frame list; kind is lost. */
export function parseFodFrames(chunk: Uint8Array): number[] | null {
  const asks = parseFodAsks(chunk);
  if (asks.length === 0) return null;
  return asks.flatMap((a) => a.frames);
}

/** Byte accumulator for a message stream whose messages may straddle reads. */
export class MessageAccumulator {
  private pending: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): FodMessage[] {
    let buf: Uint8Array;
    if (this.pending.length === 0) {
      buf = chunk;
    } else {
      buf = new Uint8Array(this.pending.length + chunk.length);
      buf.set(this.pending, 0);
      buf.set(chunk, this.pending.length);
    }
    const { messages, consumed } = parseFodMessages(buf);
    this.pending = consumed === buf.length ? new Uint8Array(0) : buf.slice(consumed);
    return messages;
  }
}
