/**
 * §5.1 — attribute firstByte / lastByte / chunks from a chunk log + footprints.
 * Arithmetic only; no wire parsing here.
 */

import type { ChunkMark, FrameFootprint } from "./types.ts";

export type FrameTiming = {
  frame_index: number;
  first_byte_us: number;
  last_byte_us: number;
  chunks: number;
  bytes: number;
  start: number;
  end: number;
};

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
