//! Lab-only Tap hot path — compiled only with `feature = "telemetry"`.
//!
//! Sink/drain/report live in sibling modules. Hot path: build a `Copy` row and push it into a
//! per-session batch; one `try_send` on an owned `SyncSender` clone per [`BATCH`] rows — no
//! global lock, and no drain-thread wake per row.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::time::{Duration, Instant};

use super::sink::{clone_sender, ensure_sink, shutdown_sink};

/// Ring capacity in rows; the channel holds `RING_CAP / BATCH` batches.
pub(super) const RING_CAP: usize = 4096;
/// Rows per channel send — one drain wake per batch instead of per row.
pub(super) const BATCH: usize = 64;

pub(super) static SESSION_IDS: AtomicU64 = AtomicU64::new(1);
pub(super) static ACTIVE_TAPS: AtomicU64 = AtomicU64::new(0);
pub(super) static DROP_TOTAL: AtomicU64 = AtomicU64::new(0);
pub(super) static ROWS_OPENED: AtomicU64 = AtomicU64::new(0);
pub(super) static ROWS_CLOSED: AtomicU64 = AtomicU64::new(0);
pub(super) static SESSIONS_STARTED: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum WriteOutcome {
    Sent = 0,
    Failed = 1,
    Refused = 2,
}

/// Process clock origin for `t_serve_us` — set when the first Tap is created, so rows from every
/// session in a run share one axis and can be laid beside the client file offline.
static ORIGIN: OnceLock<Instant> = OnceLock::new();

fn origin() -> Instant {
    *ORIGIN.get_or_init(Instant::now)
}

fn since_origin_us() -> u64 {
    Instant::now()
        .duration_since(origin())
        .as_micros()
        .min(u64::MAX as u128) as u64
}

/// What the server was serving — stamped into the report so a `telemetry-server.json` can be
/// checked against the client file it sits beside (stream mode, fixture) without a filename.
#[derive(Clone, Debug, serde::Serialize)]
pub struct RunMeta {
    pub stream_mode: String,
    pub study: String,
    /// Frames in the study bundle (the summary's `frame_count` is rows recorded).
    pub study_frames: u32,
}

static RUN_META: OnceLock<RunMeta> = OnceLock::new();

/// Record run metadata once per process (first call wins).
pub fn set_run_meta(meta: RunMeta) {
    let _ = RUN_META.set(meta);
}

pub(super) fn run_meta() -> Option<RunMeta> {
    RUN_META.get().cloned()
}

/// Fixed-width row — durations in µs; absent stages are `None` (JSON null).
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct FrameRecord {
    pub kind: &'static str,
    pub session_id: u64,
    pub frame_index: u32,
    pub ask_ordinal: u32,
    /// Serving began, µs since the process telemetry origin (first Tap): not when the ask
    /// arrived, which may have queued. `docs/adr/telemetry-server-pipeline.md`.
    pub t_serve_us: u64,
    /// Until the frame's bytes are in hand, starting the next frame's read included.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_us: Option<u32>,
    /// Until quinn, or the WebSocket, has accepted the frame.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_us: Option<u32>,
    /// `begin_frame` → row emit; equals `read_us + write_us` to within their rounding.
    pub serve_us: u32,
    pub server_bytes_sent: u32,
    pub write_outcome: u8,
    pub dropped_since_last: u16,
}

/// One per session, emitted when the Tap drops. Carries the session's own integrity counters.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct SessionRecord {
    pub kind: &'static str,
    pub session_id: u64,
    pub t_open_us: u64,
    pub t_close_us: u64,
    /// Frames sent (write outcome `Sent`).
    pub frames: u32,
    pub bytes: u64,
    pub refused: u32,
    pub rows_opened: u32,
    pub rows_closed: u32,
    pub rows_dropped: u32,
}

/// What travels through the channel and into the row file.
#[derive(Clone, Copy, Debug)]
pub enum Record {
    Frame(FrameRecord),
    Session(SessionRecord),
}

pub type Batch = Vec<Record>;

/// A live session's buffered rows. Shared because a shutdown has to take them from outside the
/// session's own task: a session still open at SIGTERM never drops its `Tap`, and its tail would
/// go with it. docs/adr/telemetry-server-pipeline.md#the-tail-at-sigterm.
type Pending = Arc<Mutex<Batch>>;

/// The live sessions' buffers. The process has one; a test that takes from it makes its own.
#[derive(Default)]
pub(crate) struct Live(Mutex<Vec<Weak<Mutex<Batch>>>>);

pub(crate) static LIVE: Live = Live(Mutex::new(Vec::new()));

impl Live {
    fn register(&self, batch: &Pending) {
        if let Ok(mut live) = self.0.lock() {
            live.retain(|w| w.strong_count() > 0);
            live.push(Arc::downgrade(batch));
        }
    }

    /// Take what every live session has buffered. Bounded by `deadline`: a batch its own task is
    /// holding right now is retried and then skipped, so this can never wait on a session.
    pub(super) fn take(&self, deadline: Duration) -> Vec<Batch> {
        let handles: Vec<Pending> = match self.0.lock() {
            Ok(live) => live.iter().filter_map(Weak::upgrade).collect(),
            Err(_) => return Vec::new(),
        };
        let give_up = Instant::now() + deadline;
        let mut taken = Vec::new();
        for handle in handles {
            loop {
                if let Ok(mut batch) = handle.try_lock() {
                    if !batch.is_empty() {
                        taken.push(std::mem::take(&mut *batch));
                    }
                    break;
                }
                if Instant::now() >= give_up {
                    break;
                }
                std::thread::yield_now();
            }
        }
        taken
    }
}

/// Held by every session `for_session` opens; the last one dropped closes the sink, so the
/// report is written.
struct Counted;

impl Counted {
    fn enter() -> Self {
        ACTIVE_TAPS.fetch_add(1, Ordering::Relaxed);
        Self
    }
}

impl Drop for Counted {
    fn drop(&mut self) {
        if ACTIVE_TAPS.fetch_sub(1, Ordering::Relaxed) == 1 {
            shutdown_sink();
        }
    }
}

pub struct Tap {
    session_id: u64,
    counted: Option<Counted>,
    /// Owned clone of the process sink — emit without taking the global lock.
    tx: Option<SyncSender<Batch>>,
    batch: Pending,
    ordinals: HashMap<u32, u32>,
    frame_index: u32,
    ask_ordinal: u32,
    pending_read_us: Option<u32>,
    pending_bytes: u32,
    drops_since_emit: u16,
    serve_start: Option<Instant>,
    /// End of last closed stage = start of next (contiguous chain).
    stage_mark: Option<Instant>,
    t_serve_us: u64,
    // Session counters — the session row and its integrity block.
    t_open_us: u64,
    frames: u32,
    bytes: u64,
    refused: u32,
    rows_opened: u32,
    rows_closed: u32,
    rows_dropped: u32,
}

impl Tap {
    /// Enabled when `WTPACS_TELEMETRY` is `1` / `true` / `yes`. Path from `WTPACS_TELEMETRY_PATH`
    /// (default `telemetry-server.json`; rows go beside it as `.rows`). Report is written on a
    /// timer and when the last session ends or the process is told to flush.
    pub fn for_session() -> Option<Self> {
        if !env_enabled("WTPACS_TELEMETRY") {
            return None;
        }
        let path = std::env::var("WTPACS_TELEMETRY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("telemetry-server.json"));
        ensure_sink(path);
        // Anchor the row clock at the first session's start, so the first row's `t_serve_us`
        // is connect → first serve and later sessions share the axis.
        let _ = origin();
        let tx = clone_sender();
        SESSIONS_STARTED.fetch_add(1, Ordering::Relaxed);
        let mut tap = Self::new(SESSION_IDS.fetch_add(1, Ordering::Relaxed), tx, &LIVE);
        tap.counted = Some(Counted::enter());
        Some(tap)
    }

    pub(crate) fn new(session_id: u64, tx: Option<SyncSender<Batch>>, live: &Live) -> Self {
        let batch: Pending = Arc::new(Mutex::new(Vec::with_capacity(BATCH)));
        live.register(&batch);
        Self {
            session_id,
            counted: None,
            tx,
            batch,
            ordinals: HashMap::new(),
            frame_index: 0,
            ask_ordinal: 0,
            pending_read_us: None,
            pending_bytes: 0,
            drops_since_emit: 0,
            serve_start: None,
            stage_mark: None,
            t_serve_us: 0,
            t_open_us: since_origin_us(),
            frames: 0,
            bytes: 0,
            refused: 0,
            rows_opened: 0,
            rows_closed: 0,
            rows_dropped: 0,
        }
    }

    fn take_ordinal(&mut self, frame_index: u32) -> u32 {
        let entry = self.ordinals.entry(frame_index).or_insert(0);
        let n = *entry;
        *entry = entry.saturating_add(1);
        n
    }

    pub(crate) fn begin_frame(&mut self, frame_index: u32) {
        ROWS_OPENED.fetch_add(1, Ordering::Relaxed);
        self.rows_opened = self.rows_opened.saturating_add(1);
        let t = Instant::now();
        self.t_serve_us = t.duration_since(origin()).as_micros().min(u64::MAX as u128) as u64;
        self.serve_start = Some(t);
        self.stage_mark = Some(t);
        self.frame_index = frame_index;
        self.ask_ordinal = self.take_ordinal(frame_index);
        self.pending_read_us = None;
        self.pending_bytes = 0;
    }

    /// The frame's bytes are in hand: close `read` against the mark and open `write`.
    pub(crate) fn boundary_read_done(&mut self) {
        let now = Instant::now();
        self.pending_read_us = self.stage_mark.replace(now).map(|mark| duration_us(mark, now));
    }

    pub(crate) fn emit_sent(&mut self, envelope_len: usize) {
        self.pending_bytes = usize_to_u32(envelope_len);
        self.try_emit(WriteOutcome::Sent);
    }

    /// A failed read leaves both stages null.
    pub(crate) fn emit_failed(&mut self) {
        self.try_emit(WriteOutcome::Failed);
    }

    /// The planner's refusal: its own row, with no stage, since nothing was read or written.
    pub(crate) fn emit_refused(&mut self, frame_index: u32) {
        self.begin_frame(frame_index);
        self.stage_mark = None;
        self.try_emit(WriteOutcome::Refused);
    }

    fn try_emit(&mut self, write_outcome: WriteOutcome) {
        let dropped = self.drops_since_emit;
        self.drops_since_emit = 0;
        let now = Instant::now();
        let read_us = self.pending_read_us.take();
        let write_us = match (read_us, self.stage_mark.take()) {
            (Some(_), Some(mark)) => Some(duration_us(mark, now)),
            _ => None,
        };
        let serve_us = self
            .serve_start
            .take()
            .map(|t| duration_us(t, now))
            .unwrap_or(0);
        let row = FrameRecord {
            kind: "server_frame",
            session_id: self.session_id,
            frame_index: self.frame_index,
            ask_ordinal: self.ask_ordinal,
            t_serve_us: self.t_serve_us,
            read_us,
            write_us,
            serve_us,
            server_bytes_sent: self.pending_bytes,
            write_outcome: write_outcome as u8,
            dropped_since_last: dropped,
        };
        match write_outcome {
            WriteOutcome::Sent => {
                self.frames = self.frames.saturating_add(1);
                self.bytes = self.bytes.saturating_add(u64::from(self.pending_bytes));
            }
            WriteOutcome::Refused => self.refused = self.refused.saturating_add(1),
            WriteOutcome::Failed => {}
        }
        self.push(Record::Frame(row));
    }

    #[cfg(test)]
    pub(super) fn buffer_for_test(&mut self, rec: Record) {
        self.push(rec);
    }

    fn push(&mut self, rec: Record) {
        let full = match self.batch.lock() {
            Ok(mut batch) => {
                batch.push(rec);
                batch.len() >= BATCH
            }
            Err(_) => false,
        };
        if full {
            self.flush_batch();
        }
    }

    /// One channel op for the whole batch. A full ring drops the batch; the rows are counted
    /// so the next row's `dropped_since_last` and the integrity blocks say so.
    pub(crate) fn flush_batch(&mut self) {
        let batch = match self.batch.lock() {
            Ok(mut held) if !held.is_empty() => {
                std::mem::replace(&mut *held, Vec::with_capacity(BATCH))
            }
            _ => return,
        };
        let frames = batch
            .iter()
            .filter(|r| matches!(r, Record::Frame(_)))
            .count() as u64;
        let Some(tx) = self.tx.as_ref() else {
            return;
        };
        match tx.try_send(batch) {
            Ok(()) => {
                ROWS_CLOSED.fetch_add(frames, Ordering::Relaxed);
                self.rows_closed = self.rows_closed.saturating_add(frames as u32);
            }
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                DROP_TOTAL.fetch_add(frames, Ordering::Relaxed);
                self.rows_dropped = self.rows_dropped.saturating_add(frames as u32);
                self.drops_since_emit = self
                    .drops_since_emit
                    .saturating_add(frames.min(u16::MAX as u64) as u16);
            }
        }
    }

    fn session_record(&self) -> SessionRecord {
        SessionRecord {
            kind: "server_session",
            session_id: self.session_id,
            t_open_us: self.t_open_us,
            t_close_us: since_origin_us(),
            frames: self.frames,
            bytes: self.bytes,
            refused: self.refused,
            rows_opened: self.rows_opened,
            rows_closed: self.rows_closed,
            rows_dropped: self.rows_dropped,
        }
    }
}

impl Drop for Tap {
    fn drop(&mut self) {
        // The session row is the last thing the session says; counters are final once the
        // batch before it is accounted for.
        self.flush_batch();
        let session = self.session_record();
        if let Ok(mut batch) = self.batch.lock() {
            batch.push(Record::Session(session));
        }
        self.flush_batch();
    }
}

fn duration_us(start: Instant, end: Instant) -> u32 {
    end.duration_since(start).as_micros().min(u32::MAX as u128) as u32
}

fn usize_to_u32(n: usize) -> u32 {
    n.min(u32::MAX as usize) as u32
}

pub(super) fn env_enabled(name: &str) -> bool {
    std::env::var(name)
        .map(|v| {
            let s = v.to_ascii_lowercase();
            s == "1" || s == "true" || s == "yes"
        })
        .unwrap_or(false)
}

pub(super) fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record::report::{distribution_stats, percentile, RunAccumulator};
    use std::sync::mpsc::{sync_channel, Receiver};

    fn test_tap() -> Tap {
        Tap::new(1, None, &Live::default())
    }

    fn test_tap_with_channel(cap_batches: usize) -> (Tap, Receiver<Batch>) {
        let (tx, rx) = sync_channel::<Batch>(cap_batches);
        (Tap::new(1, Some(tx), &Live::default()), rx)
    }

    /// Everything queued so far, flattened.
    fn drain_all(rx: &Receiver<Batch>) -> Vec<Record> {
        std::iter::from_fn(|| rx.try_recv().ok())
            .flatten()
            .collect()
    }

    fn frames(records: &[Record]) -> Vec<FrameRecord> {
        records
            .iter()
            .filter_map(|r| match r {
                Record::Frame(f) => Some(*f),
                _ => None,
            })
            .collect()
    }

    /// Flush, then the one frame row the test expects.
    fn one_row(t: &mut Tap, rx: &Receiver<Batch>) -> FrameRecord {
        t.flush_batch();
        let rows = frames(&drain_all(rx));
        assert_eq!(rows.len(), 1, "expected exactly one frame row");
        rows[0]
    }

    fn sample_row(read: Option<u32>, write: Option<u32>, serve: u32) -> FrameRecord {
        FrameRecord {
            kind: "server_frame",
            session_id: 1,
            frame_index: 0,
            ask_ordinal: 0,
            t_serve_us: 0,
            read_us: read,
            write_us: write,
            serve_us: serve,
            server_bytes_sent: 100,
            write_outcome: 0,
            dropped_since_last: 0,
        }
    }

    fn serve_frame(t: &mut Tap, frame: u32, bytes: usize) {
        t.begin_frame(frame);
        t.boundary_read_done();
        t.emit_sent(bytes + 4);
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
        t.begin_frame(1);
        assert!(t.serve_start.is_some());
        assert!(t.stage_mark.is_some());
        t.boundary_read_done();
        t.emit_sent(16);
        assert!(t.serve_start.is_none());
        assert!(t.stage_mark.is_none());
    }

    #[test]
    fn batch_like_asks_emit_independent_serve_and_ordinals() {
        let mut t = test_tap();
        t.begin_frame(5);
        assert_eq!(t.ask_ordinal, 0);
        let serve0 = t.serve_start.expect("serve_start armed");
        std::thread::sleep(std::time::Duration::from_millis(20));
        t.boundary_read_done();
        let before_emit = Instant::now();
        t.emit_sent(104);
        let serve_us_0 = duration_us(serve0, before_emit);
        assert!(t.serve_start.is_none());
        assert!(serve_us_0 >= 20_000, "got {serve_us_0}");

        t.begin_frame(5);
        assert_eq!(t.ask_ordinal, 1);
        let serve1 = t.serve_start.expect("new serve_start");
        assert!(serve1 > serve0);
        t.boundary_read_done();
        let before_emit1 = Instant::now();
        t.emit_sent(104);
        let serve_us_1 = duration_us(serve1, before_emit1);
        assert!(serve_us_1 < serve_us_0);
        t.begin_frame(9);
        assert_eq!(t.ask_ordinal, 0);
    }

    /// `read` and `write` are contiguous, so they partition `serve_us` but for each one's
    /// truncation to whole µs.
    #[test]
    fn contiguous_emit_partition_holds() {
        let (mut t, rx) = test_tap_with_channel(4);
        t.begin_frame(2);
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.boundary_read_done();
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.emit_sent(16);
        let row = one_row(&mut t, &rx);
        let (read, write) = (row.read_us.expect("read"), row.write_us.expect("write"));
        assert!(read >= 1_000 && write >= 1_000, "read {read} write {write}");
        assert!((0..=1).contains(&(row.serve_us - read - write)), "{row:?}");
    }

    #[test]
    fn nearest_rank_disagrees_with_linear_interpolation() {
        let sorted: Vec<u32> = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
        assert_eq!(percentile(&sorted, 95.0), 100.0);
        let linear_rank = (sorted.len() - 1) as f64 * 0.95;
        let lo = linear_rank.floor() as usize;
        let hi = (lo + 1).min(sorted.len() - 1);
        let linear = f64::from(sorted[lo])
            + (f64::from(sorted[hi]) - f64::from(sorted[lo])) * (linear_rank - lo as f64);
        assert!((linear - 100.0).abs() > 1.0);
    }

    /// Same vector as the harness and client tests: N = 20, p95 → sorted[18] = 19.
    #[test]
    fn p95_shared_vector_n20() {
        let mut v: Vec<u32> = (1..=19).collect();
        v.push(100);
        assert_eq!(percentile(&v, 95.0), 19.0);
    }

    #[test]
    fn run_summary_percentiles() {
        let mut acc = RunAccumulator::default();
        acc.push(&sample_row(Some(1), Some(100), 101));
        acc.push(&FrameRecord {
            frame_index: 1,
            server_bytes_sent: 2000,
            ..sample_row(Some(5), Some(300), 305)
        });
        let summary = acc.build_summary();
        assert_eq!(summary.frame_count, 2);
        assert_eq!(summary.totals.serve_us, 406);
        let write = summary.write_us.expect("write");
        assert_eq!(write.total, 400);
        assert_eq!(write.min, 100);
        assert_eq!(write.max, 300);
        assert_eq!(summary.totals.read_us, 6);
    }

    #[test]
    fn refused_row_excluded_from_stage_distributions() {
        let mut acc = RunAccumulator::default();
        acc.push(&sample_row(Some(10), Some(50), 60));
        acc.push(&FrameRecord {
            frame_index: 1,
            server_bytes_sent: 0,
            write_outcome: WriteOutcome::Refused as u8,
            ..sample_row(None, None, 2)
        });
        let summary = acc.build_summary();
        assert_eq!(summary.frame_count, 2);
        let write = summary.write_us.expect("write");
        assert_eq!(write.count, 1);
        assert_eq!(write.total, 50);
        assert_eq!(summary.totals.write_us, 50);
        assert_eq!(summary.read_us.expect("read").count, 1);
    }

    #[test]
    fn empty_distribution_is_none() {
        assert!(distribution_stats(&[]).is_none());
    }

    /// A refusal is its own row, of the refused frame, with neither stage: nothing was read.
    #[test]
    fn a_refusal_is_a_row_with_no_stage() {
        let (mut t, rx) = test_tap_with_channel(4);
        t.emit_refused(7);
        let row = one_row(&mut t, &rx);
        assert_eq!(row.frame_index, 7);
        assert_eq!((row.read_us, row.write_us), (None, None));
        assert_eq!(row.write_outcome, WriteOutcome::Refused as u8);
        assert_eq!((t.refused, t.rows_opened), (1, 1));
    }

    /// A read that fails leaves both stages null rather than calling its time a write.
    #[test]
    fn a_failed_read_has_no_write_stage() {
        let (mut t, rx) = test_tap_with_channel(4);
        t.begin_frame(3);
        t.emit_failed();
        let row = one_row(&mut t, &rx);
        assert_eq!((row.read_us, row.write_us), (None, None));
        assert_eq!(row.write_outcome, WriteOutcome::Failed as u8);
    }

    #[test]
    fn t_serve_us_advances_between_frames() {
        let mut t = test_tap();
        t.begin_frame(1);
        let a = t.t_serve_us;
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.begin_frame(2);
        assert!(t.t_serve_us >= a + 1_000, "got {} then {}", a, t.t_serve_us);
    }

    #[test]
    fn try_emit_uses_owned_sender_without_global_lock() {
        let (mut t, rx) = test_tap_with_channel(4);
        serve_frame(&mut t, 3, 8);
        let row = one_row(&mut t, &rx);
        assert_eq!(row.frame_index, 3);
        assert_eq!(row.kind, "server_frame");
    }

    /// The point of batching: `BATCH` rows cost one channel send, `BATCH − 1` cost none.
    #[test]
    fn rows_ride_one_channel_send_per_batch() {
        let (mut t, rx) = test_tap_with_channel(8);
        for i in 0..(BATCH as u32 - 1) {
            serve_frame(&mut t, i, 8);
        }
        assert!(rx.try_recv().is_err(), "no send before the batch is full");
        serve_frame(&mut t, 99, 8);
        let batch = rx.try_recv().expect("one batch");
        assert_eq!(batch.len(), BATCH);
        assert!(rx.try_recv().is_err());
        assert_eq!(t.rows_closed as usize, BATCH);
        assert_eq!(t.rows_opened as usize, BATCH);
    }

    /// A full ring drops the whole batch; the loss is counted on the session and on the next row.
    #[test]
    fn full_ring_drops_a_batch_and_counts_it() {
        let (mut t, rx) = test_tap_with_channel(1);
        for i in 0..(2 * BATCH as u32) {
            serve_frame(&mut t, i, 8);
        }
        assert_eq!(t.rows_dropped as usize, BATCH);
        assert_eq!(t.rows_closed as usize, BATCH);
        serve_frame(&mut t, 1000, 8);
        let _ = drain_all(&rx);
        t.flush_batch();
        let rows = frames(&drain_all(&rx));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].dropped_since_last as usize, BATCH);
    }

    /// The session row is the last record of a session and carries its own integrity.
    #[test]
    fn drop_emits_session_row_last_with_counters() {
        let (mut t, rx) = test_tap_with_channel(8);
        serve_frame(&mut t, 1, 100);
        serve_frame(&mut t, 2, 100);
        t.emit_refused(3);
        drop(t);
        let records = drain_all(&rx);
        let Some(Record::Session(s)) = records.last() else {
            panic!("session row last");
        };
        assert_eq!(s.frames, 2);
        assert_eq!(s.bytes, 208);
        assert_eq!(s.refused, 1);
        assert_eq!(s.rows_opened, 3);
        assert_eq!(s.rows_closed, 3);
        assert_eq!(s.rows_dropped, 0);
        assert!(s.t_close_us >= s.t_open_us);
        assert_eq!(frames(&records).len(), 3);
        assert!(records
            .iter()
            .all(|r| matches!(r, Record::Frame(_) | Record::Session(_))));
    }

    /// A session mid-push must not be able to hold up a shutdown: the deadline wins.
    #[test]
    fn taking_live_batches_gives_up_on_a_held_batch() {
        let live = Live::default();
        let tap = Tap::new(77, None, &live);
        let held = Arc::clone(&tap.batch);
        held.lock().expect("hold the batch").push(Record::Session(SessionRecord {
            kind: "server_session",
            session_id: 77,
            t_open_us: 0,
            t_close_us: 0,
            frames: 0,
            bytes: 0,
            refused: 0,
            rows_opened: 0,
            rows_closed: 0,
            rows_dropped: 0,
        }));

        let guard = held.lock().expect("still holding");
        let started = Instant::now();
        let taken = live.take(Duration::from_millis(20));
        let waited = started.elapsed();
        drop(guard);

        assert!(
            waited < Duration::from_millis(500),
            "shutdown waited {waited:?} on a held batch"
        );
        assert!(
            taken.iter().all(|b| b.is_empty()) || taken.is_empty(),
            "a batch held by its own task should be skipped, not taken"
        );
        std::mem::forget(tap);
    }

    /// Taps other tests hold, rows buffered, must stay out of any other test's take of the
    /// live sessions, and out of the process's.
    #[test]
    fn taps_made_elsewhere_stay_out_of_every_other_take() {
        let until = Instant::now() + Duration::from_millis(300);
        let mut taps: Vec<Tap> = (0..4).map(|_| test_tap()).collect();
        while Instant::now() < until {
            for t in &mut taps {
                serve_frame(t, 1, 8);
            }
            std::thread::sleep(Duration::from_micros(200));
        }
    }
}
