/**
 * Unit tests for record/ — run with:
 *   node --experimental-strip-types client/transport-ts/record/test/run.mjs
 * or after esbuild of test bundle.
 */

import { attributeFrames } from "../offsets.ts";
import { nearestRank, distributionStats } from "../percentiles.ts";
import { parseFootprintsFromBytes } from "../parse.ts";
import { Tap } from "../tap.ts";

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

// §5.1 example
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

// truncated log → byte_closure_ok false
{
  const chunks = [{ t_us: 1, cum: 50 }];
  const footprints = [{ frame_index: 0, start: 0, end: 108, bytes: 100 }];
  const { byte_closure_ok } = attributeFrames(chunks, footprints);
  assert(!byte_closure_ok, "truncated chunk log fails byte closure");
}

// nearest-rank where interpolation disagrees
{
  // N=10, p95: nearest-rank rank=ceil(9.5)=10 → sorted[9]
  // linear (old server): (N-1)*0.95 = 8.55 → interpolate sorted[8] and sorted[9]
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  assertEq(nearestRank(sorted, 95), 100, "nearest-rank p95 picks last");
  const linearRank = (sorted.length - 1) * 0.95;
  const lo = Math.floor(linearRank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const linear =
    sorted[lo] + (sorted[hi] - sorted[lo]) * (linearRank - lo);
  assert(linear !== 100, "linear interpolation differs from nearest-rank on this vector");
}

// Null ≠ 0 and binding_term excludes transfer when chunks==1
{
  const tap = new Tap({
    arm: "transport-ts",
    stream_mode: "shared",
    copies_per_frame: 1,
  });
  // Manual row path via control write + synthetic media
  const frameIndex = 1;
  const enc = new TextEncoder();
  const body = enc.encode(JSON.stringify({ op: "request_frame", frame: frameIndex }));
  const fod = new Uint8Array(4 + body.length);
  new DataView(fod.buffer).setUint32(0, body.length, true);
  fod.set(body, 4);
  tap.gesture(frameIndex);
  tap.onControlWrite(fod);
  tap.onAskFlush();

  // One media frame: len=8 (4 index + 4 bytes), footprint 12
  const sid = tap.nextStreamId();
  const media = new Uint8Array(12);
  new DataView(media.buffer).setUint32(0, 8, false); // len
  new DataView(media.buffer).setUint32(4, frameIndex, false); // index
  media[8] = 1;
  media[9] = 2;
  media[10] = 3;
  media[11] = 4;
  tap.onMediaRead(sid, media); // single chunk → chunks==1, transfer==0
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
}

// first write wins; mark after close increments
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

// distributionStats smoke
{
  const d = distributionStats([10, 20, 30, 40, 50]);
  assert(d.count === 5, "dist count");
  assert(d.p50 === nearestRank([10, 20, 30, 40, 50], 50), "p50 nearest-rank");
}

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nall tests passed");
