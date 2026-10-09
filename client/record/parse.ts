/** The control stream's FoD messages, as the Tap reads them; pulls no session. */

import type { RowKind } from "./types.ts";

export type FodAsk = { kind: RowKind; frames: number[] };

/** One FoD message decoded from the control stream (either direction). */
export type FodMessage =
  | { op: "request_frame"; frame: number }
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
        from?: number;
        to?: number;
        frame_index?: number;
        reason?: string;
      };
      if (msg.op === "request_frame" && typeof msg.frame === "number") {
        messages.push({ op: "request_frame", frame: msg.frame });
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

/** Kind comes from the op, not the frame count: a `stream_frames` of one frame is still a fill. */
export function parseFodAsks(chunk: Uint8Array): FodAsk[] {
  const asks: FodAsk[] = [];
  for (const m of parseFodMessages(chunk).messages) {
    if (m.op === "request_frame") asks.push({ kind: "ask", frames: [m.frame] });
    else if (m.op === "stream_frames") {
      const from = m.from ?? 0;
      asks.push({
        kind: "fill",
        frames: typeof m.to === "number" ? Array.from({ length: m.to - from + 1 }, (_, i) => from + i) : [],
      });
    }
  }
  return asks;
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
