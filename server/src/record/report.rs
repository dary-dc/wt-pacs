//! Report assembly — distributions, summary, JSON document (telemetry feature only).

use super::tap::{FrameRecord, RING_CAP, ROWS_CLOSED, ROWS_OPENED, SESSIONS_STARTED, DROP_TOTAL};
use std::sync::atomic::Ordering;

pub(super) const SCHEMA: &str = "server-pipeline-v1";

#[derive(serde::Serialize)]
pub(super) struct TelemetryReport {
    pub schema: &'static str,
    pub summary: RunSummary,
    pub server_frames: Vec<FrameRecord>,
    pub run_end: RunEndMeta,
}

#[derive(serde::Serialize)]
pub(super) struct RunEndMeta {
    pub event: &'static str,
    pub written_records: u64,
    /// Process-wide ring drops since process start (not per-run).
    pub dropped_records_process_total: u64,
}

#[derive(Default, serde::Serialize)]
pub(super) struct IntegrityBlock {
    pub rows_opened: u64,
    pub rows_closed: u64,
    pub rows_dropped: u64,
    pub sessions: u64,
    pub ring_capacity: u64,
    pub dropped_records_process_total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clock: Option<&'static str>,
}

#[derive(Default)]
pub(super) struct RunAccumulator {
    prepare: Vec<u32>,
    locate: Vec<u32>,
    send: Vec<u32>,
    serve: Vec<u32>,
    bytes: Vec<u32>,
}

impl RunAccumulator {
    pub(super) fn push(&mut self, row: &FrameRecord) {
        // Null ≠ 0: absent stages must not enter distributions as fake zeros.
        if let Some(us) = row.prepare_us {
            self.prepare.push(us);
        }
        if let Some(us) = row.locate_us {
            self.locate.push(us);
        }
        if let Some(us) = row.send_us {
            self.send.push(us);
        }
        self.serve.push(row.serve_us);
        self.bytes.push(row.server_bytes_sent);
    }

    pub(super) fn build_summary(&self) -> RunSummary {
        RunSummary {
            frame_count: self.serve.len() as u32,
            totals: SummaryTotals {
                prepare_us: self.prepare.iter().map(|&v| u64::from(v)).sum(),
                locate_us: self.locate.iter().map(|&v| u64::from(v)).sum(),
                send_us: self.send.iter().map(|&v| u64::from(v)).sum(),
                serve_us: self.serve.iter().map(|&v| u64::from(v)).sum(),
                server_bytes_sent: self.bytes.iter().map(|&v| u64::from(v)).sum(),
            },
            prepare_us: distribution_stats(&self.prepare),
            locate_us: distribution_stats(&self.locate),
            send_us: distribution_stats(&self.send),
            serve_us: distribution_stats(&self.serve),
            server_bytes_sent: distribution_stats(&self.bytes),
            integrity: IntegrityBlock::default(),
        }
    }
}

#[derive(serde::Serialize)]
pub(super) struct RunSummary {
    pub frame_count: u32,
    pub totals: SummaryTotals,
    /// Absent when no sample — JSON `null`, never a zero-filled stats object.
    pub prepare_us: Option<DistributionStats>,
    pub locate_us: Option<DistributionStats>,
    pub send_us: Option<DistributionStats>,
    pub serve_us: Option<DistributionStats>,
    pub server_bytes_sent: Option<DistributionStats>,
    pub integrity: IntegrityBlock,
}

#[derive(serde::Serialize)]
pub(super) struct SummaryTotals {
    pub prepare_us: u64,
    pub locate_us: u64,
    pub send_us: u64,
    pub serve_us: u64,
    pub server_bytes_sent: u64,
}

#[derive(serde::Serialize)]
pub(super) struct DistributionStats {
    pub count: u32,
    pub mean: f64,
    pub median: f64,
    pub min: u32,
    pub max: u32,
    pub total: u64,
    pub p50: f64,
    pub p75: f64,
    pub p90: f64,
    pub p95: f64,
    pub p99: f64,
}

pub(super) fn distribution_stats(values: &[u32]) -> Option<DistributionStats> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let count = sorted.len();
    let total: u64 = sorted.iter().map(|&v| u64::from(v)).sum();
    let mean = round2(total as f64 / f64::from(count as u32));
    Some(DistributionStats {
        count: count as u32,
        mean,
        median: round2(percentile(&sorted, 50.0)),
        min: sorted[0],
        max: sorted[count - 1],
        total,
        p50: round2(percentile(&sorted, 50.0)),
        p75: round2(percentile(&sorted, 75.0)),
        p90: round2(percentile(&sorted, 90.0)),
        p95: round2(percentile(&sorted, 95.0)),
        p99: round2(percentile(&sorted, 99.0)),
    })
}

/// Nearest-rank: rank = ceil(p/100 × N), clamped to [1, N]; value = sorted[rank - 1].
pub(super) fn percentile(sorted: &[u32], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return f64::from(sorted[0]);
    }
    let n = sorted.len();
    let rank = ((p / 100.0) * n as f64).ceil() as usize;
    let rank = rank.clamp(1, n);
    f64::from(sorted[rank - 1])
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Snapshot integrity counters into a finished summary.
pub(super) fn finalize_report(frames: Vec<FrameRecord>, mut summary: RunSummary) -> TelemetryReport {
    let written = frames.len() as u64;
    let dropped_process = DROP_TOTAL.load(Ordering::Relaxed);
    summary.integrity = IntegrityBlock {
        rows_opened: ROWS_OPENED.load(Ordering::Relaxed),
        rows_closed: ROWS_CLOSED.load(Ordering::Relaxed),
        rows_dropped: dropped_process,
        sessions: SESSIONS_STARTED.load(Ordering::Relaxed),
        ring_capacity: RING_CAP as u64,
        dropped_records_process_total: dropped_process,
        clock: Some("std::time::Instant"),
    };
    TelemetryReport {
        schema: SCHEMA,
        summary,
        server_frames: frames,
        run_end: RunEndMeta {
            event: "run_end",
            written_records: written,
            dropped_records_process_total: dropped_process,
        },
    }
}
