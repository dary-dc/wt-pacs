/**
 * Streaming frame attributor — O(chunk) work, O(1) memory per stream.
 * Semantics match offsets.ts attributeFrames(); keep that as the test oracle.
 */

import { MAX_FRAME_LEN } from "../wire.ts";
import type { FrameTiming } from "./offsets.ts";

export type { FrameTiming };

type OpenFrame = {
  start: number;
  end: number;
  index: number;
  firstUs: number;
  chunks: number;
};

/** O(1) work per read, O(1) memory. Emits a frame when its last byte arrives. */
export class StreamAttributor {
  private cum = 0;
  private nextStart = 0;
  private hdr = new Uint8Array(8);
  private hdrLen = 0;
  private hdrChunks = 0;
  private pendingFirstUs = 0;
  private cur: OpenFrame | null = null;
  private bad = false;
  private readonly maxFrameLen: number;
  private readonly emitted: FrameTiming[] = [];

  constructor(maxFrameLen: number = MAX_FRAME_LEN) {
    this.maxFrameLen = maxFrameLen;
  }

  /** Frames finished so far (append-only). */
  get finished(): readonly FrameTiming[] {
    return this.emitted;
  }

  onRead(value: Uint8Array, tUs: number): FrameTiming[] {
    const newly: FrameTiming[] = [];
    if (this.bad || value.length === 0) return newly;

    const prevCum = this.cum;
    this.cum += value.length;
    if (this.cur) this.cur.chunks += 1;

    let off = 0;
    while (off < value.length) {
      if (this.cur === null) {
        // firstByte = read that first delivered ANY byte of this frame
        // (may be only part of the 8-byte header).
        if (this.hdrLen === 0) this.pendingFirstUs = tUs;
        const take = Math.min(8 - this.hdrLen, value.length - off);
        this.hdr.set(value.subarray(off, off + take), this.hdrLen);
        this.hdrLen += take;
        off += take;
        if (this.hdrLen < 8) {
          this.hdrChunks += 1;
          return newly;
        }

        const dv = new DataView(this.hdr.buffer, this.hdr.byteOffset, 8);
        const len = dv.getUint32(0, false);
        if (len < 4 || len > this.maxFrameLen) {
          this.bad = true;
          return newly;
        }
        this.cur = {
          start: this.nextStart,
          end: this.nextStart + 4 + len,
          index: dv.getUint32(4, false),
          firstUs: this.pendingFirstUs,
          chunks: this.hdrChunks + 1,
        };
        this.hdrLen = 0;
        this.hdrChunks = 0;
      }

      const take = Math.min(this.cur.end - (prevCum + off), value.length - off);
      off += take;
      if (prevCum + off >= this.cur.end) {
        const frame: FrameTiming = {
          frame_index: this.cur.index,
          first_byte_us: this.cur.firstUs,
          last_byte_us: tUs,
          chunks: this.cur.chunks,
          bytes: this.cur.end - this.cur.start - 8,
          start: this.cur.start,
          end: this.cur.end,
        };
        this.emitted.push(frame);
        newly.push(frame);
        this.nextStart = this.cur.end;
        this.cur = null;
      } else {
        return newly;
      }
    }
    return newly;
  }

  /** True when every received byte landed in a finished frame (no open/partial). */
  closureOk(): boolean {
    return !this.bad && this.cur === null && this.hdrLen === 0 && this.cum === this.nextStart;
  }

  get isBad(): boolean {
    return this.bad;
  }
}
