/**
 * Unit tests for record/ — run with:
 *   bash client/transport-ts/build.sh && node client/transport-ts/record/test/run.mjs
 * or: node --experimental-strip-types client/transport-ts/record/test/run.ts
 */

import { StreamAttributor } from "../attribution.ts";
import { attributeFrames } from "../offsets.ts";
import { nearestRank, distributionStats } from "../percentiles.ts";
import { MessageAccumulator, parseFodAsks, parseFootprintsFromBytes } from "../parse.ts";
import { judgeIntegrity, minOf, maxOf } from "../report.ts";
import { pickBinding } from "../rows.ts";
import { Tap } from "../tap.ts";
import type { ChunkMark, TapConfig } from "../types.ts";

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

function cfg(over: Partial<TapConfig> = {}): TapConfig {
  return {
    arm: "transport-ts",
    stream_mode: "shared",
    copies_per_frame_declared: 1,
    copies_source: "test",
    ring_capacity: 4096,
    ...over,
  };
}

function fod(msg: object): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(msg));
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}

function fodRequest(frame: number): Uint8Array {
  return fod({ op: "request_frame", frame });
}

function fodBatch(frames: number[]): Uint8Array {
  return fod({ op: "request_frames", frames });
}

/** One wire frame: `[len=4+n][index][n bytes]`. */
function mediaFor(idx: number, n = 4): Uint8Array {
  const m = new Uint8Array(8 + n);
  new DataView(m.buffer).setUint32(0, 4 + n, false);
  new DataView(m.buffer).setUint32(4, idx, false);
  return m;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
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
  return concat(frames.map((f) => mediaFor(f.index, f.codestreamLen)));
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

  const tap = new Tap(cfg());
  tap.onControlWrite(fodRequest(1));
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

// Shared fixture with server and window-harness: N = 20, p95 → sorted[18] = 19
{
  const v = [...Array(19).keys()].map((i) => i + 1);
  v.push(100);
  assertEq(nearestRank(v, 95), 19, "nearest-rank p95 on the N=20 shared vector");
}

// Null ≠ 0 and binding_term excludes transfer when chunks==1
{
  const tap = new Tap(cfg());
  assertEq(tap.integrity.clock_resolution_us, null, "clock probe not run in constructor");
  // Two asks so the second is usable (the first ask is always set aside).
  tap.gesture(9);
  tap.onControlWrite(fodRequest(9));
  tap.onAskFlush();
  const sid0 = tap.nextStreamId();
  tap.onMediaRead(sid0, mediaFor(9));
  tap.onDelivered(9);

  const frameIndex = 1;
  tap.gesture(frameIndex);
  tap.onControlWrite(fodRequest(frameIndex));
  tap.onAskFlush();
  const sid = tap.nextStreamId();
  tap.onMediaRead(sid, mediaFor(frameIndex)); // single chunk → chunks==1, transfer==0
  tap.onDelivered(frameIndex);
  const report = tap.finish();
  const row = report.client_frames.find((r) => r.frame_index === frameIndex)!;
  assert(row.decode_us === null, "decode_us is null not 0");
  assert(row.decode_wait_us === null, "decode_wait_us is null");
  assert(row.paint_us === null, "paint_us is null");
  assertEq(row.chunks, 1, "single-chunk frame");
  assertEq(row.transfer_us, 0, "transfer is 0 when first==last");
  assert(row.binding_term !== "transfer", "transfer excluded from binding_term when chunks==1");
  assert(row.ask_flush_us != null && row.ask_flush_us >= 0, "ask_flush_us exported per row");
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
  assertEq(report.summary.copies.copies_per_frame_declared, 1, "copies declared, named so");
  assertEq(report.summary.copies.copies_source, "test", "copies source carried");
  assert(report.summary.binding != null, "binding rollup present");
  assert(report.summary.integrity.clock_probe_us != null, "clock probe cost recorded at finish");
  assert(report.summary.integrity.clock_resolution_us != null, "clock resolution set at finish");
  const cost = report.summary.integrity.tap_read_cost_us;
  assert(cost != null && cost.count === 2 && cost.max_us >= cost.p50_us, "tap_read_cost_us summarised");
  assertEq(report.summary.integrity.valid, true, "clean run valid");
  assertEq(report.summary.integrity.invalid_reasons, [], "clean run no reasons");
  assertEq(report.run_end.ring_capacity, 4096, "ring capacity reported is the configured one");
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
  const tap = new Tap(cfg());
  const frameIndex = 5;
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

// First ask is set aside by ask ORDER, not by frame index 0
{
  const tap = new Tap(cfg());
  // Ask frame 40 first, then frame 0.
  for (const idx of [40, 0]) {
    tap.gesture(idx);
    tap.onControlWrite(fodRequest(idx));
    const sid = tap.nextStreamId();
    tap.onMediaRead(sid, mediaFor(idx));
    tap.onDelivered(idx);
  }
  const report = tap.finish();
  assertEq(report.client_frames.length, 2, "both rows kept in client_frames");
  assertEq(report.summary.first_ask_row?.frame_index, 40, "first_ask_row is the earliest ask (frame 40)");
  assertEq(report.summary.distributions.bytes?.count, 1, "one usable row after setting the first ask aside");
  assertEq(report.summary.binding.none + report.summary.binding.serve_plus_path + report.summary.binding.deliver + report.summary.binding.queue + report.summary.binding.transfer, 1, "binding rollup counts one usable row");
}

// Single-ask on-demand run: the only row is the first ask → no usable sample, honestly null
{
  const tap = new Tap(cfg());
  tap.gesture(0);
  tap.onControlWrite(fodRequest(0));
  tap.onAskFlush();
  const sid = tap.nextStreamId();
  tap.onMediaRead(sid, mediaFor(0));
  tap.onDelivered(0);
  const report = tap.finish();
  assertEq(report.client_frames.length, 1, "single row kept in client_frames");
  assertEq(report.summary.first_ask_row?.frame_index, 0, "first_ask_row present");
  assertEq(report.summary.distributions.queue, null, "no usable rows → queue dist null");
  assertEq(report.summary.headline.ask_to_first_frame_complete_us, null, "headline null without usable");
}

// Marks with no row at all still count; a duplicate delivered is a first-write conflict
{
  const tap = new Tap(cfg({ stream_mode: "per-frame" }));
  const frameIndex = 2;
  tap.onControlWrite(fodRequest(frameIndex));
  const sid = tap.nextStreamId();
  tap.onMediaRead(sid, mediaFor(frameIndex));
  tap.onDelivered(frameIndex);
  const before = tap.integrity.marks_after_close;
  tap.onDelivered(77); // never asked
  assert(tap.integrity.marks_after_close === before + 1, "mark with no row increments marks_after_close");
  tap.onDelivered(frameIndex); // already closed and gone: a mark with no row
  assert(tap.integrity.marks_after_close === before + 2, "second delivered on a closed interaction row is a mark with no row");
  const report = tap.finish();
  assertEq(report.summary.integrity.valid, true, "marks_after_close alone does not void");
  assert(report.summary.integrity.marks_after_close === 2, "marks_after_close still recorded for the reader");
}

// Fill: preload rows close at last_byte, then take `delivered` as their deliver stage
{
  const tap = new Tap(cfg());
  tap.gesture();
  tap.onControlWrite(fodBatch([3, 4, 5]));
  const sid = tap.nextStreamId();
  tap.onMediaRead(sid, mediaFor(3));
  tap.onMediaRead(sid, mediaFor(4));
  tap.onMediaRead(sid, mediaFor(5));
  // The harness's waitExactFrame marks each one after the row already closed.
  tap.onDelivered(3);
  tap.onDelivered(4);
  tap.onDelivered(5);
  const report = tap.finish();
  assertEq(report.summary.report_mode, "fill", "preload → fill mode");
  for (const r of report.client_frames) {
    assertEq(r.kind, "preload", "row kind preload");
    assertEq(r.closed_at, "last_byte", "preload closed_at last_byte");
    assert(r.deliver_us != null && r.deliver_us >= 0, `preload row ${r.frame_index} carries deliver_us`);
    assertEq(r.total_spans, "gesture_to_last_byte", "preload total still spans to last_byte");
  }
  assertEq(report.summary.integrity.marks_after_close, 0, "late delivered marks are not marks after close");
  assert(report.summary.distributions.deliver != null && report.summary.distributions.deliver.count === 2, "fill has a deliver distribution over usable rows");
  assert(report.summary.fill_queue_us != null, "fill_queue_us reported once");
  assertEq(report.summary.distributions.queue, null, "queue distribution excludes preload rows");
  assertEq(report.summary.integrity.valid, true, "preload fill run valid");
}

// Row kind comes from the op: request_frames with ONE index is still preload
{
  const tap = new Tap(cfg());
  tap.gesture();
  tap.onControlWrite(fodBatch([6]));
  const sid = tap.nextStreamId();
  tap.onMediaRead(sid, mediaFor(6));
  const report = tap.finish();
  assertEq(report.client_frames[0].kind, "preload", "single-index request_frames is preload");
  assertEq(report.summary.ask_granularity, "request_frames_batch", "granularity follows the op");
}

// Two FoD messages in one control write open two rows
{
  const tap = new Tap(cfg());
  tap.onControlWrite(concat([fodRequest(1), fodRequest(2)]));
  assertEq(tap.integrity.rows_opened, 2, "both asks in one write are rows");
  const asks = parseFodAsks(concat([fodRequest(1), fodBatch([2, 3])]));
  assertEq(asks.map((a) => a.kind), ["interaction", "preload"], "kinds per message");
}

// Batch-method delivery closes rows as batch_delivered
{
  const tap = new Tap(cfg());
  tap.onControlWrite(fodRequest(8));
  const sid = tap.nextStreamId();
  tap.onMediaRead(sid, mediaFor(8));
  tap.onDelivered(8, "batch");
  const report = tap.finish();
  assertEq(report.client_frames[0].closed_at, "batch_delivered", "batch delivery is named");
}

// Ring capacity is enforced and evictions void the run
{
  const tap = new Tap(cfg({ ring_capacity: 2 }));
  for (const idx of [1, 2, 3]) {
    tap.onControlWrite(fodRequest(idx));
    const sid = tap.nextStreamId();
    tap.onMediaRead(sid, mediaFor(idx));
    tap.onDelivered(idx);
  }
  const report = tap.finish();
  assertEq(report.client_frames.length, 2, "third closed row evicted");
  assertEq(report.summary.integrity.ring_evictions, 1, "eviction counted");
  assertEq(report.summary.integrity.rows_closed, 3, "rows_closed still counts the evicted row");
  assertEq(report.run_end.dropped_records, 1, "run_end dropped_records includes evictions");
  assertEq(report.run_end.ring_capacity, 2, "configured ring capacity reported");
  assertEq(report.summary.integrity.valid, false, "evictions void the run");
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
  assert(d!.count === 5, "dist count");
  assert(d!.p50 === nearestRank([10, 20, 30, 40, 50], 50), "p50 nearest-rank");
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
    ring_evictions: 0,
    marks_after_close: 0,
    first_write_conflicts: 0,
    byte_closure_ok: true,
    long_tasks: 0,
    clock_resolution_us: 5,
    clock_probe_us: 100,
    cross_origin_isolated: true,
    tap_read_cost_us: null,
    long_task_total_us: 0,
    long_tasks_outside_window: 0,
    busy_rows_excluded: 0,
    open_rows: [],
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


// Refusal on the control downlink closes the row; the run stays whole
{
  const tap = new Tap(cfg());
  tap.onControlWrite(fodRequest(1));
  tap.onControlWrite(fodRequest(99));
  const sid = tap.nextStreamId();
  tap.onMediaRead(sid, mediaFor(1));
  tap.onDelivered(1);
  // Server: {op:"frame_error", frame_index:99, reason} — split across two reads.
  const err = fod({ op: "frame_error", frame_index: 99, reason: "frame index 99 out of range (3)" });
  tap.onControlRead(err.subarray(0, 7));
  tap.onControlRead(err.subarray(7));
  // The product then rejects the ask; the wrapper reports it — no open row, ignored.
  tap.onAskFailed(99, "frame 99 unavailable: frame index 99 out of range (3)");
  const report = tap.finish();
  const refused = report.client_frames.find((r) => r.frame_index === 99)!;
  assertEq(refused.closed_at, "refused", "refused row closed_at refused");
  assert((refused.fail_reason ?? "").includes("out of range"), "refusal reason carried");
  assertEq(refused.serve_plus_path_us, null, "refused row has no stages");
  assertEq(report.summary.integrity.rows_opened, report.summary.integrity.rows_closed, "refusal closes its row");
  assertEq(report.summary.integrity.marks_after_close, 0, "the wrapper's failure report is not a mark after close");
  assertEq(report.summary.integrity.valid, true, "a refused frame does not void the run");
  assertEq(report.summary.outcomes.refused, 1, "outcomes count the refusal");
  assertEq(report.summary.outcomes.delivered, 1, "outcomes count the delivery");
  assertEq(report.summary.distributions.bytes, null, "refused row not usable; the other is the first ask");
}

// A timeout rejection closes the row as timeout; another error as error
{
  const tap = new Tap(cfg());
  tap.onControlWrite(fodRequest(5));
  tap.onAskFailed(5, "timeout waiting for frame 5 after 15000 ms");
  tap.onControlWrite(fodRequest(6));
  tap.onAskFailed(6, "session closed");
  const report = tap.finish();
  assertEq(report.client_frames.map((r) => r.closed_at), ["timeout", "error"], "timeout and error named");
  assertEq(report.summary.integrity.valid, true, "failures close rows; the run is whole");
}

// Rows still open at finish are listed with the stamps they have
{
  const tap = new Tap(cfg());
  tap.gesture(3);
  tap.onControlWrite(fodRequest(3));
  tap.onAskFlush();
  const report = tap.finish();
  assertEq(report.summary.integrity.valid, false, "open row voids the run");
  assertEq(report.summary.integrity.open_rows, [{ kind: "interaction", frame_index: 3, ask_ordinal: 0, have: ["gesture", "ask", "ask_flush"] }], "open_rows says which row and what it has");
}

// Long tasks: windowed to the run; overlapping rows are flagged and set aside
{
  const tap = new Tap(cfg());
  const t0 = performance.now();
  // A compile-like long task well before the first ask must not count.
  tap.noteLongTask({ start_us: Math.round((t0 - 5000) * 1000), end_us: Math.round((t0 - 4900) * 1000) });
  for (const idx of [1, 2, 3]) {
    tap.gesture(idx);
    tap.onControlWrite(fodRequest(idx));
    const sid = tap.nextStreamId();
    tap.onMediaRead(sid, mediaFor(idx));
    tap.onDelivered(idx);
  }
  // A long task covering the whole run (all rows overlap it).
  const tEnd = performance.now();
  tap.noteLongTask({ start_us: Math.round((t0 - 1) * 1000), end_us: Math.round((tEnd + 1) * 1000) });
  const report = tap.finish();
  assertEq(report.summary.integrity.long_tasks, 1, "only the in-window long task counts");
  assertEq(report.summary.integrity.long_tasks_outside_window, 1, "the pre-ask one is reported outside");
  assert(report.summary.integrity.long_task_total_us > 0, "overlap total recorded");
  assert(report.client_frames.every((r) => r.main_thread_busy_us > 0), "every row carries its busy overlap");
  assertEq(report.summary.integrity.busy_rows_excluded, 2, "the two non-first rows are set aside");
  assertEq(report.summary.distributions.bytes, null, "no usable rows remain");
  assertEq(report.summary.integrity.valid, true, "busy rows do not void; they are excluded and counted");
}

// Long task disjoint from the run: nothing flagged
{
  const tap = new Tap(cfg());
  for (const idx of [1, 2]) {
    tap.onControlWrite(fodRequest(idx));
    const sid = tap.nextStreamId();
    tap.onMediaRead(sid, mediaFor(idx));
    tap.onDelivered(idx);
  }
  const later = performance.now() + 10_000;
  tap.noteLongTask({ start_us: Math.round(later * 1000), end_us: Math.round((later + 60) * 1000) });
  const report = tap.finish();
  assertEq(report.summary.integrity.long_tasks, 0, "disjoint long task not counted in window");
  assertEq(report.summary.integrity.busy_rows_excluded, 0, "no rows set aside");
  assertEq(report.summary.distributions.bytes?.count, 1, "the non-first row is usable");
}

// MessageAccumulator reassembles split control messages
{
  const acc = new MessageAccumulator();
  const a = fod({ op: "frame_error", frame_index: 1, reason: "x" });
  const b = fodRequest(2);
  const all = concat([a, b]);
  const first = acc.push(all.subarray(0, 5));
  assertEq(first.length, 0, "partial message yields nothing");
  const rest = acc.push(all.subarray(5));
  assertEq(rest.map((m) => m.op), ["frame_error", "request_frame"], "both messages after the rest arrives");
}

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nall tests passed");
