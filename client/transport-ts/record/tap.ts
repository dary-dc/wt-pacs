/** Core tap — owns stamps, rows, and the report artifact. */

import { attributeFrames } from "./offsets.ts";
import { parseFodFrames, parseFootprintsFromBytes } from "./parse.ts";
import { distributionStats } from "./percentiles.ts";
import type {
  ChunkMark,
  ClientFrameRow,
  Integrity,
  OpenRow,
  RowKind,
  TapConfig,
  TelemetryReport,
  Us,
} from "./types.ts";

const RING_CAPACITY = 4096;

function nowUs(): Us {
  return Math.round(performance.now() * 1000);
}

export class Tap {
  readonly config: TapConfig;
  private install_t0_ms: number;
  private first_ask_ms: number | null = null;
  private ordinals = new Map<number, number>();
  private rows: OpenRow[] = [];
  private closedRows: ClientFrameRow[] = [];
  private streamBytes = new Map<number, Uint8Array[]>();
  private streamCum = new Map<number, number>();
  private streamChunks = new Map<number, ChunkMark[]>();
  private streamAttributed = new Map<number, number>();
  private streamSeq = 0;
  private pendingGestures = new Map<number, Us>();
  private bulkGesture: Us | null = null;
  private report: TelemetryReport | null = null;
  private longTaskCount = 0;
  private observer: PerformanceObserver | null = null;

  integrity: Integrity = {
    rows_opened: 0,
    rows_closed: 0,
    rows_dropped: 0,
    marks_after_close: 0,
    first_write_conflicts: 0,
    byte_closure_ok: true,
    long_tasks: 0,
    clock_resolution_us: null,
    cross_origin_isolated: null,
  };

  constructor(config: TapConfig) {
    this.config = config;
    this.install_t0_ms = performance.now();
    this.integrity.cross_origin_isolated =
      typeof globalThis.crossOriginIsolated === "boolean"
        ? globalThis.crossOriginIsolated
        : null;
    this.measureClockResolution();
    this.watchLongTasks();
  }

  private measureClockResolution() {
    const samples: number[] = [];
    let prev = performance.now();
    for (let i = 0; i < 50_000; i++) {
      const t = performance.now();
      const d = t - prev;
      if (d > 0) samples.push(d);
      prev = t;
    }
    samples.sort((a, b) => a - b);
    this.integrity.clock_resolution_us =
      samples.length === 0 ? null : Math.round(samples[0] * 1000);
  }

  private watchLongTasks() {
    try {
      if (typeof PerformanceObserver === "undefined") return;
      this.observer = new PerformanceObserver((list) => {
        this.longTaskCount += list.getEntries().length;
      });
      this.observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    } catch {
      /* longtask not available */
    }
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
    this.streamBytes.set(id, []);
    this.streamCum.set(id, 0);
    this.streamChunks.set(id, []);
    this.streamAttributed.set(id, 0);
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
    for (const row of this.rows) {
      if (!row.closed && row.ask_us != null && row.ask_flush_us == null) {
        if (row.ask_flush_us != null) {
          this.integrity.first_write_conflicts += 1;
          continue;
        }
        row.ask_flush_us = t;
      }
    }
  }

  onMediaRead(streamId: number, value: Uint8Array | null | undefined) {
    if (!value || value.length === 0) return;
    const t = nowUs();
    const parts = this.streamBytes.get(streamId);
    const chunks = this.streamChunks.get(streamId);
    if (!parts || !chunks) return;
    parts.push(value);
    const cum = (this.streamCum.get(streamId) ?? 0) + value.length;
    this.streamCum.set(streamId, cum);
    chunks.push({ t_us: t, cum });
    this.tryAttributeStream(streamId);
  }

  private tryAttributeStream(streamId: number) {
    const parts = this.streamBytes.get(streamId);
    const chunks = this.streamChunks.get(streamId);
    if (!parts || !chunks) return;
    const buf = concat(parts);
    const { footprints } = parseFootprintsFromBytes(buf);
    const already = this.streamAttributed.get(streamId) ?? 0;
    if (footprints.length <= already) return;

    const { frames, byte_closure_ok } = attributeFrames(chunks, footprints);
    // Closure is only decisive when every parsed footprint is covered and the
    // buffer has no trailing truncated frame; partial buffers stay pending.
    const { consumed } = parseFootprintsFromBytes(buf);
    if (consumed === buf.length && !byte_closure_ok) {
      this.integrity.byte_closure_ok = false;
    }

    for (let i = already; i < footprints.length; i++) {
      const fp = footprints[i];
      const f = frames.find(
        (x) => x.frame_index === fp.frame_index && x.start === fp.start && x.end === fp.end,
      );
      if (!f) continue;
      this.applyWireTiming(f.frame_index, f.first_byte_us, f.last_byte_us, f.chunks, f.bytes);
    }
    this.streamAttributed.set(streamId, footprints.length);
  }

  private applyWireTiming(
    frame_index: number,
    first_byte_us: number,
    last_byte_us: number,
    chunks: number,
    bytes: number,
  ) {
    const row = this.rows.find((r) => r.frame_index === frame_index && !r.closed);
    if (!row) {
      // Late media with no open row — drop.
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
    const row = this.rows.find((r) => r.frame_index === frame_index && !r.closed);
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
    const row: OpenRow = {
      kind,
      frame_index,
      ask_ordinal,
      gesture_us,
      ask_us,
      ask_flush_us: null,
      first_byte_us: null,
      last_byte_us: null,
      delivered_us: null,
      bytes: null,
      chunks: null,
      closed: false,
      closed_at: null,
    };
    this.rows.push(row);
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
    this.integrity.rows_closed += 1;
    this.closedRows.push(this.toClientFrame(row));
  }

  private toClientFrame(row: OpenRow): ClientFrameRow {
    const queue_us =
      row.gesture_us != null && row.ask_us != null ? row.ask_us - row.gesture_us : null;
    const serve_plus_path_us =
      row.ask_us != null && row.first_byte_us != null
        ? row.first_byte_us - row.ask_us
        : null;
    const transfer_us =
      row.first_byte_us != null && row.last_byte_us != null
        ? row.last_byte_us - row.first_byte_us
        : null;
    const deliver_us =
      row.last_byte_us != null && row.delivered_us != null
        ? row.delivered_us - row.last_byte_us
        : null;

    let total_us: number | null = null;
    let total_spans: string | null = null;
    if (row.kind === "preload" && row.gesture_us != null && row.last_byte_us != null) {
      total_us = row.last_byte_us - row.gesture_us;
      total_spans = "gesture_to_last_byte";
    } else if (
      row.kind === "interaction" &&
      row.gesture_us != null &&
      row.delivered_us != null
    ) {
      total_us = row.delivered_us - row.gesture_us;
      total_spans = "gesture_to_delivered";
    } else if (row.kind === "preload" && row.ask_us != null && row.last_byte_us != null) {
      total_us = row.last_byte_us - row.ask_us;
      total_spans = "ask_to_last_byte";
    } else if (
      row.kind === "interaction" &&
      row.ask_us != null &&
      row.delivered_us != null
    ) {
      total_us = row.delivered_us - row.ask_us;
      total_spans = "ask_to_delivered";
    }

    const chunks = row.chunks ?? 0;
    const binding_term = pickBinding({
      queue_us,
      serve_plus_path_us,
      transfer_us,
      deliver_us,
      chunks,
    });

    return {
      kind: row.kind,
      frame_index: row.frame_index,
      ask_ordinal: row.ask_ordinal,
      source: "network",
      queue_us,
      serve_plus_path_us,
      transfer_us,
      deliver_us,
      decode_wait_us: null,
      decode_us: null,
      paint_us: null,
      total_us,
      total_spans,
      closed_at: row.closed_at ?? closedAtFallback(row),
      bytes: row.bytes ?? 0,
      chunks,
      stall: null,
      binding_term,
    };
  }

  /** Finalize and return the report. Idempotent. */
  finish(): TelemetryReport {
    if (this.report) return this.report;
    this.integrity.long_tasks = this.longTaskCount;
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch {
        /* ignore */
      }
    }

    // Close any interaction rows that got last_byte but not delivered (abandoned).
    for (const row of this.rows) {
      if (!row.closed && row.last_byte_us != null && row.kind === "preload") {
        this.closeRow(row, "last_byte");
      }
    }

    const frames = [...this.closedRows].sort(
      (a, b) => a.frame_index - b.frame_index || a.ask_ordinal - b.ask_ordinal,
    );
    const hasPreload = frames.some((f) => f.kind === "preload");
    const report_mode = hasPreload ? "fill" : "ondemand";
    const ask_granularity = hasPreload ? "request_frames_batch" : "request_frame";

    const usable = frames.filter((f) => f.frame_index !== 0);
    const serve = usable
      .map((f) => f.serve_plus_path_us)
      .filter((v): v is number => v != null);

    // ask → complete from stage sums (frame 0 already excluded above)
    const askToComplete = usable.map((f) => askToCompleteUs(f)).filter((v): v is number => v != null);

    const headline = {
      ask_to_first_paint: null,
      ask_to_last_paint: null,
      ask_to_first_frame_complete_us:
        askToComplete.length === 0 ? null : Math.min(...askToComplete),
      ask_to_last_frame_complete_us:
        askToComplete.length === 0 ? null : Math.max(...askToComplete),
      max_serve_plus_path_us: serve.length === 0 ? null : Math.max(...serve),
      first_of_burst_serve_plus_path_us: serve.length === 0 ? null : Math.min(...serve),
    };

    const distKeys = ["queue", "serve_plus_path", "transfer", "deliver", "total", "bytes"] as const;
    const distributions: Record<string, ReturnType<typeof distributionStats>> = {};
    for (const k of distKeys) {
      const vals = usable
        .map((f) => {
          if (k === "queue") return f.queue_us;
          if (k === "serve_plus_path") return f.serve_plus_path_us;
          if (k === "transfer") return f.transfer_us;
          if (k === "deliver") return f.deliver_us;
          if (k === "total") return f.total_us;
          return f.bytes;
        })
        .filter((v): v is number => v != null);
      distributions[k] = distributionStats(vals);
    }

    const meanBytes =
      usable.length === 0
        ? null
        : Math.round(usable.reduce((s, f) => s + f.bytes, 0) / usable.length);

    const connect_ms =
      this.first_ask_ms == null
        ? null
        : Math.round((this.first_ask_ms - this.install_t0_ms) * 1000) / 1000;

    const queueVals = usable.map((f) => f.queue_us).filter((v): v is number => v != null);

    this.report = {
      summary: {
        report_mode,
        arm: this.config.arm,
        stream_mode: this.config.stream_mode,
        ask_granularity,
        stages_present: ["queue", "serve_plus_path", "transfer", "deliver"],
        stages_absent: ["decode_wait", "decode", "paint"],
        connect_ms,
        headline,
        distributions,
        copies: {
          js_heap_bytes_per_frame: meanBytes,
          copies_per_frame: this.config.copies_per_frame,
        },
        preload_to_decode: null,
        cold_start: {
          max_queue_us: queueVals.length === 0 ? null : Math.max(...queueVals),
        },
        integrity: { ...this.integrity },
      },
      client_frames: frames,
      run_end: {
        event: "run_end",
        written_records: frames.length,
        dropped_records: this.integrity.rows_dropped,
        ring_capacity: RING_CAPACITY,
      },
    };
    return this.report;
  }
}

function closedAtFallback(row: OpenRow): "last_byte" | "delivered" {
  return row.kind === "preload" ? "last_byte" : "delivered";
}

function pickBinding(s: {
  queue_us: number | null;
  serve_plus_path_us: number | null;
  transfer_us: number | null;
  deliver_us: number | null;
  chunks: number;
}): string | null {
  const candidates: { name: string; v: number }[] = [];
  if (s.queue_us != null) candidates.push({ name: "queue", v: s.queue_us });
  if (s.serve_plus_path_us != null)
    candidates.push({ name: "serve_plus_path", v: s.serve_plus_path_us });
  if (s.transfer_us != null && s.chunks !== 1)
    candidates.push({ name: "transfer", v: s.transfer_us });
  if (s.deliver_us != null) candidates.push({ name: "deliver", v: s.deliver_us });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.v - a.v);
  return candidates[0].name;
}

function askToCompleteUs(f: ClientFrameRow): number | null {
  // Reconstruct ask→complete from stage sums when total spans gesture.
  const parts = [f.serve_plus_path_us, f.transfer_us];
  if (f.kind === "interaction") parts.push(f.deliver_us);
  if (parts.some((p) => p == null)) return null;
  return parts.reduce<number>((s, v) => s + (v as number), 0);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
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
