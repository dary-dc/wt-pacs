/**
 * The test oracle for `record/attribution.ts`: firstByte / lastByte / chunks from a whole chunk log
 * and the frames' footprints, by arithmetic, as ADR Decision A defines them.
 */

import { MAX_FRAME_LEN } from "../../transport-ts/wire.ts";
import type { ChunkMark, FrameFootprint, FrameTiming } from "../types.ts";

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

/**
 * `firstByte(k)` = first read whose cumulative passes frame k's start;
 * `lastByte(k)` = first read reaching its end.
 */
export function attributeFrames(
  chunks: ChunkMark[],
  footprints: FrameFootprint[],
): { frames: FrameTiming[]; byte_closure_ok: boolean } {
  const finalCum = chunks.length === 0 ? 0 : chunks[chunks.length - 1].cum;
  const sumFoot = footprints.reduce((s, f) => s + (f.end - f.start), 0);
  const byte_closure_ok = sumFoot === finalCum;

  const frames: FrameTiming[] = [];
  for (const fp of footprints) {
    let first: ChunkMark | null = null;
    let last: ChunkMark | null = null;
    let chunkCount = 0;
    let prevCum = 0;
    for (const c of chunks) {
      const overlaps = c.cum > fp.start && prevCum < fp.end;
      if (overlaps) chunkCount += 1;
      if (first == null && c.cum > fp.start) first = c;
      if (c.cum >= fp.end) {
        last = c;
        break;
      }
      prevCum = c.cum;
    }
    if (first == null || last == null) continue;
    frames.push({
      frame_index: fp.frame_index,
      first_byte_us: first.t_us,
      last_byte_us: last.t_us,
      chunks: chunkCount,
      bytes: fp.bytes,
      start: fp.start,
      end: fp.end,
    });
  }
  return { frames, byte_closure_ok };
}
