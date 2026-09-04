/** Open-row lifecycle and per-row stage math. */

import type { ClientFrameRow, OpenRow, RowKind, Us } from "./types.ts";

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

export function toClientFrame(row: OpenRow): ClientFrameRow {
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
    closed_at: row.closed_at ?? (row.kind === "preload" ? "last_byte" : "delivered"),
    bytes: row.bytes ?? 0,
    chunks,
    stall: null,
    binding_term,
  };
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
