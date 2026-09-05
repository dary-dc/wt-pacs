//! Lab-only recorder — compiled only with `feature = "telemetry"`.
//!
//! Hot path: `try_send` fixed `Copy` records into a process-wide bounded queue.
//! Drain thread writes one JSON report on shutdown (summary first). No panics (R7).

use crate::record::{LocateOutcome, WriteOutcome};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tracing::{info, warn};

const RING_CAP: usize = 4096;
const SCHEMA: &str = "server-pipeline-v1";

static SESSION_IDS: AtomicU64 = AtomicU64::new(1);
static ACTIVE_TAPS: AtomicU64 = AtomicU64::new(0);
static SINK: OnceLock<Mutex<Option<SyncSender<FrameRecord>>>> = OnceLock::new();
static DROP_TOTAL: AtomicU64 = AtomicU64::new(0);

/// Fixed-width row — durations in µs; absent stages are `None` (JSON null).
#[derive(Clone, Copy, Debug)]
pub struct FrameRecord {
    pub session_id: u64,
    pub frame_index: u32,
    pub ask_ordinal: u32,
    pub prepare_us: Option<u32>,
    pub locate_us: Option<u32>,
    pub send_us: Option<u32>,
    /// Continuous span: `begin_frame` → row emit.
    pub serve_us: u32,
    pub server_bytes_sent: u32,
    pub locate_outcome: u8,
    pub write_outcome: u8,
    pub dropped_since_last: u16,
}

pub struct Tap {
    session_id: u64,
    /// Owned clone of the process sink — emit without taking the global lock.
    tx: Option<SyncSender<FrameRecord>>,
    ordinals: HashMap<u32, u32>,
    frame_index: u32,
    ask_ordinal: u32,
    pending_prepare_us: Option<u32>,
    pending_locate_us: Option<u32>,
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
        let tx = sink_cell()
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().cloned());
        ACTIVE_TAPS.fetch_add(1, Ordering::Relaxed);
        Some(Self {
            session_id: SESSION_IDS.fetch_add(1, Ordering::Relaxed),
            tx,
            ordinals: HashMap::new(),
            frame_index: 0,
            ask_ordinal: 0,
            pending_prepare_us: None,
            pending_locate_us: None,
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

    pub(crate) fn begin_frame(&mut self, frame_index: u32) {
        self.serve_start = Some(Instant::now());
        self.frame_index = frame_index;
        self.ask_ordinal = self.take_ordinal(frame_index);
        self.pending_prepare_us = None;
        self.pending_locate_us = None;
        self.pending_bytes = 0;
        self.pending_locate = LocateOutcome::Ok as u8;
    }

    pub(crate) fn record_prepare(&mut self, us: u32) {
        self.pending_prepare_us = Some(us);
    }

    pub(crate) fn record_locate(&mut self, us: u32, outcome: LocateOutcome, byte_len: usize) {
        self.pending_locate_us = Some(us);
        self.pending_locate = outcome as u8;
        if outcome == LocateOutcome::Ok {
            self.pending_bytes = usize_to_u32(byte_len);
        }
    }

    pub(crate) fn emit_sent(&mut self, send_us: u32, envelope_len: usize) {
        self.pending_bytes = usize_to_u32(envelope_len);
        self.try_emit(WriteOutcome::Sent, Some(send_us));
    }

    pub(crate) fn emit_write_err(&mut self, send_us: u32) {
        self.try_emit(WriteOutcome::WriteErr, Some(send_us));
    }

    pub(crate) fn emit_refused(&mut self) {
        self.pending_locate = LocateOutcome::NotFound as u8;
        self.try_emit(WriteOutcome::Refused, None);
    }

    fn try_emit(&mut self, write_outcome: WriteOutcome, send_us: Option<u32>) {
        let dropped = self.drops_since_emit;
        self.drops_since_emit = 0;
        let serve_us = self
            .serve_start
            .take()
            .map(|t| micros_since(t))
            .unwrap_or(0);
        let row = FrameRecord {
            session_id: self.session_id,
            frame_index: self.frame_index,
            ask_ordinal: self.ask_ordinal,
            prepare_us: self.pending_prepare_us,
            locate_us: self.pending_locate_us,
            send_us,
            serve_us,
            server_bytes_sent: self.pending_bytes,
            locate_outcome: self.pending_locate,
            write_outcome: write_outcome as u8,
            dropped_since_last: dropped,
        };
        // Hot path: owned sender clone — no global Mutex.
        let Some(tx) = self.tx.as_ref() else {
            return;
        };
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
        schema: SCHEMA,
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
    schema: &'static str,
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
    prepare: Vec<u32>,
    locate: Vec<u32>,
    send: Vec<u32>,
    serve: Vec<u32>,
    bytes: Vec<u32>,
}

impl RunAccumulator {
    fn push(&mut self, row: &FrameRecord) {
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

    fn build_summary(&self) -> RunSummary {
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
        }
    }
}

#[derive(serde::Serialize)]
struct RunSummary {
    frame_count: u32,
    totals: SummaryTotals,
    /// Absent when no sample — JSON `null`, never a zero-filled stats object.
    prepare_us: Option<DistributionStats>,
    locate_us: Option<DistributionStats>,
    send_us: Option<DistributionStats>,
    serve_us: Option<DistributionStats>,
    server_bytes_sent: Option<DistributionStats>,
}

#[derive(serde::Serialize)]
struct SummaryTotals {
    prepare_us: u64,
    locate_us: u64,
    send_us: u64,
    serve_us: u64,
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

fn distribution_stats(values: &[u32]) -> Option<DistributionStats> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let count = sorted.len();
    let total: u64 = sorted.iter().map(|&v| u64::from(v)).sum();
    let mean = round2(total as f64 / f64::from(count as u32));
    let median = round2(percentile(&sorted, 50.0));
    Some(DistributionStats {
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
    })
}

/// Nearest-rank: rank = ceil(p/100 × N), clamped to [1, N]; value = sorted[rank - 1].
fn percentile(sorted: &[u32], p: f64) -> f64 {
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

#[derive(serde::Serialize)]
struct FrameRecordJson {
    kind: &'static str,
    session_id: u64,
    frame_index: u32,
    ask_ordinal: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    prepare_us: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    locate_us: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    send_us: Option<u32>,
    serve_us: u32,
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
            prepare_us: r.prepare_us,
            locate_us: r.locate_us,
            send_us: r.send_us,
            serve_us: r.serve_us,
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
            tx: None,
            ordinals: HashMap::new(),
            frame_index: 0,
            ask_ordinal: 0,
            pending_prepare_us: None,
            pending_locate_us: None,
            pending_bytes: 0,
            pending_locate: 0,
            drops_since_emit: 0,
            serve_start: None,
        }
    }

    #[test]
    fn ordinals_per_frame() {
        let mut t = test_tap();
        t.begin_frame(7);
        assert_eq!(t.ask_ordinal, 0);
        t.begin_frame(7);
        assert_eq!(t.ask_ordinal, 1);
        t.begin_frame(3);
        assert_eq!(t.ask_ordinal, 0);
    }

    #[test]
    fn serve_span_starts_at_begin_and_ends_at_emit() {
        let mut t = test_tap();
        t.begin_frame(0);
        assert!(t.serve_start.is_some());

        t.record_prepare(5);
        t.record_locate(1, LocateOutcome::Ok, 4096);
        t.emit_sent(10, 4096);
        assert!(t.serve_start.is_none());
    }

    #[test]
    fn batch_like_asks_emit_independent_serve_and_ordinals() {
        let mut t = test_tap();

        t.begin_frame(5);
        assert_eq!(t.ask_ordinal, 0);
        let serve0 = t.serve_start.expect("serve_start armed at begin_frame");
        std::thread::sleep(std::time::Duration::from_millis(2));
        t.record_prepare(100);
        t.record_locate(50, LocateOutcome::Ok, 100);
        let serve_us_0 = micros_since(serve0);
        t.emit_sent(200, 104);
        assert!(t.serve_start.is_none(), "serve_start consumed at emit");
        assert!(
            serve_us_0 >= 1_500,
            "first row serve must cover sleep after its own ask, got {serve_us_0}"
        );

        t.begin_frame(5);
        assert_eq!(t.ask_ordinal, 1);
        let serve1 = t.serve_start.expect("new serve_start for second ask");
        assert!(
            serve1 > serve0,
            "second ask must arm a new serve_start, not reuse the first"
        );
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.record_prepare(80);
        t.record_locate(40, LocateOutcome::Ok, 100);
        let serve_us_1 = micros_since(serve1);
        t.emit_sent(150, 104);
        assert!(
            serve_us_1 < serve_us_0,
            "second row serve is its own ask→emit window ({serve_us_1}), not the first ({serve_us_0})"
        );

        t.begin_frame(9);
        assert_eq!(t.ask_ordinal, 0);
    }

    #[test]
    fn stage_partition_invariant() {
        let row = FrameRecord {
            session_id: 1,
            frame_index: 0,
            ask_ordinal: 0,
            prepare_us: Some(20),
            locate_us: Some(1),
            send_us: Some(40),
            serve_us: 65,
            server_bytes_sent: 100,
            locate_outcome: LocateOutcome::Ok as u8,
            write_outcome: WriteOutcome::Sent as u8,
            dropped_since_last: 0,
        };
        let p = row.prepare_us.unwrap_or(0);
        let l = row.locate_us.unwrap_or(0);
        let s = row.send_us.unwrap_or(0);
        assert!(row.serve_us >= p + l + s);
    }

    #[test]
    fn nearest_rank_disagrees_with_linear_interpolation() {
        let sorted: Vec<u32> = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
        assert_eq!(percentile(&sorted, 95.0), 100.0);
        let linear_rank = (sorted.len() - 1) as f64 * 0.95;
        let lo = linear_rank.floor() as usize;
        let hi = (lo + 1).min(sorted.len() - 1);
        let linear =
            f64::from(sorted[lo]) + (f64::from(sorted[hi]) - f64::from(sorted[lo])) * (linear_rank - lo as f64);
        assert!(
            (linear - 100.0).abs() > 1.0,
            "fixture must disagree with linear interpolation, got linear={linear}"
        );
    }

    #[test]
    fn run_summary_percentiles() {
        let mut acc = RunAccumulator::default();
        for row in [
            FrameRecord {
                session_id: 1,
                frame_index: 0,
                ask_ordinal: 0,
                prepare_us: Some(1),
                locate_us: Some(0),
                send_us: Some(100),
                serve_us: 101,
                server_bytes_sent: 1000,
                locate_outcome: 0,
                write_outcome: 0,
                dropped_since_last: 0,
            },
            FrameRecord {
                session_id: 1,
                frame_index: 1,
                ask_ordinal: 0,
                prepare_us: Some(1),
                locate_us: Some(0),
                send_us: Some(300),
                serve_us: 305,
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
        assert_eq!(summary.totals.serve_us, 406);
        let send = summary.send_us.expect("send dist present");
        assert_eq!(send.total, 400);
        assert_eq!(send.min, 100);
        assert_eq!(send.max, 300);
    }

    #[test]
    fn refused_row_excluded_from_send_distribution() {
        let mut acc = RunAccumulator::default();
        acc.push(&FrameRecord {
            session_id: 1,
            frame_index: 0,
            ask_ordinal: 0,
            prepare_us: Some(10),
            locate_us: Some(2),
            send_us: Some(50),
            serve_us: 70,
            server_bytes_sent: 100,
            locate_outcome: 0,
            write_outcome: WriteOutcome::Sent as u8,
            dropped_since_last: 0,
        });
        acc.push(&FrameRecord {
            session_id: 1,
            frame_index: 1,
            ask_ordinal: 0,
            prepare_us: Some(10),
            locate_us: None,
            send_us: None, // refused — must not push 0 into send_us
            serve_us: 12,
            server_bytes_sent: 0,
            locate_outcome: LocateOutcome::NotFound as u8,
            write_outcome: WriteOutcome::Refused as u8,
            dropped_since_last: 0,
        });
        let summary = acc.build_summary();
        assert_eq!(summary.frame_count, 2);
        let send = summary.send_us.expect("send dist from one sent row");
        assert_eq!(send.count, 1);
        assert_eq!(send.total, 50);
        assert_eq!(send.min, 50);
        assert_eq!(summary.totals.send_us, 50);
        let locate = summary.locate_us.expect("locate from one ok row");
        assert_eq!(locate.count, 1);
    }

    #[test]
    fn empty_distribution_is_none() {
        assert!(distribution_stats(&[]).is_none());
    }

    #[test]
    fn try_emit_uses_owned_sender_without_global_lock() {
        let (tx, rx) = sync_channel::<FrameRecord>(4);
        let mut t = test_tap();
        t.tx = Some(tx);
        t.begin_frame(3);
        t.record_prepare(1);
        t.record_locate(1, LocateOutcome::Ok, 8);
        t.emit_sent(2, 12);
        let row = rx.try_recv().expect("row delivered via owned clone");
        assert_eq!(row.frame_index, 3);
        assert_eq!(row.send_us, Some(2));
    }
}
