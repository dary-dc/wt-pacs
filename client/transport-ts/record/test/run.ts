/**
 * Unit tests for record/ — run with:
 *   bash client/transport-ts/build.sh && node client/transport-ts/record/test/run.mjs
 * or: node --experimental-strip-types client/transport-ts/record/test/run.ts
 */

import { StreamAttributor } from "../attribution.ts";
import { attributeFrames } from "../offsets.ts";
import { nearestRank, distributionStats } from "../percentiles.ts";
import { parseFootprintsFromBytes } from "../parse.ts";
import { judgeIntegrity, minOf, maxOf } from "../report.ts";
import { pickBinding } from "../rows.ts";
import { Tap } from "../tap.ts";
import type { ChunkMark } from "../types.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("ok:", msg);
  }
}

function assertEq(a: unknown, b: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  assert(ok, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRiver(frames: { index: number; codestreamLen: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of frames) {
    const len = 4 + f.codestreamLen;
    const buf = new Uint8Array(4 + len);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, len, false);
    dv.setUint32(4, f.index, false);
    parts.push(buf);
  }
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function sliceRiver(
  river: Uint8Array,
  boundaries: number[],
): { chunks: ChunkMark[]; slices: Uint8Array[] } {
  const slices: Uint8Array[] = [];
  const chunks: ChunkMark[] = [];
  let prev = 0;
  let t = 1000;
  for (const end of boundaries) {
    const slice = river.subarray(prev, end);
    slices.push(slice);
    t += 12;
    chunks.push({ t_us: t, cum: end });
    prev = end;
  }
  if (prev < river.length) {
    slices.push(river.subarray(prev));
    t += 12;
    chunks.push({ t_us: t, cum: river.length });
  }
  return { chunks, slices };
}

// §5.1 example (oracle)
{
  const chunks = [
    { t_us: 10_000, cum: 64 },
    { t_us: 10_400, cum: 190 },
    { t_us: 11_100, cum: 400 },
    { t_us: 11_900, cum: 474 },
  ];
  const footprints = [
    { frame_index: 0, start: 0, end: 108, bytes: 100 },
    { frame_index: 1, start: 108, end: 316, bytes: 200 },
    { frame_index: 2, start: 316, end: 474, bytes: 150 },
  ];
  const { frames, byte_closure_ok } = attributeFrames(chunks, footprints);
  assert(byte_closure_ok, "byte_closure_ok on §5.1 example");
  assertEq(frames[0].first_byte_us, 10_000, "frame0 firstByte");
  assertEq(frames[0].last_byte_us, 10_400, "frame0 lastByte");
  assertEq(frames[0].chunks, 2, "frame0 chunks");
  assertEq(frames[1].first_byte_us, 10_400, "frame1 firstByte equals frame0 lastByte");
  assertEq(frames[1].last_byte_us, 11_100, "frame1 lastByte");
  assertEq(frames[2].first_byte_us, 11_100, "frame2 firstByte");
  assertEq(frames[2].last_byte_us, 11_900, "frame2 lastByte");
}

// truncated log → byte_closure_ok false (oracle)
{
  const chunks = [{ t_us: 1, cum: 50 }];
  const footprints = [{ frame_index: 0, start: 0, end: 108, bytes: 100 }];
  const { byte_closure_ok } = attributeFrames(chunks, footprints);
  assert(!byte_closure_ok, "truncated chunk log fails byte closure");
}

// Streaming attributor ↔ oracle, 300 randomized cases (headers often straddle)
{
  const rand = mulberry32(0xc0ffee);
  let mismatches = 0;
  for (let trial = 0; trial < 300; trial++) {
    const nFrames = 1 + Math.floor(rand() * 8);
    const specs = [];
    for (let i = 0; i < nFrames; i++) {
      specs.push({ index: i, codestreamLen: 1 + Math.floor(rand() * 400) });
    }
    const river = buildRiver(specs);
    const { footprints } = parseFootprintsFromBytes(river);
    if (footprints.length !== nFrames) {
      mismatches += 1;
      continue;
    }

    // Random read boundaries 1–200 B
    const cuts: number[] = [];
    let pos = 0;
    while (pos < river.length) {
      const step = 1 + Math.floor(rand() * 200);
      pos = Math.min(river.length, pos + step);
      if (pos < river.length) cuts.push(pos);
    }
    const { chunks, slices } = sliceRiver(river, cuts);

    const attr = new StreamAttributor();
    let tBase = 1000;
    for (const sl of slices) {
      tBase += 12;
      attr.onRead(sl, tBase);
    }
    const { frames: oracle } = attributeFrames(chunks, footprints);
    const got = attr.finished;
    if (got.length !== oracle.length) {
      mismatches += 1;
      continue;
    }
    for (let i = 0; i < oracle.length; i++) {
      const a = oracle[i];
      const b = got[i];
      if (
        a.frame_index !== b.frame_index ||
        a.first_byte_us !== b.first_byte_us ||
        a.last_byte_us !== b.last_byte_us ||
        a.chunks !== b.chunks ||
        a.bytes !== b.bytes ||
        a.start !== b.start ||
        a.end !== b.end
      ) {
        mismatches += 1;
        if (mismatches === 1) {
          console.error("first mismatch trial", trial, { a, b, cuts });
        }
        break;
      }
    }
    if (!attr.closureOk()) {
      mismatches += 1;
    }
  }
  assertEq(mismatches, 0, "streaming attributor matches oracle on 300 randomized cases");
}

// Explicit straddling-header: firstByte is the read with the first header byte
{
  const river = buildRiver([{ index: 0, codestreamLen: 20 }]); // total 28 bytes
  const attr = new StreamAttributor();
  attr.onRead(river.subarray(0, 3), 1020); // partial header
  attr.onRead(river.subarray(3, 10), 1032); // complete header + some body
  attr.onRead(river.subarray(10), 1040);
  assertEq(attr.finished.length, 1, "straddle: one frame");
  assertEq(attr.finished[0].first_byte_us, 1020, "straddle: firstByte from first header byte");
  assertEq(attr.finished[0].last_byte_us, 1040, "straddle: lastByte on completing read");
  assert(attr.closureOk(), "straddle: closure ok");
}

// Read ends exactly on a frame boundary; next read is only the next frame
{
  const river = buildRiver([
    { index: 0, codestreamLen: 4 },
    { index: 1, codestreamLen: 4 },
  ]);
  const mid = 4 + 4 + 4; // end of frame 0
  const attr = new StreamAttributor();
  attr.onRead(river.subarray(0, mid), 100);
  attr.onRead(river.subarray(mid), 200);
  assertEq(attr.finished.length, 2, "boundary: two frames");
  assertEq(attr.finished[0].last_byte_us, 100, "boundary: frame0 ends on first read");
  assertEq(attr.finished[1].first_byte_us, 200, "boundary: frame1 starts on second read");
}

// Single read carrying several whole frames
{
  const river = buildRiver([
    { index: 1, codestreamLen: 4 },
    { index: 2, codestreamLen: 4 },
    { index: 3, codestreamLen: 4 },
  ]);
  const attr = new StreamAttributor();
  attr.onRead(river, 50);
  assertEq(attr.finished.length, 3, "multi-in-one: three frames");
  assert(
    attr.finished.every((f) => f.first_byte_us === 50 && f.last_byte_us === 50 && f.chunks === 1),
    "multi-in-one: same stamp, one chunk each",
  );
}

// Truncated stream → closureOk false; Tap integrity.byte_closure_ok false
{
  const attr = new StreamAttributor();
  const river = buildRiver([{ index: 0, codestreamLen: 100 }]);
  attr.onRead(river.subarray(0, 20), 1);
  assert(!attr.closureOk(), "truncated attributor not closed");

  const tap = new Tap({ arm: "transport-ts", stream_mode: "shared", copies_per_frame: 1 });
  const enc = new TextEncoder();
  const body = enc.encode(JSON.stringify({ op: "request_frame", frame: 1 }));
  const fod = new Uint8Array(4 + body.length);
  new DataView(fod.buffer).setUint32(0, body.length, true);
  fod.set(body, 4);
  tap.onControlWrite(fod);
  const sid = tap.nextStreamId();
  tap.onMediaRead(sid, river.subarray(0, 20));
  const report = tap.finish();
  assert(!report.summary.integrity.byte_closure_ok, "Tap flags truncated stream");
  assertEq(report.summary.integrity.valid, false, "truncated run invalid");
  assert(
    (report.summary.integrity.invalid_reasons ?? []).some((r) => r.includes("byte_closure_ok")),
    "invalid_reasons mentions byte_closure_ok",
  );
}

// nearest-rank where interpolation disagrees
{
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  assertEq(nearestRank(sorted, 95), 100, "nearest-rank p95 picks last");
  const linearRank = (sorted.length - 1) * 0.95;
  const lo = Math.floor(linearRank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const linear = sorted[lo] + (sorted[hi] - sorted[lo]) * (linearRank - lo);
  assert(linear !== 100, "linear interpolation differs from nearest-rank on this vector");
}

// Null ≠ 0 and binding_term excludes transfer when chunks==1
{
  const tap = new Tap({
    arm: "transport-ts",
    stream_mode: "shared",
    copies_per_frame: 1,
  });
  assertEq(tap.integrity.clock_resolution_us, null, "clock probe not run in constructor");
  const frameIndex = 1;
  const enc = new TextEncoder();
  const body = enc.encode(JSON.stringify({ op: "request_frame", frame: frameIndex }));
  const fod = new Uint8Array(4 + body.length);
  new DataView(fod.buffer).setUint32(0, body.length, true);
  fod.set(body, 4);
  tap.gesture(frameIndex);
  tap.onControlWrite(fod);
  tap.onAskFlush();

  const sid = tap.nextStreamId();
  const media = new Uint8Array(12);
  new DataView(media.buffer).setUint32(0, 8, false);
  new DataView(media.buffer).setUint32(4, frameIndex, false);
  media[8] = 1;
  media[9] = 2;
  media[10] = 3;
  media[11] = 4;
  tap.onMediaRead(sid, media);
  tap.onDelivered(frameIndex);
  const report = tap.finish();
  const row = report.client_frames.find((r) => r.frame_index === frameIndex)!;
  assert(row.decode_us === null, "decode_us is null not 0");
  assert(row.decode_wait_us === null, "decode_wait_us is null");
  assert(row.paint_us === null, "paint_us is null");
  assertEq(row.chunks, 1, "single-chunk frame");
  assertEq(row.transfer_us, 0, "transfer is 0 when first==last");
  assert(row.binding_term !== "transfer", "transfer excluded from binding_term when chunks==1");
  assert(report.summary.headline.ask_to_last_paint === null, "ask_to_last_paint stays null");
  assert(
    report.summary.headline.ask_to_last_frame_complete_us != null,
    "analogue ask_to_last_frame_complete_us present",
  );
  assert(report.summary.distributions.bytes != null, "frame1 contributes to bytes distribution");
  assert(report.summary.distributions.bytes!.count === 1, "one usable frame in bytes dist");
  assert(
    report.summary.distributions.transfer === null,
    "transfer dist null when only chunks==1 frames",
  );
  assert(report.summary.copies.mean_frame_bytes != null, "mean_frame_bytes present");
  assert(report.summary.binding != null, "binding rollup present");
  assert(report.summary.integrity.clock_probe_us != null, "clock probe cost recorded at finish");
  assert(report.summary.integrity.clock_resolution_us != null, "clock resolution set at finish");
  assertEq(report.summary.integrity.valid, true, "clean run valid");
  assertEq(report.summary.integrity.invalid_reasons, [], "clean run no reasons");
}

// pickBinding: chunks===0 must not select transfer
{
  assertEq(
    pickBinding({
      queue_us: null,
      serve_plus_path_us: 10,
      transfer_us: 99,
      deliver_us: null,
      chunks: 0,
    }),
    "serve_plus_path",
    "chunks===0 excludes transfer from binding",
  );
}

// Re-ask same index → ask_ordinal 0 then 1 in the report
{
  const tap = new Tap({
    arm: "transport-ts",
    stream_mode: "shared",
    copies_per_frame: 1,
  });
  const frameIndex = 5;
  function fodRequest(frame: number): Uint8Array {
    const enc = new TextEncoder();
    const body = enc.encode(JSON.stringify({ op: "request_frame", frame }));
    const fod = new Uint8Array(4 + body.length);
    new DataView(fod.buffer).setUint32(0, body.length, true);
    fod.set(body, 4);
    return fod;
  }
  function mediaFor(idx: number): Uint8Array {
    const m = new Uint8Array(12);
    new DataView(m.buffer).setUint32(0, 8, false);
    new DataView(m.buffer).setUint32(4, idx, false);
    return m;
  }
  for (let n = 0; n < 2; n++) {
    tap.gesture(frameIndex);
    tap.onControlWrite(fodRequest(frameIndex));
    tap.onAskFlush();
    const sid = tap.nextStreamId();
    tap.onMediaRead(sid, mediaFor(frameIndex));
    tap.onDelivered(frameIndex);
  }
  const report = tap.finish();
  const rows = report.client_frames.filter((r) => r.frame_index === frameIndex);
  assertEq(rows.length, 2, "two rows for re-asked frame");
  assertEq(rows[0].ask_ordinal, 0, "first ask ordinal 0");
  assertEq(rows[1].ask_ordinal, 1, "second ask ordinal 1");
}

// empty sample → null distribution (null ≠ 0)
{
  assertEq(distributionStats([]), null, "empty distributionStats is null");
}

// frame-0-only ondemand: rows present, distributions absent
{
  const tap = new Tap({
    arm: "transport-ts",
    stream_mode: "shared",
    copies_per_frame: 1,
  });
  const frameIndex = 0;
  const enc = new TextEncoder();
  const body = enc.encode(JSON.stringify({ op: "request_frame", frame: frameIndex }));
  const fod = new Uint8Array(4 + body.length);
  new DataView(fod.buffer).setUint32(0, body.length, true);
  fod.set(body, 4);
  tap.gesture(frameIndex);
  tap.onControlWrite(fod);
  tap.onAskFlush();
  const sid = tap.nextStreamId();
  const media = new Uint8Array(12);
  new DataView(media.buffer).setUint32(0, 8, false);
  new DataView(media.buffer).setUint32(4, frameIndex, false);
  tap.onMediaRead(sid, media);
  tap.onDelivered(frameIndex);
  const report = tap.finish();
  assertEq(report.client_frames.length, 1, "frame0 row kept in client_frames");
  assertEq(report.summary.distributions.queue, null, "frame0 excluded → queue dist null");
  assertEq(report.summary.distributions.bytes, null, "frame0 excluded → bytes dist null");
  assertEq(report.summary.headline.ask_to_first_frame_complete_us, null, "headline null without usable");
  assertEq(report.summary.binding.none, 0, "frame0 excluded from binding rollup");
}

// first write wins; mark after close increments → invalid
{
  const tap = new Tap({
    arm: "transport-ts",
    stream_mode: "per-frame",
    copies_per_frame: 1,
  });
  const frameIndex = 2;
  const enc = new TextEncoder();
  const body = enc.encode(JSON.stringify({ op: "request_frame", frame: frameIndex }));
  const fod = new Uint8Array(4 + body.length);
  new DataView(fod.buffer).setUint32(0, body.length, true);
  fod.set(body, 4);
  tap.onControlWrite(fod);
  const sid = tap.nextStreamId();
  const media = new Uint8Array(12);
  new DataView(media.buffer).setUint32(0, 8, false);
  new DataView(media.buffer).setUint32(4, frameIndex, false);
  tap.onMediaRead(sid, media);
  tap.onDelivered(frameIndex);
  const before = tap.integrity.marks_after_close;
  tap.onDelivered(frameIndex);
  assert(
    tap.integrity.marks_after_close === before + 1,
    "mark after close increments marks_after_close",
  );
  const report = tap.finish();
  assertEq(report.summary.integrity.valid, true, "marks_after_close alone does not void");
  assert(
    report.summary.integrity.marks_after_close > 0,
    "marks_after_close still recorded for the reader",
  );
}

// preload closes at last_byte without paint; interaction at delivered
{
  const tap = new Tap({
    arm: "transport-ts",
    stream_mode: "shared",
    copies_per_frame: 1,
  });
  const enc = new TextEncoder();
  const body = enc.encode(JSON.stringify({ op: "request_frames", frames: [3, 4] }));
  const fod = new Uint8Array(4 + body.length);
  new DataView(fod.buffer).setUint32(0, body.length, true);
  fod.set(body, 4);
  tap.gesture();
  tap.onControlWrite(fod);
  const sid = tap.nextStreamId();
  function frameBytes(idx: number): Uint8Array {
    const m = new Uint8Array(12);
    new DataView(m.buffer).setUint32(0, 8, false);
    new DataView(m.buffer).setUint32(4, idx, false);
    return m;
  }
  tap.onMediaRead(sid, frameBytes(3));
  tap.onMediaRead(sid, frameBytes(4));
  const report = tap.finish();
  assertEq(report.summary.report_mode, "fill", "preload → fill mode");
  for (const r of report.client_frames) {
    assertEq(r.kind, "preload", "row kind preload");
    assertEq(r.closed_at, "last_byte", "preload closed_at last_byte");
  }
  assertEq(report.summary.integrity.valid, true, "preload fill run valid");
}

// parse footprints
{
  const buf = new Uint8Array(12 + 12);
  new DataView(buf.buffer).setUint32(0, 8, false);
  new DataView(buf.buffer).setUint32(4, 7, false);
  new DataView(buf.buffer, 12).setUint32(0, 8, false);
  new DataView(buf.buffer, 12).setUint32(4, 8, false);
  const { footprints, consumed } = parseFootprintsFromBytes(buf);
  assertEq(consumed, 24, "consumed both frames");
  assertEq(footprints.length, 2, "two footprints");
  assertEq(footprints[0].frame_index, 7, "index 7");
  assertEq(footprints[1].frame_index, 8, "index 8");
}

// distributionStats smoke + min/max helpers
{
  const d = distributionStats([10, 20, 30, 40, 50]);
  assert(d.count === 5, "dist count");
  assert(d.p50 === nearestRank([10, 20, 30, 40, 50], 50), "p50 nearest-rank");
  assertEq(minOf([3, 1, 2]), 1, "minOf");
  assertEq(maxOf([3, 1, 2]), 3, "maxOf");
  assertEq(minOf([]), null, "minOf empty");
}

// judgeIntegrity unit
{
  const j = judgeIntegrity({
    rows_opened: 2,
    rows_closed: 1,
    rows_dropped: 0,
    marks_after_close: 0,
    first_write_conflicts: 0,
    byte_closure_ok: true,
    long_tasks: 0,
    clock_resolution_us: 5,
    clock_probe_us: 100,
    cross_origin_isolated: true,
  });
  assertEq(j.valid, false, "judge: open!=closed invalid");
  assert(j.invalid_reasons[0].includes("rows_opened"), "judge: reason text");
}

// Recorder cost smoke: 100 frames × ~250KB river in 48KB reads should stay sub-100ms
{
  const specs = [];
  for (let i = 0; i < 100; i++) specs.push({ index: i, codestreamLen: 250_000 });
  const river = buildRiver(specs);
  const attr = new StreamAttributor();
  const t0 = performance.now();
  const step = 48 * 1024;
  let off = 0;
  let tUs = 0;
  while (off < river.length) {
    const end = Math.min(river.length, off + step);
    tUs += 1;
    attr.onRead(river.subarray(off, end), tUs);
    off = end;
  }
  const ms = performance.now() - t0;
  assert(attr.finished.length === 100, "bench: 100 frames attributed");
  assert(attr.closureOk(), "bench: closure ok");
  assert(ms < 100, `bench: streaming cost ${ms.toFixed(1)}ms < 100ms (was seconds with concat path)`);
}

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nall tests passed");
