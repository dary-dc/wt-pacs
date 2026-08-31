/** Shared types for client frame-pipeline telemetry. */

export type Us = number; // integer microseconds

export type RowKind = "preload" | "interaction";

export type ChunkMark = {
  t_us: Us;
  cum: number;
};

export type FrameFootprint = {
  frame_index: number;
  /** Absolute byte offset of frame start in the stream. */
  start: number;
  /** Absolute byte offset of frame end (exclusive). */
  end: number;
  /** Codestream byte length (envelope payload minus 4-byte index). */
  bytes: number;
};

export type OpenRow = {
  kind: RowKind;
  frame_index: number;
  ask_ordinal: number;
  gesture_us: Us | null;
  ask_us: Us | null;
  ask_flush_us: Us | null;
  first_byte_us: Us | null;
  last_byte_us: Us | null;
  delivered_us: Us | null;
  bytes: number | null;
  chunks: number | null;
  closed: boolean;
  closed_at: "last_byte" | "delivered" | null;
};

export type ClientFrameRow = {
  kind: RowKind;
  frame_index: number;
  ask_ordinal: number;
  source: "network";
  queue_us: number | null;
  serve_plus_path_us: number | null;
  transfer_us: number | null;
  deliver_us: number | null;
  decode_wait_us: null;
  decode_us: null;
  paint_us: null;
  total_us: number | null;
  total_spans: string | null;
  closed_at: "last_byte" | "delivered";
  bytes: number;
  chunks: number;
  stall: null;
  binding_term: string | null;
};

export type DistributionStats = {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  total: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
};

/** Absent sample set — never a zero-filled stats object (null ≠ 0). */
export type DistributionOrAbsent = DistributionStats | null;

export type Integrity = {
  rows_opened: number;
  rows_closed: number;
  rows_dropped: number;
  marks_after_close: number;
  first_write_conflicts: number;
  byte_closure_ok: boolean;
  long_tasks: number;
  clock_resolution_us: number | null;
  cross_origin_isolated: boolean | null;
};

export type TelemetryReport = {
  summary: {
    report_mode: "fill" | "ondemand";
    arm: string;
    stream_mode: string;
    ask_granularity: string;
    stages_present: string[];
    stages_absent: string[];
    connect_ms: number | null;
    headline: {
      ask_to_first_paint: null;
      ask_to_last_paint: null;
      ask_to_first_frame_complete_us: number | null;
      ask_to_last_frame_complete_us: number | null;
      max_serve_plus_path_us: number | null;
      first_of_burst_serve_plus_path_us: number | null;
    };
    distributions: Record<string, DistributionOrAbsent>;
    copies: {
      js_heap_bytes_per_frame: number | null;
      copies_per_frame: number;
    };
    preload_to_decode: null;
    cold_start: { max_queue_us: number | null };
    integrity: Integrity;
  };
  client_frames: ClientFrameRow[];
  run_end: {
    event: "run_end";
    written_records: number;
    dropped_records: number;
    ring_capacity: number;
  };
};

export type TapConfig = {
  arm: "transport-ts" | "transport-wasm";
  stream_mode: "shared" | "per-frame";
  copies_per_frame: number;
};
