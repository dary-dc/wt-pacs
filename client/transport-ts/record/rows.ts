/** Open-row lifecycle and per-row stage math. */

import type { ClientFrameRow, ClosedAt, OpenRow, RowKind, Us } from "./types.ts";

export function createOpenRow(
  kind: RowKind,
  frame_index: number,
  ask_ordinal: number,
  gesture_us: Us | null,
  ask_us: Us,
): OpenRow {
  return {
    kind,
    frame_index,
    ask_ordinal,
    gesture_us,
    ask_us,
    ask_flush_us: null,
    first_byte_us: null,
    last_byte_us: null,
    delivered_us: null,
    failed_us: null,
    fail_reason: null,
    bytes: null,
    chunks: null,
    closed: false,
    closed_at: null,
  };
}

/** Index of open rows by frame_index (FIFO per index for re-asks). */
export class OpenRowIndex {
  private byFrame = new Map<number, OpenRow[]>();
  private awaitingFlush: OpenRow[] = [];

  add(row: OpenRow) {
    const q = this.byFrame.get(row.frame_index);
    if (q) q.push(row);
    else this.byFrame.set(row.frame_index, [row]);
    this.awaitingFlush.push(row);
  }

  /** First still-open row for this frame index. */
  findOpen(frame_index: number): OpenRow | undefined {
    const q = this.byFrame.get(frame_index);
    if (!q) return undefined;
    return q.find((r) => !r.closed);
  }

  markClosed(row: OpenRow) {
    const q = this.byFrame.get(row.frame_index);
    if (!q) return;
    const i = q.indexOf(row);
    if (i >= 0) q.splice(i, 1);
    if (q.length === 0) this.byFrame.delete(row.frame_index);
  }

  /** Rows that still need ask_flush_us. */
  rowsNeedingFlush(): OpenRow[] {
    this.awaitingFlush = this.awaitingFlush.filter(
      (r) => !r.closed && r.ask_flush_us == null,
    );
    return this.awaitingFlush;
  }

  /** All rows still open (for finish-time cleanup). */
  openRows(): OpenRow[] {
    const out: OpenRow[] = [];
    for (const q of this.byFrame.values()) {
      for (const r of q) {
        if (!r.closed) out.push(r);
      }
    }
    return out;
  }
}

/**
 * Closed preload rows that have not yet seen `delivered`. Fill rows close at `last_byte`
 * (paint has no site), but the app still receives the bytes later; that mark fills
 * `deliver_us` on the closed row instead of being discarded as a mark after close.
 */
export class DeliveredLater {
  private byFrame = new Map<number, OpenRow[]>();

  expect(row: OpenRow) {
    const q = this.byFrame.get(row.frame_index);
    if (q) q.push(row);
    else this.byFrame.set(row.frame_index, [row]);
  }

  /** Oldest closed preload row for this frame still awaiting `delivered`, removed. */
  take(frame_index: number): OpenRow | undefined {
    const q = this.byFrame.get(frame_index);
    if (!q || q.length === 0) return undefined;
    const row = q.shift();
    if (q.length === 0) this.byFrame.delete(frame_index);
    return row;
  }
}

/** Which stamps a row has — the diagnostic for a row that never closed. */
export function stampsPresent(row: OpenRow): string[] {
  const have: string[] = [];
  if (row.gesture_us != null) have.push("gesture");
  if (row.ask_us != null) have.push("ask");
  if (row.ask_flush_us != null) have.push("ask_flush");
  if (row.first_byte_us != null) have.push("first_byte");
  if (row.last_byte_us != null) have.push("last_byte");
  if (row.delivered_us != null) have.push("delivered");
  if (row.failed_us != null) have.push("failed");
  return have;
}

/** The stamp that ends a row's window: the last thing that could have been late. */
export function rowEndUs(row: OpenRow): Us | null {
  const candidates = [row.last_byte_us, row.delivered_us, row.failed_us].filter(
    (v): v is number => v != null,
  );
  return candidates.length === 0 ? null : Math.max(...candidates);
}

export function toClientFrame(row: OpenRow, main_thread_busy_us = 0): ClientFrameRow {
  const queue_us =
    row.gesture_us != null && row.ask_us != null ? row.ask_us - row.gesture_us : null;
  const ask_flush_us =
    row.ask_us != null && row.ask_flush_us != null ? row.ask_flush_us - row.ask_us : null;
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
    ask_flush_us,
    serve_plus_path_us,
    transfer_us,
    deliver_us,
    decode_wait_us: null,
    decode_us: null,
    paint_us: null,
    total_us,
    total_spans,
    closed_at: row.closed_at ?? defaultClosedAt(row.kind),
    fail_reason: row.fail_reason,
    bytes: row.bytes ?? 0,
    chunks,
    stall: null,
    main_thread_busy_us,
    binding_term,
  };
}

function defaultClosedAt(kind: RowKind): ClosedAt {
  return kind === "preload" ? "last_byte" : "delivered";
}

/** Match transfer distribution filter: only multi-chunk rows bind on transfer. */
export function pickBinding(s: {
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
  if (s.transfer_us != null && s.chunks > 1)
    candidates.push({ name: "transfer", v: s.transfer_us });
  if (s.deliver_us != null) candidates.push({ name: "deliver", v: s.deliver_us });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.v - a.v);
  return candidates[0].name;
}

export function askToCompleteUs(f: ClientFrameRow): number | null {
  const parts = [f.serve_plus_path_us, f.transfer_us];
  if (f.kind === "interaction") parts.push(f.deliver_us);
  if (parts.some((p) => p == null)) return null;
  return parts.reduce<number>((s, v) => s + (v as number), 0);
}
