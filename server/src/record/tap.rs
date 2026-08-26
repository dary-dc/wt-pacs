//! Lab-only recorder — compiled only with `feature = "telemetry"`.
//!
//! Hot path: `try_send` fixed `Copy` records into a process-wide bounded queue.
//! Drain thread writes one JSON report on shutdown (summary first). No panics (R7).

use crate::record::{LocateOutcome, Record, Refusal, WriteOutcome};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tracing::{info, warn};

const RING_CAP: usize = 4096;

static SESSION_IDS: AtomicU64 = AtomicU64::new(1);
static ACTIVE_TAPS: AtomicU64 = AtomicU64::new(0);
static SINK: OnceLock<Mutex<Option<SyncSender<FrameRecord>>>> = OnceLock::new();
static DROP_TOTAL: AtomicU64 = AtomicU64::new(0);

/// Fixed-width row — durations and counts only (R4, R8).
#[derive(Clone, Copy, Debug)]
#[repr(C)]
pub struct FrameRecord {
    pub session_id: u64,
    pub frame_index: u32,
    pub ask_ordinal: u32,
    pub server_work_us: u32,
    pub server_write_us: u32,
    /// Continuous span: `ask()` → row emit (locate + send/refuse).
    pub server_serve_us: u32,
    pub server_bytes_sent: u32,
    pub locate_outcome: u8,
    pub write_outcome: u8,
    pub dropped_since_last: u16,
}

pub struct Tap {
    session_id: u64,
    ordinals: HashMap<u32, u32>,
    frame_index: u32,
    ask_ordinal: u32,
    pending_work_us: u32,
    pending_bytes: u32,
    pending_locate: u8,
    drops_since_emit: u16,
    serve_start: Option<Instant>,
}

impl Tap {
    /// Enabled when `WTPACS_TELEMETRY` is `1` / `true` / `yes`. Path from `WTPACS_TELEMETRY_PATH`
    /// (default `telemetry-server.json`). Report is written when the last session ends.
    pub fn for_session() -> Option<Self> {
        if !env_enabled("WTPACS_TELEMETRY") {
            return None;
        }
        let path = std::env::var("WTPACS_TELEMETRY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("telemetry-server.json"));
        ensure_sink(path);
        ACTIVE_TAPS.fetch_add(1, Ordering::Relaxed);
        Some(Self {
            session_id: SESSION_IDS.fetch_add(1, Ordering::Relaxed),
            ordinals: HashMap::new(),
            frame_index: 0,
            ask_ordinal: 0,
            pending_work_us: 0,
            pending_bytes: 0,
            pending_locate: LocateOutcome::Ok as u8,
            drops_since_emit: 0,
            serve_start: None,
        })
    }

    fn take_ordinal(&mut self, frame_index: u32) -> u32 {
        let entry = self.ordinals.entry(frame_index).or_insert(0);
        let n = *entry;
        *entry = entry.saturating_add(1);
        n
    }

    fn try_emit(&mut self, write_outcome: WriteOutcome, write_us: u32) {
        let dropped = self.drops_since_emit;
        self.drops_since_emit = 0;
        let server_serve_us = self
            .serve_start
            .take()
            .map(|t| micros_since(t))
            .unwrap_or(0);
        let row = FrameRecord {
            session_id: self.session_id,
            frame_index: self.frame_index,
            ask_ordinal: self.ask_ordinal,
            server_work_us: self.pending_work_us,
            server_write_us: write_us,
            server_serve_us,
            server_bytes_sent: self.pending_bytes,
            locate_outcome: self.pending_locate,
            write_outcome: write_outcome as u8,
            dropped_since_last: dropped,
        };
        if let Ok(guard) = sink_cell().lock() {
            if let Some(tx) = guard.as_ref() {
                match tx.try_send(row) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        DROP_TOTAL.fetch_add(1, Ordering::Relaxed);
                        self.drops_since_emit = self.drops_since_emit.saturating_add(1);
                    }
                    Err(TrySendError::Disconnected(_)) => {
                        DROP_TOTAL.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
    }
}

impl Record for Tap {
    type Stamp = Instant;

    fn stamp(&self) -> Instant {
        Instant::now()
    }

    fn ask(&mut self, frame_index: u32) {
        self.serve_start = Some(Instant::now());
        self.frame_index = frame_index;
        self.ask_ordinal = self.take_ordinal(frame_index);
    }

    fn located(&mut self, since: Instant, outcome: LocateOutcome, byte_len: usize) {
        self.pending_work_us = micros_since(since);
        self.pending_locate = outcome as u8;
        self.pending_bytes = usize_to_u32(byte_len);
    }

    fn wrote(&mut self, since: Instant, outcome: WriteOutcome, byte_len: usize) {
        if outcome == WriteOutcome::Sent {
            self.pending_bytes = usize_to_u32(byte_len);
        }
        self.try_emit(outcome, micros_since(since));
    }

    fn refused(&mut self, _reason: Refusal) {
        // Facts already recorded via located/wrote on the refuse path.
    }
}

impl Drop for Tap {
    fn drop(&mut self) {
        if ACTIVE_TAPS.fetch_sub(1, Ordering::Relaxed) == 1 {
            shutdown_sink();
        }
    }
}

fn micros_since(start: Instant) -> u32 {
    start
        .elapsed()
        .as_micros()
        .min(u32::MAX as u128) as u32
}

fn usize_to_u32(n: usize) -> u32 {
    n.min(u32::MAX as usize) as u32
}

fn env_enabled(name: &str) -> bool {
    std::env::var(name)
        .map(|v| {
            let s = v.to_ascii_lowercase();
            s == "1" || s == "true" || s == "yes"
        })
        .unwrap_or(false)
}

fn sink_cell() -> &'static Mutex<Option<SyncSender<FrameRecord>>> {
    SINK.get_or_init(|| Mutex::new(None))
}

fn shutdown_sink() {
    if let Ok(mut guard) = sink_cell().lock() {
        *guard = None;
    }
}

fn ensure_sink(path: PathBuf) {
    let mut guard = sink_cell().lock().expect("telemetry sink lock");
    if guard.is_some() {
        return;
    }
    let (tx, rx) = sync_channel(RING_CAP);
    *guard = Some(tx);
    info!(path = %path.display(), cap = RING_CAP, "server telemetry sink started");
    std::thread::spawn(move || drain_loop(rx, path));
}

fn drain_loop(rx: std::sync::mpsc::Receiver<FrameRecord>, path: PathBuf) {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    let mut frames = Vec::new();
    let mut acc = RunAccumulator::default();
    while let Ok(row) = rx.recv() {
        acc.push(&row);
        frames.push(FrameRecordJson::from(row));
    }

    let written = frames.len() as u64;
    let report = TelemetryReport {
        summary: acc.build_summary(),
        server_frames: frames,
        run_end: RunEndMeta {
            event: "run_end",
            written_records: written,
            dropped_records: DROP_TOTAL.load(Ordering::Relaxed),
        },
    };

    match std::fs::File::create(&path) {
        Ok(file) => {
            let mut writer = std::io::BufWriter::new(file);
            match serde_json::to_writer_pretty(&mut writer, &report) {
                Ok(()) => {
                    let _ = writer.write_all(b"\n");
                    let _ = writer.flush();
                    info!(path = %path.display(), frames = written, "server telemetry report written");
                }
                Err(err) => warn!(%err, path = %path.display(), "telemetry: serialize failed"),
            }
        }
        Err(err) => warn!(%err, path = %path.display(), "telemetry: create report failed"),
    }
}

#[derive(serde::Serialize)]
struct TelemetryReport {
    summary: RunSummary,
    server_frames: Vec<FrameRecordJson>,
    run_end: RunEndMeta,
}

#[derive(serde::Serialize)]
struct RunEndMeta {
    event: &'static str,
    written_records: u64,
    dropped_records: u64,
}

#[derive(Default)]
struct RunAccumulator {
    work: Vec<u32>,
    write: Vec<u32>,
    serve: Vec<u32>,
    bytes: Vec<u32>,
}

impl RunAccumulator {
    fn push(&mut self, row: &FrameRecord) {
        self.work.push(row.server_work_us);
        self.write.push(row.server_write_us);
        self.serve.push(row.server_serve_us);
        self.bytes.push(row.server_bytes_sent);
    }

    fn build_summary(&self) -> RunSummary {
        RunSummary {
            frame_count: self.serve.len() as u32,
            totals: SummaryTotals {
                server_work_us: self.work.iter().map(|&v| u64::from(v)).sum(),
                server_write_us: self.write.iter().map(|&v| u64::from(v)).sum(),
                server_serve_us: self.serve.iter().map(|&v| u64::from(v)).sum(),
                server_bytes_sent: self.bytes.iter().map(|&v| u64::from(v)).sum(),
            },
            server_work_us: distribution_stats(&self.work),
            server_write_us: distribution_stats(&self.write),
            server_serve_us: distribution_stats(&self.serve),
            server_bytes_sent: distribution_stats(&self.bytes),
        }
    }
}

#[derive(serde::Serialize)]
struct RunSummary {
    frame_count: u32,
    totals: SummaryTotals,
    server_work_us: DistributionStats,
    server_write_us: DistributionStats,
    server_serve_us: DistributionStats,
    server_bytes_sent: DistributionStats,
}

#[derive(serde::Serialize)]
struct SummaryTotals {
    server_work_us: u64,
    server_write_us: u64,
    server_serve_us: u64,
    server_bytes_sent: u64,
}

#[derive(serde::Serialize)]
struct DistributionStats {
    count: u32,
    mean: f64,
    median: f64,
    min: u32,
    max: u32,
    total: u64,
    p50: f64,
    p75: f64,
    p90: f64,
    p95: f64,
    p99: f64,
}

fn distribution_stats(values: &[u32]) -> DistributionStats {
    if values.is_empty() {
        return DistributionStats {
            count: 0,
            mean: 0.0,
            median: 0.0,
            min: 0,
            max: 0,
            total: 0,
            p50: 0.0,
            p75: 0.0,
            p90: 0.0,
            p95: 0.0,
            p99: 0.0,
        };
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let count = sorted.len();
    let total: u64 = sorted.iter().map(|&v| u64::from(v)).sum();
    let mean = round2(total as f64 / f64::from(count as u32));
    let median = round2(percentile(&sorted, 50.0));
    DistributionStats {
        count: count as u32,
        mean,
        median,
        min: sorted[0],
        max: sorted[count - 1],
        total,
        p50: round2(percentile(&sorted, 50.0)),
        p75: round2(percentile(&sorted, 75.0)),
        p90: round2(percentile(&sorted, 90.0)),
        p95: round2(percentile(&sorted, 95.0)),
        p99: round2(percentile(&sorted, 99.0)),
    }
}

fn percentile(sorted: &[u32], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return f64::from(sorted[0]);
    }
    let rank = (sorted.len() - 1) as f64 * (p / 100.0);
    let lo = rank.floor() as usize;
    let hi = (lo + 1).min(sorted.len() - 1);
    if lo == hi {
        return f64::from(sorted[lo]);
    }
    let weight = rank - lo as f64;
    f64::from(sorted[lo]) + (f64::from(sorted[hi]) - f64::from(sorted[lo])) * weight
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[derive(serde::Serialize)]
struct FrameRecordJson {
    kind: &'static str,
    session_id: u64,
    frame_index: u32,
    ask_ordinal: u32,
    server_work_us: u32,
    server_write_us: u32,
    server_serve_us: u32,
    server_bytes_sent: u32,
    locate_outcome: u8,
    write_outcome: u8,
    dropped_since_last: u16,
}

impl From<FrameRecord> for FrameRecordJson {
    fn from(r: FrameRecord) -> Self {
        Self {
            kind: "server_frame",
            session_id: r.session_id,
            frame_index: r.frame_index,
            ask_ordinal: r.ask_ordinal,
            server_work_us: r.server_work_us,
            server_write_us: r.server_write_us,
            server_serve_us: r.server_serve_us,
            server_bytes_sent: r.server_bytes_sent,
            locate_outcome: r.locate_outcome,
            write_outcome: r.write_outcome,
            dropped_since_last: r.dropped_since_last,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_tap() -> Tap {
        Tap {
            session_id: 1,
            ordinals: HashMap::new(),
            frame_index: 0,
            ask_ordinal: 0,
            pending_work_us: 0,
            pending_bytes: 0,
            pending_locate: 0,
            drops_since_emit: 0,
            serve_start: None,
        }
    }

    #[test]
    fn ordinals_per_frame() {
        let mut t = test_tap();
        t.ask(7);
        assert_eq!(t.ask_ordinal, 0);
        t.ask(7);
        assert_eq!(t.ask_ordinal, 1);
        t.ask(3);
        assert_eq!(t.ask_ordinal, 0);
    }

    #[test]
    fn serve_span_starts_at_ask_and_ends_at_wrote() {
        use crate::record::Record;

        let mut t = test_tap();
        t.ask(0);
        assert!(t.serve_start.is_some());

        let t0 = t.stamp();
        t.located(t0, LocateOutcome::Ok, 4096);
        let t1 = t.stamp();
        t.wrote(t1, WriteOutcome::Sent, 4096);
        assert!(t.serve_start.is_none());
    }

    #[test]
    fn run_summary_percentiles() {
        let mut acc = RunAccumulator::default();
        for row in [
            FrameRecord {
                session_id: 1,
                frame_index: 0,
                ask_ordinal: 0,
                server_work_us: 0,
                server_write_us: 100,
                server_serve_us: 101,
                server_bytes_sent: 1000,
                locate_outcome: 0,
                write_outcome: 0,
                dropped_since_last: 0,
            },
            FrameRecord {
                session_id: 1,
                frame_index: 1,
                ask_ordinal: 0,
                server_work_us: 0,
                server_write_us: 300,
                server_serve_us: 305,
                server_bytes_sent: 2000,
                locate_outcome: 0,
                write_outcome: 0,
                dropped_since_last: 0,
            },
        ] {
            acc.push(&row);
        }
        let summary = acc.build_summary();
        assert_eq!(summary.frame_count, 2);
        assert_eq!(summary.totals.server_serve_us, 406);
        assert_eq!(summary.server_write_us.total, 400);
        assert_eq!(summary.server_write_us.min, 100);
        assert_eq!(summary.server_write_us.max, 300);
    }
}
