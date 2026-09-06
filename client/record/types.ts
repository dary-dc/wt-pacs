/** Shared types for client frame-pipeline telemetry. */

export type Us = number; // integer microseconds

export type RowKind = "preload" | "interaction";

/**
 * How a row ended. The first three are the stamps that close a row; the rest are failures.
 * `batch_delivered` = the batch method marked it after the whole batch landed.
 */
export type ClosedAt =
  | "last_byte"
  | "delivered"
  | "batch_delivered"
  | "refused"
  | "timeout"
  | "error";

export const OK_CLOSED_AT: readonly ClosedAt[] = ["last_byte", "delivered", "batch_delivered"];

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
  /** Stamp of a refusal / timeout / error close. */
  failed_us: Us | null;
  fail_reason: string | null;
  bytes: number | null;
  chunks: number | null;
  closed: boolean;
  closed_at: ClosedAt | null;
};

export type ClientFrameRow = {
  kind: RowKind;
  frame_index: number;
  ask_ordinal: number;
  source: "network";
  queue_us: number | null;
  /** ask → control write promise resolved. Not a stage; the writer's own latency. */
  ask_flush_us: number | null;
  serve_plus_path_us: number | null;
  transfer_us: number | null;
  deliver_us: number | null;
  decode_wait_us: null;
  decode_us: null;
  paint_us: null;
  total_us: number | null;
  total_spans: string | null;
  closed_at: ClosedAt;
  /** Server-supplied reason on `refused`; the client error text on `timeout` / `error`. */
  fail_reason: string | null;
  bytes: number;
  chunks: number;
  stall: null;
  /**
   * Long-task time overlapping [ask, close] — main-thread busy while this row's stamps
   * were pending. Non-zero means the stamps may be late by up to this much; the row is
   * excluded from distributions and headlines.
   */
  main_thread_busy_us: number;
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

export type IntegrityJudgement = {
  valid: boolean;
  invalid_reasons: string[];
};

/** Cost of the recorder's own read path — the G5 guard. Null when no read was observed. */
export type TapReadCost = {
  count: number;
  p50_us: number;
  p99_us: number;
  max_us: number;
};

/** A row still open at finish(): which stamps it has, so a void run can be diagnosed. */
export type OpenRowDiag = {
  kind: RowKind;
  frame_index: number;
  ask_ordinal: number;
  have: string[];
};

export type Integrity = {
  rows_opened: number;
  rows_closed: number;
  /** Media for a frame with no open row (late or unasked). */
  rows_dropped: number;
  /** Closed rows discarded because the ring was full — voids the run. */
  ring_evictions: number;
  /** Marks that matched no row at all (open or closed). */
  marks_after_close: number;
  first_write_conflicts: number;
  byte_closure_ok: boolean;
  /** Long tasks overlapping [first ask, last close]. Compile before the first ask is not here. */
  long_tasks: number;
  long_task_total_us: number;
  long_tasks_outside_window: number;
  /** Usable rows set aside because a long task overlapped their stamps. */
  busy_rows_excluded: number;
  clock_resolution_us: number | null;
  /** Cost of the finish-time clock probe (µs); auditable, not on the connect path. */
  clock_probe_us: number | null;
  cross_origin_isolated: boolean | null;
  tap_read_cost_us: TapReadCost | null;
  /** Rows never closed — the reason `rows_opened != rows_closed`, row by row. */
  open_rows: OpenRowDiag[];
  /** Set at finish(): one place to see if the run is publishable. */
  valid?: boolean;
  invalid_reasons?: string[];
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
    /**
     * The earliest ask of the run, by ask time — excluded from every mean and headline.
     * Warm-up lands on it (first stream, server cold pages), whatever its frame index.
     */
    first_ask_row: ClientFrameRow | null;
    /**
     * Fill rows share one gesture and one ask stamp, so their `queue` is one number, not a
     * distribution. Reported here once; `distributions.queue` covers interaction rows only.
     */
    fill_queue_us: number | null;
    /** Rows by how they ended (`closed_at`), over all rows including the first ask. */
    outcomes: Record<ClosedAt, number>;
    distributions: Record<string, DistributionOrAbsent>;
    /** Rollup of per-row binding_term over usable frames (first ask excluded). */
    binding: Record<string, number>;
    copies: {
      /** Mean of per-frame `bytes` — not a measured JS heap figure. */
      mean_frame_bytes: number | null;
      /** Declared by the harness from a source read, not measured here. */
      copies_per_frame_declared: number;
      copies_source: string;
    };
    preload_to_decode: null;
    cold_start: { max_queue_us: number | null };
    integrity: Integrity;
  };
  client_frames: ClientFrameRow[];
  run_end: {
    event: "run_end";
    written_records: number;
    /** rows_dropped + ring_evictions. */
    dropped_records: number;
    ring_capacity: number;
  };
};

export type TapConfig = {
  arm: "transport-ts" | "transport-wasm";
  stream_mode: "shared" | "per-frame";
  copies_per_frame_declared: number;
  copies_source: string;
  /** Closed rows kept; beyond this, rows are evicted and counted (default 4096). */
  ring_capacity: number;
};
