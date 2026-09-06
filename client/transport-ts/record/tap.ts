/** Core tap — coordinates stamps, rows, attribution, and the report. */

import { StreamAttributor } from "./attribution.ts";
import { nowUs, probeClockResolution, watchLongTasks, type LongTaskSpan } from "./clock.ts";
import { MessageAccumulator, parseFodAsks } from "./parse.ts";
import { assembleReport } from "./report.ts";
import { createOpenRow, DeliveredLater, OpenRowIndex, stampsPresent } from "./rows.ts";
import type {
  ClosedAt,
  Integrity,
  OpenRow,
  RowKind,
  TapConfig,
  TelemetryReport,
  Us,
} from "./types.ts";

export const DEFAULT_RING_CAPACITY = 4096;

export class Tap {
  readonly config: TapConfig;
  private install_t0_ms: number;
  private first_ask_ms: number | null = null;
  private ordinals = new Map<number, number>();
  private openIndex = new OpenRowIndex();
  private deliveredLater = new DeliveredLater();
  /** Closed rows in close order; converted to report rows at finish() so late marks can land. */
  private closedRows: OpenRow[] = [];
  private attributors = new Map<number, StreamAttributor>();
  private streamSeq = 0;
  private pendingGestures = new Map<number, Us>();
  private bulkGesture: Us | null = null;
  private report: TelemetryReport | null = null;
  /** Control downlink bytes → FoD messages (refusals). */
  private controlIn = new MessageAccumulator();
  private longTaskSpans: LongTaskSpan[] = [];
  private stopLongTasks: () => LongTaskSpan[] = () => [];
  /** Wall cost of each onMediaRead, µs — the recorder timing itself. */
  private readCosts: number[] = [];

  integrity: Integrity = {
    rows_opened: 0,
    rows_closed: 0,
    rows_dropped: 0,
    ring_evictions: 0,
    marks_after_close: 0,
    first_write_conflicts: 0,
    byte_closure_ok: true,
    long_tasks: 0,
    long_task_total_us: 0,
    long_tasks_outside_window: 0,
    busy_rows_excluded: 0,
    clock_resolution_us: null,
    clock_probe_us: null,
    cross_origin_isolated: null,
    tap_read_cost_us: null,
    open_rows: [],
  };

  constructor(config: TapConfig) {
    this.config = config;
    this.install_t0_ms = performance.now();
    this.integrity.cross_origin_isolated =
      typeof globalThis.crossOriginIsolated === "boolean"
        ? globalThis.crossOriginIsolated
        : null;
    // Clock probe runs at finish() — not here — so it cannot inflate connect_ms.
    this.stopLongTasks = watchLongTasks((span) => this.longTaskSpans.push(span));
  }

  /** Harness: intent to show one frame, or bulk T0 when frameIndex is omitted. */
  gesture(frameIndex?: number) {
    const t = nowUs();
    if (frameIndex == null) {
      this.bulkGesture = t;
      return;
    }
    this.pendingGestures.set(frameIndex, t);
  }

  nextStreamId(): number {
    const id = this.streamSeq++;
    this.attributors.set(id, new StreamAttributor());
    return id;
  }

  /** A main-thread long task on the `performance.now()` clock (tests inject; the observer feeds). */
  noteLongTask(span: LongTaskSpan) {
    this.longTaskSpans.push(span);
  }

  /** `ask` = the control write was called. Stamp first; decoding the message is not the ask. */
  onControlWrite(chunk: Uint8Array) {
    const t = nowUs();
    const asks = parseFodAsks(chunk);
    if (asks.length === 0) return;
    if (this.first_ask_ms == null) {
      this.first_ask_ms = performance.now();
    }
    for (const ask of asks) {
      for (const frame_index of ask.frames) {
        this.openRow(ask.kind, frame_index, t);
      }
    }
  }

  onAskFlush() {
    const t = nowUs();
    for (const row of this.openIndex.rowsNeedingFlush()) {
      row.ask_flush_us = t;
    }
  }

  /** Control downlink: the server refuses with `frame_error`; that closes the row. */
  onControlRead(bytes: Uint8Array) {
    for (const m of this.controlIn.push(bytes)) {
      if (m.op === "frame_error") this.onRefused(m.frame_index, m.reason);
    }
  }

  onRefused(frame_index: number, reason: string) {
    const t = nowUs();
    const row = this.openIndex.findOpen(frame_index);
    if (!row) {
      this.integrity.marks_after_close += 1;
      return;
    }
    row.failed_us = t;
    row.fail_reason = reason;
    this.closeRow(row, "refused");
  }

  /**
   * The public method rejected. A refusal has usually closed the row already (the control
   * stream arrives first), in which case this finds nothing and is not a mark after close.
   */
  onAskFailed(frame_index: number, message: string) {
    const t = nowUs();
    const row = this.openIndex.findOpen(frame_index);
    if (!row) return;
    row.failed_us = t;
    row.fail_reason = message;
    this.closeRow(row, /timeout/i.test(message) ? "timeout" : "error");
  }

  onMediaRead(streamId: number, value: Uint8Array | null | undefined) {
    if (!value || value.length === 0) return;
    const attr = this.attributors.get(streamId);
    if (!attr) return;
    const t = nowUs();
    const costStart = performance.now();
    const newly = attr.onRead(value, t);
    for (const f of newly) {
      this.applyWireTiming(f.frame_index, f.first_byte_us, f.last_byte_us, f.chunks, f.bytes);
    }
    if (attr.isBad) {
      this.integrity.byte_closure_ok = false;
    }
    this.readCosts.push(Math.round((performance.now() - costStart) * 1000));
  }

  private applyWireTiming(
    frame_index: number,
    first_byte_us: number,
    last_byte_us: number,
    chunks: number,
    bytes: number,
  ) {
    const row = this.openIndex.findOpen(frame_index);
    if (!row) {
      this.integrity.rows_dropped += 1;
      return;
    }
    if (row.first_byte_us != null || row.last_byte_us != null) {
      this.integrity.first_write_conflicts += 1;
      return;
    }
    row.first_byte_us = first_byte_us;
    row.last_byte_us = last_byte_us;
    row.chunks = chunks;
    row.bytes = bytes;
    if (row.kind === "preload") {
      this.closeRow(row, "last_byte");
      this.deliveredLater.expect(row);
    }
  }

  /**
   * The app has the bytes. Interaction rows close here; a closed preload row takes the mark as
   * its `deliver` stage. `via: "batch"` = the batch method marked it after the whole batch.
   */
  onDelivered(frame_index: number, via: "single" | "batch" = "single") {
    const t = nowUs();
    const row = this.openIndex.findOpen(frame_index) ?? this.deliveredLater.take(frame_index);
    if (!row) {
      this.integrity.marks_after_close += 1;
      return;
    }
    if (row.delivered_us != null) {
      this.integrity.first_write_conflicts += 1;
      return;
    }
    row.delivered_us = t;
    if (!row.closed && row.kind === "interaction") {
      this.closeRow(row, via === "batch" ? "batch_delivered" : "delivered");
    }
  }

  private openRow(kind: RowKind, frame_index: number, ask_us: Us) {
    const ask_ordinal = this.takeOrdinal(frame_index);
    let gesture_us = this.pendingGestures.get(frame_index) ?? null;
    if (gesture_us == null && kind === "preload") gesture_us = this.bulkGesture;
    this.pendingGestures.delete(frame_index);
    const row = createOpenRow(kind, frame_index, ask_ordinal, gesture_us, ask_us);
    this.openIndex.add(row);
    this.integrity.rows_opened += 1;
  }

  private takeOrdinal(frame_index: number): number {
    const n = this.ordinals.get(frame_index) ?? 0;
    this.ordinals.set(frame_index, n + 1);
    return n;
  }

  private closeRow(row: OpenRow, closed_at: ClosedAt) {
    if (row.closed) {
      this.integrity.marks_after_close += 1;
      return;
    }
    row.closed = true;
    row.closed_at = closed_at;
    this.openIndex.markClosed(row);
    this.integrity.rows_closed += 1;
    if (this.closedRows.length >= this.config.ring_capacity) {
      // The ring is real: a run past capacity says so instead of silently reshaping its means.
      this.integrity.ring_evictions += 1;
      return;
    }
    this.closedRows.push(row);
  }

  /** Finalize and return the report. Idempotent. */
  finish(): TelemetryReport {
    if (this.report) return this.report;
    this.longTaskSpans.push(...this.stopLongTasks());

    const probe = probeClockResolution();
    this.integrity.clock_resolution_us = probe.resolution_us;
    this.integrity.clock_probe_us = probe.probe_cost_us;
    this.integrity.tap_read_cost_us = summarizeReadCosts(this.readCosts);

    for (const attr of this.attributors.values()) {
      if (!attr.closureOk()) {
        this.integrity.byte_closure_ok = false;
      }
    }

    for (const row of this.openIndex.openRows()) {
      if (!row.closed && row.last_byte_us != null && row.kind === "preload") {
        this.closeRow(row, "last_byte");
      }
    }
    // Whatever is still open is why rows_opened != rows_closed; say which and with what.
    this.integrity.open_rows = this.openIndex.openRows().map((r) => ({
      kind: r.kind,
      frame_index: r.frame_index,
      ask_ordinal: r.ask_ordinal,
      have: stampsPresent(r),
    }));

    this.report = assembleReport({
      config: this.config,
      install_t0_ms: this.install_t0_ms,
      first_ask_ms: this.first_ask_ms,
      closedRows: this.closedRows,
      longTasks: this.longTaskSpans,
      integrity: this.integrity,
    });
    // Mirror judgement onto the live integrity object for callers that read tap.integrity.
    this.integrity.valid = this.report.summary.integrity.valid;
    this.integrity.invalid_reasons = this.report.summary.integrity.invalid_reasons;
    return this.report;
  }
}

function summarizeReadCosts(costs: number[]): Integrity["tap_read_cost_us"] {
  if (costs.length === 0) return null;
  const sorted = [...costs].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1];
  return {
    count: sorted.length,
    p50_us: rank(50),
    p99_us: rank(99),
    max_us: sorted[sorted.length - 1],
  };
}

let ACTIVE: Tap | null = null;

export function getTap(): Tap | null {
  return ACTIVE;
}

export function setTap(tap: Tap | null) {
  ACTIVE = tap;
}

export function ensureReport(): TelemetryReport | null {
  return ACTIVE ? ACTIVE.finish() : null;
}
