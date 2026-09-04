/** Core tap — coordinates stamps, rows, attribution, and the report. */

import { StreamAttributor } from "./attribution.ts";
import { nowUs, probeClockResolution, watchLongTasks } from "./clock.ts";
import { parseFodFrames } from "./parse.ts";
import { assembleReport } from "./report.ts";
import { createOpenRow, OpenRowIndex, toClientFrame } from "./rows.ts";
import type {
  ClientFrameRow,
  Integrity,
  OpenRow,
  RowKind,
  TapConfig,
  TelemetryReport,
  Us,
} from "./types.ts";

export class Tap {
  readonly config: TapConfig;
  private install_t0_ms: number;
  private first_ask_ms: number | null = null;
  private ordinals = new Map<number, number>();
  private openIndex = new OpenRowIndex();
  private closedRows: ClientFrameRow[] = [];
  private attributors = new Map<number, StreamAttributor>();
  private streamSeq = 0;
  private pendingGestures = new Map<number, Us>();
  private bulkGesture: Us | null = null;
  private report: TelemetryReport | null = null;
  private longTaskCount = 0;
  private stopLongTasks: () => void = () => {};

  integrity: Integrity = {
    rows_opened: 0,
    rows_closed: 0,
    rows_dropped: 0,
    marks_after_close: 0,
    first_write_conflicts: 0,
    byte_closure_ok: true,
    long_tasks: 0,
    clock_resolution_us: null,
    clock_probe_us: null,
    cross_origin_isolated: null,
  };

  constructor(config: TapConfig) {
    this.config = config;
    this.install_t0_ms = performance.now();
    this.integrity.cross_origin_isolated =
      typeof globalThis.crossOriginIsolated === "boolean"
        ? globalThis.crossOriginIsolated
        : null;
    // Clock probe runs at finish() — not here — so it cannot inflate connect_ms.
    this.stopLongTasks = watchLongTasks((n) => {
      this.longTaskCount = n;
    });
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

  onControlWrite(chunk: Uint8Array) {
    const frames = parseFodFrames(chunk);
    if (!frames || frames.length === 0) return;
    const t = nowUs();
    if (this.first_ask_ms == null) {
      this.first_ask_ms = performance.now();
    }
    const kind: RowKind = frames.length > 1 ? "preload" : "interaction";
    for (const frame_index of frames) {
      this.openRow(kind, frame_index, t);
    }
  }

  onAskFlush() {
    const t = nowUs();
    for (const row of this.openIndex.rowsNeedingFlush()) {
      if (row.ask_flush_us != null) {
        this.integrity.first_write_conflicts += 1;
        continue;
      }
      row.ask_flush_us = t;
    }
  }

  onMediaRead(streamId: number, value: Uint8Array | null | undefined) {
    if (!value || value.length === 0) return;
    const attr = this.attributors.get(streamId);
    if (!attr) return;
    const t = nowUs();
    const newly = attr.onRead(value, t);
    for (const f of newly) {
      this.applyWireTiming(f.frame_index, f.first_byte_us, f.last_byte_us, f.chunks, f.bytes);
    }
    if (attr.isBad) {
      this.integrity.byte_closure_ok = false;
    }
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
    }
  }

  onDelivered(frame_index: number) {
    const t = nowUs();
    const row = this.openIndex.findOpen(frame_index);
    if (!row) {
      this.integrity.marks_after_close += 1;
      return;
    }
    if (row.delivered_us != null) {
      this.integrity.first_write_conflicts += 1;
      return;
    }
    row.delivered_us = t;
    if (row.kind === "interaction") {
      this.closeRow(row, "delivered");
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

  private closeRow(row: OpenRow, closed_at: "last_byte" | "delivered") {
    if (row.closed) {
      this.integrity.marks_after_close += 1;
      return;
    }
    row.closed = true;
    row.closed_at = closed_at;
    this.openIndex.markClosed(row);
    this.integrity.rows_closed += 1;
    this.closedRows.push(toClientFrame(row));
  }

  /** Finalize and return the report. Idempotent. */
  finish(): TelemetryReport {
    if (this.report) return this.report;
    this.integrity.long_tasks = this.longTaskCount;
    this.stopLongTasks();

    const probe = probeClockResolution();
    this.integrity.clock_resolution_us = probe.resolution_us;
    this.integrity.clock_probe_us = probe.probe_cost_us;

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

    this.report = assembleReport({
      config: this.config,
      install_t0_ms: this.install_t0_ms,
      first_ask_ms: this.first_ask_ms,
      closedRows: this.closedRows,
      integrity: this.integrity,
    });
    // Mirror judgement onto the live integrity object for callers that read tap.integrity.
    this.integrity.valid = this.report.summary.integrity.valid;
    this.integrity.invalid_reasons = this.report.summary.integrity.invalid_reasons;
    return this.report;
  }
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
