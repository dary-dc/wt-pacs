/** Assemble the harvested client telemetry report. */

import { distributionStats } from "./percentiles.ts";
import { askToCompleteUs } from "./rows.ts";
import type {
  ClientFrameRow,
  Integrity,
  IntegrityJudgement,
  TapConfig,
  TelemetryReport,
} from "./types.ts";

const RING_CAPACITY = 4096;

const DIST_ACCESSORS: {
  key: string;
  get: (f: ClientFrameRow) => number | null;
  /** Extra row filter (e.g. transfer excludes single-chunk). */
  include?: (f: ClientFrameRow) => boolean;
}[] = [
  { key: "queue", get: (f) => f.queue_us },
  { key: "serve_plus_path", get: (f) => f.serve_plus_path_us },
  {
    key: "transfer",
    get: (f) => f.transfer_us,
    include: (f) => (f.chunks ?? 0) > 1,
  },
  { key: "deliver", get: (f) => f.deliver_us },
  { key: "total", get: (f) => f.total_us },
  { key: "bytes", get: (f) => f.bytes },
];

export function minOf(values: number[]): number | null {
  if (values.length === 0) return null;
  let m = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] < m) m = values[i];
  return m;
}

export function maxOf(values: number[]): number | null {
  if (values.length === 0) return null;
  let m = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] > m) m = values[i];
  return m;
}

export function judgeIntegrity(integrity: Integrity): IntegrityJudgement {
  const invalid_reasons: string[] = [];
  if (integrity.rows_opened !== integrity.rows_closed) {
    invalid_reasons.push(
      `rows_opened ${integrity.rows_opened} != rows_closed ${integrity.rows_closed}`,
    );
  }
  if (!integrity.byte_closure_ok) {
    invalid_reasons.push("byte_closure_ok false");
  }
  if (integrity.first_write_conflicts > 0) {
    invalid_reasons.push(`first_write_conflicts ${integrity.first_write_conflicts}`);
  }
  if (integrity.marks_after_close > 0) {
    invalid_reasons.push(`marks_after_close ${integrity.marks_after_close}`);
  }
  return { valid: invalid_reasons.length === 0, invalid_reasons };
}

export function bindingRollup(
  frames: ClientFrameRow[],
): Record<string, number> {
  const out: Record<string, number> = {
    transfer: 0,
    serve_plus_path: 0,
    deliver: 0,
    queue: 0,
    none: 0,
  };
  for (const f of frames) {
    const key = f.binding_term ?? "none";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function assembleReport(args: {
  config: TapConfig;
  install_t0_ms: number;
  first_ask_ms: number | null;
  closedRows: ClientFrameRow[];
  integrity: Integrity;
}): TelemetryReport {
  const judgement = judgeIntegrity(args.integrity);
  const integrity: Integrity = {
    ...args.integrity,
    valid: judgement.valid,
    invalid_reasons: judgement.invalid_reasons,
  };

  const frames = [...args.closedRows].sort(
    (a, b) => a.frame_index - b.frame_index || a.ask_ordinal - b.ask_ordinal,
  );
  const hasPreload = frames.some((f) => f.kind === "preload");
  const report_mode = hasPreload ? "fill" : "ondemand";
  const ask_granularity = hasPreload ? "request_frames_batch" : "request_frame";

  const usable = frames.filter((f) => f.frame_index !== 0);
  const serve = usable
    .map((f) => f.serve_plus_path_us)
    .filter((v): v is number => v != null);
  const askToComplete = usable
    .map((f) => askToCompleteUs(f))
    .filter((v): v is number => v != null);

  const headline = {
    ask_to_first_paint: null,
    ask_to_last_paint: null,
    ask_to_first_frame_complete_us: minOf(askToComplete),
    ask_to_last_frame_complete_us: maxOf(askToComplete),
    max_serve_plus_path_us: maxOf(serve),
    first_of_burst_serve_plus_path_us: minOf(serve),
  };

  const distributions: TelemetryReport["summary"]["distributions"] = {};
  for (const { key, get, include } of DIST_ACCESSORS) {
    const vals = usable
      .filter((f) => (include ? include(f) : true))
      .map(get)
      .filter((v): v is number => v != null);
    distributions[key] = distributionStats(vals);
  }

  const meanBytes =
    usable.length === 0
      ? null
      : Math.round(usable.reduce((s, f) => s + f.bytes, 0) / usable.length);

  const connect_ms =
    args.first_ask_ms == null
      ? null
      : Math.round((args.first_ask_ms - args.install_t0_ms) * 1000) / 1000;

  const queueVals = usable.map((f) => f.queue_us).filter((v): v is number => v != null);

  return {
    summary: {
      report_mode,
      arm: args.config.arm,
      stream_mode: args.config.stream_mode,
      ask_granularity,
      stages_present: ["queue", "serve_plus_path", "transfer", "deliver"],
      stages_absent: ["decode_wait", "decode", "paint"],
      connect_ms,
      headline,
      distributions,
      binding: bindingRollup(usable),
      copies: {
        mean_frame_bytes: meanBytes,
        copies_per_frame: args.config.copies_per_frame,
      },
      preload_to_decode: null,
      cold_start: {
        max_queue_us: maxOf(queueVals),
      },
      integrity,
    },
    client_frames: frames,
    run_end: {
      event: "run_end",
      written_records: frames.length,
      dropped_records: integrity.rows_dropped,
      ring_capacity: RING_CAPACITY,
    },
  };
}
