//! Report assembly — distributions, summary, JSON document (telemetry feature only).
//!
//! Two ways to summarise, and the report says which one it used in
//! `summary.percentile_method`:
//!
//! - **exact** (`exact-sort`): every value sorted, nearest-rank percentiles. Used for the final
//!   report when the rows fit the inline cap, and always by the offline builder.
//! - **live** (`histogram-loglinear-1024`): log-linear histograms folded as rows stream past.
//!   Fixed memory; exact counts, totals, min and max; percentiles within 0.1 % (1 µs below
//!   2 048 µs). Used for the timer rewrite and above the cap.
//!
//! The row file beside the report holds every row either way (`rows.rs`).

use super::rows;
use super::tap::{
    run_meta, FrameRecord, Record, RunMeta, SessionRecord, BATCH, DROP_TOTAL, RING_CAP,
    ROWS_CLOSED, ROWS_OPENED, SESSIONS_SEEN, SESSIONS_STARTED,
};
use std::path::Path;
use std::sync::atomic::Ordering;

pub(super) const SCHEMA: &str = "server-pipeline-v2";
pub(super) const METHOD_EXACT: &str = "exact-sort";
pub(super) const METHOD_HIST: &str = "histogram-loglinear-1024";
/// `server_frames` is inlined only up to this many rows (`WTPACS_TELEMETRY_INLINE_CAP`).
pub(super) const INLINE_CAP_DEFAULT: u64 = 1_000_000;

#[derive(serde::Serialize)]
pub(super) struct TelemetryReport {
    pub schema: &'static str,
    pub summary: RunSummary,
    /// Frame rows — empty above the inline cap and in timer rewrites.
    pub server_frames: Vec<FrameRecord>,
    pub server_sessions: Vec<SessionRecord>,
    /// Row file beside this report: every row, exact, whatever `server_frames` holds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows_file: Option<String>,
    pub run_end: RunEndMeta,
}

#[derive(serde::Serialize)]
pub(super) struct RunEndMeta {
    /// `run_end` for the final report, `run_progress` for a timer rewrite.
    pub event: &'static str,
    /// Frame rows recorded.
    pub written_records: u64,
    /// Records in the row file (frames + sessions).
    pub rows_in_file: u64,
    pub frames_inlined: bool,
    /// Process-wide ring drops since process start (not per-run).
    pub dropped_records_process_total: u64,
}

#[derive(Default, serde::Serialize)]
pub(super) struct IntegrityBlock {
    pub rows_opened: u64,
    pub rows_closed: u64,
    pub rows_dropped: u64,
    pub sessions: u64,
    /// Sessions accepted while telemetry was on, sampled or not.
    pub sessions_seen: u64,
    pub ring_capacity: u64,
    pub batch_size: u64,
    pub rows_file_bytes: u64,
    pub dropped_records_process_total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clock: Option<&'static str>,
}

#[derive(serde::Serialize)]
pub(super) struct RunSummary {
    /// What was being served — `None` only if the server never told the recorder.
    #[serde(flatten)]
    pub run: Option<RunMeta>,
    pub frame_count: u32,
    pub sessions: u64,
    pub percentile_method: &'static str,
    pub totals: SummaryTotals,
    /// Absent when no sample — JSON `null`, never a zero-filled stats object.
    pub prepare_us: Option<DistributionStats>,
    pub locate_us: Option<DistributionStats>,
    pub send_us: Option<DistributionStats>,
    pub serve_us: Option<DistributionStats>,
    pub overhead_us: Option<DistributionStats>,
    pub server_bytes_sent: Option<DistributionStats>,
    pub integrity: IntegrityBlock,
}

#[derive(serde::Serialize)]
pub(super) struct SummaryTotals {
    pub prepare_us: u64,
    pub locate_us: u64,
    pub send_us: u64,
    pub serve_us: u64,
    pub overhead_us: u64,
    pub server_bytes_sent: u64,
}

#[derive(Clone, Copy, serde::Serialize)]
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

// ───────────────────────── exact ─────────────────────────

#[derive(Default)]
pub(super) struct RunAccumulator {
    prepare: Vec<u32>,
    locate: Vec<u32>,
    send: Vec<u32>,
    serve: Vec<u32>,
    overhead: Vec<u32>,
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
        self.overhead.push(row.overhead_us);
        self.bytes.push(row.server_bytes_sent);
    }

    pub(super) fn build_summary(&self) -> RunSummary {
        let sum = |v: &[u32]| v.iter().map(|&x| u64::from(x)).sum::<u64>();
        RunSummary {
            run: run_meta(),
            frame_count: self.serve.len() as u32,
            sessions: 0,
            percentile_method: METHOD_EXACT,
            totals: SummaryTotals {
                prepare_us: sum(&self.prepare),
                locate_us: sum(&self.locate),
                send_us: sum(&self.send),
                serve_us: sum(&self.serve),
                overhead_us: sum(&self.overhead),
                server_bytes_sent: sum(&self.bytes),
            },
            prepare_us: distribution_stats(&self.prepare),
            locate_us: distribution_stats(&self.locate),
            send_us: distribution_stats(&self.send),
            serve_us: distribution_stats(&self.serve),
            overhead_us: distribution_stats(&self.overhead),
            server_bytes_sent: distribution_stats(&self.bytes),
            integrity: IntegrityBlock::default(),
        }
    }
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

// ───────────────────────── live (histogram) ─────────────────────────

/// Log-linear histogram over u32 µs: exact below 1 024, then 1 024 sub-buckets per octave
/// (≤ 0.1 % relative error). 23 552 buckets × 8 B ≈ 188 KB.
const SUB_BITS: u32 = 10;
const SUB: usize = 1 << SUB_BITS;
const HIST_BUCKETS: usize = SUB + (32 - SUB_BITS as usize) * SUB;

pub(super) struct Hist {
    counts: Vec<u64>,
    total: u64,
    sum: u64,
    min: u32,
    max: u32,
}

impl Hist {
    pub(super) fn new() -> Self {
        Self {
            counts: vec![0; HIST_BUCKETS],
            total: 0,
            sum: 0,
            min: u32::MAX,
            max: 0,
        }
    }

    #[inline]
    fn bucket(v: u32) -> usize {
        if (v as usize) < SUB {
            v as usize
        } else {
            let e = 31 - v.leading_zeros();
            let mant = (v >> (e - SUB_BITS)) as usize & (SUB - 1);
            SUB + (e - SUB_BITS) as usize * SUB + mant
        }
    }

    fn bucket_low(b: usize) -> u32 {
        if b < SUB {
            b as u32
        } else {
            let rel = b - SUB;
            let e = (rel / SUB) as u32 + SUB_BITS;
            let mant = (rel % SUB) as u32;
            (1u32 << e) | (mant << (e - SUB_BITS))
        }
    }

    #[inline]
    pub(super) fn record(&mut self, v: u32) {
        self.counts[Self::bucket(v)] += 1;
        self.total += 1;
        self.sum += u64::from(v);
        self.min = self.min.min(v);
        self.max = self.max.max(v);
    }

    /// Nearest-rank over buckets; the bucket's lower bound, never above the true value.
    fn percentile(&self, p: f64) -> f64 {
        if self.total == 0 {
            return 0.0;
        }
        let rank = ((p / 100.0) * self.total as f64).ceil() as u64;
        let rank = rank.clamp(1, self.total);
        let mut cum = 0u64;
        for (b, &c) in self.counts.iter().enumerate() {
            cum += c;
            if cum >= rank {
                return f64::from(Self::bucket_low(b));
            }
        }
        f64::from(self.max)
    }

    pub(super) fn dist(&self) -> Option<DistributionStats> {
        if self.total == 0 {
            return None;
        }
        Some(DistributionStats {
            count: self.total.min(u32::MAX as u64) as u32,
            mean: round2(self.sum as f64 / self.total as f64),
            median: self.percentile(50.0),
            min: self.min,
            max: self.max,
            total: self.sum,
            p50: self.percentile(50.0),
            p75: self.percentile(75.0),
            p90: self.percentile(90.0),
            p95: self.percentile(95.0),
            p99: self.percentile(99.0),
        })
    }
}

/// Everything the drain keeps in memory while rows stream past: six histograms, counters,
/// and the (small) list of session rows.
pub(super) struct LiveSummary {
    prepare: Hist,
    locate: Hist,
    send: Hist,
    serve: Hist,
    overhead: Hist,
    bytes: Hist,
    pub(super) frames: u64,
    pub(super) records: u64,
    pub(super) sessions: Vec<SessionRecord>,
}

impl LiveSummary {
    pub(super) fn new() -> Self {
        Self {
            prepare: Hist::new(),
            locate: Hist::new(),
            send: Hist::new(),
            serve: Hist::new(),
            overhead: Hist::new(),
            bytes: Hist::new(),
            frames: 0,
            records: 0,
            sessions: Vec::new(),
        }
    }

    pub(super) fn fold(&mut self, rec: &Record) {
        self.records += 1;
        match rec {
            Record::Frame(f) => {
                self.frames += 1;
                if let Some(us) = f.prepare_us {
                    self.prepare.record(us);
                }
                if let Some(us) = f.locate_us {
                    self.locate.record(us);
                }
                if let Some(us) = f.send_us {
                    self.send.record(us);
                }
                self.serve.record(f.serve_us);
                self.overhead.record(f.overhead_us);
                self.bytes.record(f.server_bytes_sent);
            }
            Record::Session(s) => self.sessions.push(*s),
        }
    }

    pub(super) fn build_summary(&self) -> RunSummary {
        RunSummary {
            run: run_meta(),
            frame_count: self.frames.min(u32::MAX as u64) as u32,
            sessions: self.sessions.len() as u64,
            percentile_method: METHOD_HIST,
            totals: SummaryTotals {
                prepare_us: self.prepare.sum,
                locate_us: self.locate.sum,
                send_us: self.send.sum,
                serve_us: self.serve.sum,
                overhead_us: self.overhead.sum,
                server_bytes_sent: self.bytes.sum,
            },
            prepare_us: self.prepare.dist(),
            locate_us: self.locate.dist(),
            send_us: self.send.dist(),
            serve_us: self.serve.dist(),
            overhead_us: self.overhead.dist(),
            server_bytes_sent: self.bytes.dist(),
            integrity: IntegrityBlock::default(),
        }
    }
}

// ───────────────────────── documents ─────────────────────────

fn integrity(rows_file_bytes: u64) -> IntegrityBlock {
    let dropped_process = DROP_TOTAL.load(Ordering::Relaxed);
    IntegrityBlock {
        rows_opened: ROWS_OPENED.load(Ordering::Relaxed),
        rows_closed: ROWS_CLOSED.load(Ordering::Relaxed),
        rows_dropped: dropped_process,
        sessions: SESSIONS_STARTED.load(Ordering::Relaxed),
        sessions_seen: SESSIONS_SEEN.load(Ordering::Relaxed),
        ring_capacity: RING_CAP as u64,
        batch_size: BATCH as u64,
        rows_file_bytes,
        dropped_records_process_total: dropped_process,
        clock: Some("std::time::Instant"),
    }
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name().map(|n| n.to_string_lossy().into_owned())
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Timer rewrite: histogram summary and sessions so far; no frame rows.
pub(super) fn progress_report(live: &LiveSummary, rows_path: Option<&Path>) -> TelemetryReport {
    let rows_file_bytes = rows_path.map(file_len).unwrap_or(0);
    let mut summary = live.build_summary();
    summary.integrity = integrity(rows_file_bytes);
    TelemetryReport {
        schema: SCHEMA,
        summary,
        server_frames: Vec::new(),
        server_sessions: live.sessions.clone(),
        rows_file: rows_path.and_then(file_name),
        run_end: RunEndMeta {
            event: "run_progress",
            written_records: live.frames,
            rows_in_file: live.records,
            frames_inlined: false,
            dropped_records_process_total: DROP_TOTAL.load(Ordering::Relaxed),
        },
    }
}

/// Final report: exact from the row file when the rows fit the inline cap, else the live
/// histogram summary with the row file as the record.
pub(super) fn final_report(
    live: &LiveSummary,
    rows_path: Option<&Path>,
    inline_cap: u64,
) -> TelemetryReport {
    if let Some(path) = rows_path {
        if live.frames <= inline_cap {
            match exact_report_from_rows(path, true) {
                Ok(report) => return report,
                Err(err) => {
                    tracing::warn!(%err, "telemetry: exact report from rows failed; using live summary")
                }
            }
        }
    }
    let mut report = progress_report(live, rows_path);
    report.run_end.event = "run_end";
    report
}

/// Exact report from a row file. Frames are inlined only when asked (`inline`).
pub(super) fn exact_report_from_rows(
    rows_path: &Path,
    inline: bool,
) -> std::io::Result<TelemetryReport> {
    let mut frames: Vec<FrameRecord> = Vec::new();
    let mut sessions: Vec<SessionRecord> = Vec::new();
    let mut acc = RunAccumulator::default();
    let mut records = 0u64;
    let mut frame_count = 0u64;
    for rec in rows::read_records(rows_path)? {
        records += 1;
        match rec {
            Record::Frame(f) => {
                frame_count += 1;
                acc.push(&f);
                if inline {
                    frames.push(f);
                }
            }
            Record::Session(s) => sessions.push(s),
        }
    }
    if inline {
        frames.sort_by_key(|f| (f.session_id, f.t_ask_us, f.frame_index, f.ask_ordinal));
    }
    sessions.sort_by_key(|s| s.session_id);
    let mut summary = acc.build_summary();
    summary.sessions = sessions.len() as u64;
    summary.integrity = integrity(file_len(rows_path));
    Ok(TelemetryReport {
        schema: SCHEMA,
        summary,
        server_frames: frames,
        server_sessions: sessions,
        rows_file: file_name(rows_path),
        run_end: RunEndMeta {
            event: "run_end",
            written_records: frame_count,
            rows_in_file: records,
            frames_inlined: inline,
            dropped_records_process_total: DROP_TOTAL.load(Ordering::Relaxed),
        },
    })
}

/// `exact-server --telemetry-report <rows>`: rebuild the full JSON, exact, from a row file.
/// Frames are inlined up to `WTPACS_TELEMETRY_INLINE_CAP` (default 1 M); the summary is exact
/// regardless. Memory: about 28 bytes per frame row for the sorts, plus the inlined rows.
pub fn write_report_from_rows(rows_path: &Path, out_path: &Path) -> anyhow::Result<()> {
    use anyhow::Context;
    let cap = super::tap::env_u64("WTPACS_TELEMETRY_INLINE_CAP", INLINE_CAP_DEFAULT);
    let frame_rows = rows::read_records(rows_path)
        .with_context(|| format!("open {}", rows_path.display()))?
        .filter(|r| matches!(r, Record::Frame(_)))
        .count() as u64;
    let report = exact_report_from_rows(rows_path, frame_rows <= cap)
        .with_context(|| format!("read {}", rows_path.display()))?;
    super::sink::write_json(out_path, &report)
        .with_context(|| format!("write {}", out_path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hist_bucket_low_never_exceeds_value() {
        for v in [
            0u32,
            1,
            1023,
            1024,
            1025,
            2047,
            2048,
            4095,
            65_537,
            1_000_000,
            u32::MAX,
        ] {
            let b = Hist::bucket(v);
            let low = Hist::bucket_low(b);
            assert!(low <= v, "v={v} low={low}");
            assert!(b < HIST_BUCKETS);
            if v >= 2048 {
                let rel = (v - low) as f64 / v as f64;
                assert!(rel <= 1.0 / 1024.0 + 1e-9, "v={v} rel={rel}");
            } else {
                assert_eq!(low, v, "exact below 2048");
            }
        }
    }

    #[test]
    fn hist_percentiles_match_exact_within_bound() {
        let mut h = Hist::new();
        let mut vals = Vec::new();
        let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
        for _ in 0..100_000 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let mut v = 50 + (x % 4000) as u32;
            if x % 100 == 0 {
                v *= 400;
            }
            h.record(v);
            vals.push(v);
        }
        let exact = distribution_stats(&vals).expect("exact");
        let hd = h.dist().expect("hist");
        assert_eq!(hd.count, exact.count);
        assert_eq!(hd.total, exact.total);
        assert_eq!(hd.min, exact.min);
        assert_eq!(hd.max, exact.max);
        for (e, hv) in [
            (exact.p50, hd.p50),
            (exact.p95, hd.p95),
            (exact.p99, hd.p99),
        ] {
            assert!(hv <= e, "hist never above exact");
            assert!((e - hv) / e <= 1.0 / 1024.0 + 1e-9, "exact={e} hist={hv}");
        }
    }

    #[test]
    fn empty_hist_is_none_not_zeros() {
        assert!(Hist::new().dist().is_none());
    }
}
