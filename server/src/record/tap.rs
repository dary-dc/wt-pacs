//! Lab-only Tap hot path — compiled only with `feature = "telemetry"`.
//!
//! Sink/drain/report live in sibling modules. Hot path: build a `Copy` row and push it into a
//! per-session batch; one `try_send` on an owned `SyncSender` clone per [`BATCH`] rows — no
//! global lock, and no drain-thread wake per row. Peer acknowledgements arrive from
//! `FrameOut`'s ack tasks through an [`AckInbox`] and ride the next batch.

use crate::record::{LocateOutcome, WriteOutcome};
use crate::transport::frame_out::AckHook;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Arc, Mutex, OnceLock};
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
/// Every session the server accepted while telemetry was on, sampled or not.
pub(super) static SESSIONS_SEEN: AtomicU64 = AtomicU64::new(0);

/// Process clock origin for `t_ask_us` — set when the first Tap is created, so rows from every
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
    pub stream_mode: &'static str,
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
    /// Ask accepted, µs since the process telemetry origin (first Tap). Same axis across
    /// sessions; inter-ask spacing and batch queueing are read from it.
    pub t_ask_us: u64,
    /// Position in a `RequestFrames` batch; `0` of `1` for a `RequestFrame`.
    pub batch_position: u32,
    pub batch_size: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prepare_us: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locate_us: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub send_us: Option<u32>,
    /// Full span: `begin_frame` → row emit (measured independently, not a sum).
    pub serve_us: u32,
    /// `serve_us − prepare − locate − send` (saturating).
    pub overhead_us: u32,
    /// Last byte accepted by the send buffer → peer acknowledged every byte of the stream.
    /// Per-frame stream mode only; `null` in shared mode and until the ack arrives. Merged
    /// into the row from the ack record when the report is built.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ack_us: Option<u32>,
    pub server_bytes_sent: u32,
    pub locate_outcome: u8,
    pub write_outcome: u8,
    pub dropped_since_last: u16,
}

/// Peer acknowledgement for one sent frame, emitted from the ack task.
#[derive(Clone, Copy, Debug)]
pub struct AckRecord {
    pub session_id: u64,
    pub frame_index: u32,
    pub ask_ordinal: u32,
    pub ack_us: u32,
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
    pub acks: u32,
}

/// What travels through the channel and into the row file.
#[derive(Clone, Copy, Debug)]
pub enum Record {
    Frame(FrameRecord),
    Ack(AckRecord),
    Session(SessionRecord),
}

pub type Batch = Vec<Record>;

/// Where ack tasks leave their records. While the session is open the Tap drains it into the
/// next batch; after the Tap drops, late acks go straight to the sink.
pub(super) struct AckInbox {
    pending: Mutex<Vec<AckRecord>>,
    closed: AtomicBool,
    tx: Option<SyncSender<Batch>>,
}

impl AckInbox {
    fn deliver(&self, rec: AckRecord) {
        if !self.closed.load(Ordering::Acquire) {
            if let Ok(mut p) = self.pending.lock() {
                p.push(rec);
                return;
            }
        }
        if let Some(tx) = &self.tx {
            if tx.try_send(vec![Record::Ack(rec)]).is_err() {
                DROP_TOTAL.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

pub struct Tap {
    session_id: u64,
    /// Owned clone of the process sink — emit without taking the global lock.
    tx: Option<SyncSender<Batch>>,
    batch: Batch,
    inbox: Arc<AckInbox>,
    ordinals: HashMap<u32, u32>,
    frame_index: u32,
    ask_ordinal: u32,
    pending_prepare_us: Option<u32>,
    pending_locate_us: Option<u32>,
    pending_bytes: u32,
    pending_locate: u8,
    drops_since_emit: u16,
    serve_start: Option<Instant>,
    /// End of last closed stage = start of next (contiguous chain).
    stage_mark: Option<Instant>,
    t_ask_us: u64,
    batch_position: u32,
    batch_size: u32,
    // Session counters — the session row and its integrity block.
    t_open_us: u64,
    frames: u32,
    bytes: u64,
    refused: u32,
    rows_opened: u32,
    rows_closed: u32,
    rows_dropped: u32,
    acks: u32,
}

/// `WTPACS_TELEMETRY_SAMPLE=K`: record one session in K. `seen` counts from 0.
pub(super) fn sampled(seen: u64, k: u64) -> bool {
    seen.is_multiple_of(k.max(1))
}

impl Tap {
    /// Enabled when `WTPACS_TELEMETRY` is `1` / `true` / `yes`. Path from `WTPACS_TELEMETRY_PATH`
    /// (default `telemetry-server.json`; rows go beside it as `.rows`). `WTPACS_TELEMETRY_SAMPLE=K`
    /// records one session in K (default every session). Report is written on a timer and when
    /// the last session ends or the process is told to flush.
    pub fn for_session() -> Option<Self> {
        if !env_enabled("WTPACS_TELEMETRY") {
            return None;
        }
        let seen = SESSIONS_SEEN.fetch_add(1, Ordering::Relaxed);
        if !sampled(seen, env_u64("WTPACS_TELEMETRY_SAMPLE", 1)) {
            return None;
        }
        let path = std::env::var("WTPACS_TELEMETRY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("telemetry-server.json"));
        ensure_sink(path);
        // Anchor the row clock at the first session's start, so the first row's `t_ask_us`
        // is connect → first ask and later sessions share the axis.
        let _ = origin();
        let tx = clone_sender();
        ACTIVE_TAPS.fetch_add(1, Ordering::Relaxed);
        SESSIONS_STARTED.fetch_add(1, Ordering::Relaxed);
        Some(Self::new(SESSION_IDS.fetch_add(1, Ordering::Relaxed), tx))
    }

    fn new(session_id: u64, tx: Option<SyncSender<Batch>>) -> Self {
        Self {
            session_id,
            inbox: Arc::new(AckInbox {
                pending: Mutex::new(Vec::new()),
                closed: AtomicBool::new(false),
                tx: tx.clone(),
            }),
            tx,
            batch: Vec::with_capacity(BATCH),
            ordinals: HashMap::new(),
            frame_index: 0,
            ask_ordinal: 0,
            pending_prepare_us: None,
            pending_locate_us: None,
            pending_bytes: 0,
            pending_locate: LocateOutcome::Ok as u8,
            drops_since_emit: 0,
            serve_start: None,
            stage_mark: None,
            t_ask_us: 0,
            batch_position: 0,
            batch_size: 1,
            t_open_us: since_origin_us(),
            frames: 0,
            bytes: 0,
            refused: 0,
            rows_opened: 0,
            rows_closed: 0,
            rows_dropped: 0,
            acks: 0,
        }
    }

    fn take_ordinal(&mut self, frame_index: u32) -> u32 {
        let entry = self.ordinals.entry(frame_index).or_insert(0);
        let n = *entry;
        *entry = entry.saturating_add(1);
        n
    }

    /// The next `begin_frame` is item `position` of a batch of `size`. Unset = `0` of `1`.
    pub(crate) fn note_batch(&mut self, position: u32, size: u32) {
        self.batch_position = position;
        self.batch_size = size.max(1);
    }

    pub(crate) fn begin_frame(&mut self, frame_index: u32) {
        ROWS_OPENED.fetch_add(1, Ordering::Relaxed);
        self.rows_opened = self.rows_opened.saturating_add(1);
        let t = Instant::now();
        self.t_ask_us = t.duration_since(origin()).as_micros().min(u64::MAX as u128) as u64;
        self.serve_start = Some(t);
        self.stage_mark = Some(t);
        self.frame_index = frame_index;
        self.ask_ordinal = self.take_ordinal(frame_index);
        self.pending_prepare_us = None;
        self.pending_locate_us = None;
        self.pending_bytes = 0;
        self.pending_locate = LocateOutcome::Ok as u8;
    }

    /// One `Instant::now` — duration since mark, then advance mark.
    fn close_against_mark(&mut self) -> u32 {
        let now = Instant::now();
        let us = self
            .stage_mark
            .take()
            .map(|mark| duration_us(mark, now))
            .unwrap_or(0);
        self.stage_mark = Some(now);
        us
    }

    /// Entering locate (or prepare failed): close prepare against the mark.
    pub(crate) fn boundary_prepare_done(&mut self) {
        self.pending_prepare_us = Some(self.close_against_mark());
    }

    /// Entering send (or locate failed): close locate against the mark.
    pub(crate) fn boundary_locate_done(&mut self) {
        self.pending_locate_us = Some(self.close_against_mark());
    }

    pub(crate) fn note_locate(&mut self, outcome: LocateOutcome, byte_len: usize) {
        self.pending_locate = outcome as u8;
        if outcome == LocateOutcome::Ok {
            self.pending_bytes = usize_to_u32(byte_len);
        }
    }

    /// The hook `FrameOut` calls when the peer has acknowledged the frame being served.
    /// Captures the current frame identity, so it must be taken after `begin_frame`.
    pub(crate) fn ack_hook(&self) -> AckHook {
        let inbox = Arc::clone(&self.inbox);
        let (session_id, frame_index, ask_ordinal) =
            (self.session_id, self.frame_index, self.ask_ordinal);
        Some(Box::new(move |elapsed: Duration| {
            inbox.deliver(AckRecord {
                session_id,
                frame_index,
                ask_ordinal,
                ack_us: elapsed.as_micros().min(u32::MAX as u128) as u32,
            });
        }))
    }

    pub(crate) fn emit_sent(&mut self, envelope_len: usize) {
        self.pending_bytes = usize_to_u32(envelope_len);
        self.try_emit(WriteOutcome::Sent, true);
    }

    pub(crate) fn emit_write_err(&mut self) {
        self.try_emit(WriteOutcome::WriteErr, true);
    }

    /// Close whichever stage was open when we bailed (prepare or locate), then emit.
    /// `send_us` stays null; refuse never entered send.
    pub(crate) fn emit_refused(&mut self) {
        if self.pending_prepare_us.is_none() {
            self.boundary_prepare_done();
        } else if self.pending_locate_us.is_none() {
            self.boundary_locate_done();
        }
        self.pending_locate = LocateOutcome::NotFound as u8;
        self.try_emit(WriteOutcome::Refused, false);
    }

    fn try_emit(&mut self, write_outcome: WriteOutcome, measure_send: bool) {
        let dropped = self.drops_since_emit;
        self.drops_since_emit = 0;
        let now = Instant::now();
        let send_us = if measure_send {
            let us = self
                .stage_mark
                .take()
                .map(|mark| duration_us(mark, now))
                .unwrap_or(0);
            Some(us)
        } else {
            self.stage_mark = None;
            None
        };
        let serve_us = self
            .serve_start
            .take()
            .map(|t| duration_us(t, now))
            .unwrap_or(0);
        let prep = self.pending_prepare_us.unwrap_or(0);
        let loc = self.pending_locate_us.unwrap_or(0);
        let send = send_us.unwrap_or(0);
        let overhead_us = serve_us
            .saturating_sub(prep)
            .saturating_sub(loc)
            .saturating_sub(send);
        let row = FrameRecord {
            kind: "server_frame",
            session_id: self.session_id,
            frame_index: self.frame_index,
            ask_ordinal: self.ask_ordinal,
            t_ask_us: self.t_ask_us,
            batch_position: self.batch_position,
            batch_size: self.batch_size,
            prepare_us: self.pending_prepare_us,
            locate_us: self.pending_locate_us,
            send_us,
            serve_us,
            overhead_us,
            ack_us: None,
            server_bytes_sent: self.pending_bytes,
            locate_outcome: self.pending_locate,
            write_outcome: write_outcome as u8,
            dropped_since_last: dropped,
        };
        // A single ask that follows a batch is 0 of 1 again.
        self.batch_position = 0;
        self.batch_size = 1;
        match write_outcome {
            WriteOutcome::Sent => {
                self.frames = self.frames.saturating_add(1);
                self.bytes = self.bytes.saturating_add(u64::from(self.pending_bytes));
            }
            WriteOutcome::Refused => self.refused = self.refused.saturating_add(1),
            WriteOutcome::WriteErr => {}
        }
        self.drain_inbox();
        self.push(Record::Frame(row));
    }

    /// Acks that arrived since the last emit ride this batch.
    fn drain_inbox(&mut self) {
        let acks: Vec<AckRecord> = match self.inbox.pending.lock() {
            Ok(mut p) => p.drain(..).collect(),
            Err(_) => Vec::new(),
        };
        for a in acks {
            self.acks = self.acks.saturating_add(1);
            self.push(Record::Ack(a));
        }
    }

    fn push(&mut self, rec: Record) {
        self.batch.push(rec);
        if self.batch.len() >= BATCH {
            self.flush_batch();
        }
    }

    /// One channel op for the whole batch. A full ring drops the batch; the rows are counted
    /// so the next row's `dropped_since_last` and the integrity blocks say so.
    pub(crate) fn flush_batch(&mut self) {
        if self.batch.is_empty() {
            return;
        }
        let batch = std::mem::replace(&mut self.batch, Vec::with_capacity(BATCH));
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
            acks: self.acks,
        }
    }
}

impl Drop for Tap {
    fn drop(&mut self) {
        // Late acks go straight to the sink from here on.
        self.inbox.closed.store(true, Ordering::Release);
        self.drain_inbox();
        // The session row is the last thing the session says; counters are final once the
        // batch before it is accounted for.
        self.flush_batch();
        let session = self.session_record();
        self.batch.push(Record::Session(session));
        self.flush_batch();
        if ACTIVE_TAPS.fetch_sub(1, Ordering::Relaxed) == 1 {
            shutdown_sink();
        }
    }
}

fn duration_us(start: Instant, end: Instant) -> u32 {
    end.duration_since(start)
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
        Tap::new(1, None)
    }

    fn test_tap_with_channel(cap_batches: usize) -> (Tap, Receiver<Batch>) {
        let (tx, rx) = sync_channel::<Batch>(cap_batches);
        (Tap::new(1, Some(tx)), rx)
    }

    /// Everything queued so far, flattened.
    fn drain_all(rx: &Receiver<Batch>) -> Vec<Record> {
        std::iter::from_fn(|| rx.try_recv().ok()).flatten().collect()
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

    fn sample_row(
        prepare: Option<u32>,
        locate: Option<u32>,
        send: Option<u32>,
        serve: u32,
        overhead: u32,
    ) -> FrameRecord {
        FrameRecord {
            kind: "server_frame",
            session_id: 1,
            frame_index: 0,
            ask_ordinal: 0,
            t_ask_us: 0,
            batch_position: 0,
            batch_size: 1,
            prepare_us: prepare,
            locate_us: locate,
            send_us: send,
            serve_us: serve,
            overhead_us: overhead,
            ack_us: None,
            server_bytes_sent: 100,
            locate_outcome: 0,
            write_outcome: 0,
            dropped_since_last: 0,
        }
    }

    fn serve_frame(t: &mut Tap, frame: u32, bytes: usize) {
        t.begin_frame(frame);
        t.boundary_prepare_done();
        t.note_locate(LocateOutcome::Ok, bytes);
        t.boundary_locate_done();
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
        t.boundary_prepare_done();
        t.note_locate(LocateOutcome::Ok, 8);
        t.boundary_locate_done();
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
        std::thread::sleep(std::time::Duration::from_millis(2));
        t.boundary_prepare_done();
        t.note_locate(LocateOutcome::Ok, 100);
        t.boundary_locate_done();
        let before_emit = Instant::now();
        t.emit_sent(104);
        let serve_us_0 = duration_us(serve0, before_emit);
        assert!(t.serve_start.is_none());
        assert!(serve_us_0 >= 1_500, "got {serve_us_0}");

        t.begin_frame(5);
        assert_eq!(t.ask_ordinal, 1);
        let serve1 = t.serve_start.expect("new serve_start");
        assert!(serve1 > serve0);
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.boundary_prepare_done();
        t.note_locate(LocateOutcome::Ok, 100);
        t.boundary_locate_done();
        let before_emit1 = Instant::now();
        t.emit_sent(104);
        let serve_us_1 = duration_us(serve1, before_emit1);
        assert!(serve_us_1 < serve_us_0);
        t.begin_frame(9);
        assert_eq!(t.ask_ordinal, 0);
    }

    #[test]
    fn stage_partition_identity_with_overhead() {
        let row = sample_row(Some(20), Some(1), Some(40), 65, 4);
        assert_eq!(
            row.serve_us,
            row.prepare_us.unwrap() + row.locate_us.unwrap() + row.send_us.unwrap() + row.overhead_us
        );
    }

    #[test]
    fn contiguous_emit_partition_holds() {
        let (mut t, rx) = test_tap_with_channel(4);
        t.begin_frame(2);
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.boundary_prepare_done();
        t.note_locate(LocateOutcome::Ok, 8);
        t.boundary_locate_done();
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.emit_sent(16);
        let row = one_row(&mut t, &rx);
        let sum = row.prepare_us.unwrap_or(0)
            + row.locate_us.unwrap_or(0)
            + row.send_us.unwrap_or(0)
            + row.overhead_us;
        assert_eq!(row.serve_us, sum);
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
        acc.push(&sample_row(Some(1), Some(0), Some(100), 101, 0));
        acc.push(&FrameRecord {
            frame_index: 1,
            send_us: Some(300),
            serve_us: 305,
            overhead_us: 4,
            server_bytes_sent: 2000,
            ..sample_row(Some(1), Some(0), Some(300), 305, 4)
        });
        let summary = acc.build_summary();
        assert_eq!(summary.frame_count, 2);
        assert_eq!(summary.totals.serve_us, 406);
        let send = summary.send_us.expect("send");
        assert_eq!(send.total, 400);
        assert_eq!(send.min, 100);
        assert_eq!(send.max, 300);
    }

    #[test]
    fn refused_row_excluded_from_send_distribution() {
        let mut acc = RunAccumulator::default();
        acc.push(&sample_row(Some(10), Some(2), Some(50), 70, 8));
        acc.push(&FrameRecord {
            frame_index: 1,
            locate_us: None,
            send_us: None,
            serve_us: 12,
            overhead_us: 2,
            server_bytes_sent: 0,
            locate_outcome: LocateOutcome::NotFound as u8,
            write_outcome: WriteOutcome::Refused as u8,
            ..sample_row(Some(10), None, None, 12, 2)
        });
        let summary = acc.build_summary();
        assert_eq!(summary.frame_count, 2);
        let send = summary.send_us.expect("send");
        assert_eq!(send.count, 1);
        assert_eq!(send.total, 50);
        assert_eq!(summary.totals.send_us, 50);
        assert_eq!(summary.locate_us.expect("locate").count, 1);
    }

    #[test]
    fn empty_distribution_is_none() {
        assert!(distribution_stats(&[]).is_none());
    }

    #[test]
    fn emit_refused_closes_open_prepare() {
        let (mut t, rx) = test_tap_with_channel(4);
        t.begin_frame(1);
        std::thread::sleep(std::time::Duration::from_millis(1));
        // No boundary — refuse owns finalize (prepare failed path).
        t.emit_refused();
        let row = one_row(&mut t, &rx);
        assert!(row.prepare_us.is_some());
        assert!(row.locate_us.is_none());
        assert!(row.send_us.is_none());
        assert_eq!(row.locate_outcome, LocateOutcome::NotFound as u8);
        assert_eq!(row.write_outcome, WriteOutcome::Refused as u8);
        assert_eq!(
            row.serve_us,
            row.prepare_us.unwrap_or(0) + row.overhead_us
        );
        assert_eq!(t.refused, 1);
    }

    #[test]
    fn emit_refused_closes_open_locate() {
        let (mut t, rx) = test_tap_with_channel(4);
        t.begin_frame(2);
        t.boundary_prepare_done();
        std::thread::sleep(std::time::Duration::from_millis(1));
        // No locate boundary — refuse owns finalize (locate failed path).
        t.emit_refused();
        let row = one_row(&mut t, &rx);
        assert!(row.prepare_us.is_some());
        assert!(row.locate_us.is_some());
        assert!(row.send_us.is_none());
        assert_eq!(row.locate_outcome, LocateOutcome::NotFound as u8);
        assert_eq!(
            row.serve_us,
            row.prepare_us.unwrap_or(0) + row.locate_us.unwrap_or(0) + row.overhead_us
        );
    }

    #[test]
    fn batch_position_is_stamped_then_resets_to_single() {
        let (mut t, rx) = test_tap_with_channel(8);
        for (i, frame) in [4u32, 5, 6].iter().enumerate() {
            t.note_batch(i as u32, 3);
            serve_frame(&mut t, *frame, 8);
        }
        // A plain RequestFrame afterwards.
        serve_frame(&mut t, 7, 8);
        t.flush_batch();
        let rows = frames(&drain_all(&rx));
        assert_eq!(rows.len(), 4);
        assert_eq!(
            rows.iter().map(|r| (r.batch_position, r.batch_size)).collect::<Vec<_>>(),
            vec![(0, 3), (1, 3), (2, 3), (0, 1)]
        );
        assert!(rows.windows(2).all(|w| w[1].t_ask_us >= w[0].t_ask_us), "t_ask_us monotonic");
    }

    #[test]
    fn t_ask_us_advances_between_asks() {
        let mut t = test_tap();
        t.begin_frame(1);
        let a = t.t_ask_us;
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.begin_frame(2);
        assert!(t.t_ask_us >= a + 1_000, "got {} then {}", a, t.t_ask_us);
    }

    #[test]
    fn try_emit_uses_owned_sender_without_global_lock() {
        let (mut t, rx) = test_tap_with_channel(4);
        serve_frame(&mut t, 3, 8);
        let row = one_row(&mut t, &rx);
        assert_eq!(row.frame_index, 3);
        assert_eq!(row.kind, "server_frame");
        assert_eq!(
            row.serve_us,
            row.prepare_us.unwrap_or(0)
                + row.locate_us.unwrap_or(0)
                + row.send_us.unwrap_or(0)
                + row.overhead_us
        );
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

    /// Acks left in the inbox ride the next batch and are counted on the session.
    #[test]
    fn ack_hook_delivers_into_next_batch() {
        let (mut t, rx) = test_tap_with_channel(4);
        t.begin_frame(11);
        let hook = t.ack_hook().expect("lab hook");
        t.boundary_prepare_done();
        t.note_locate(LocateOutcome::Ok, 8);
        t.boundary_locate_done();
        t.emit_sent(12);
        hook(Duration::from_micros(272_000));
        serve_frame(&mut t, 12, 8);
        t.flush_batch();
        let records = drain_all(&rx);
        let acks: Vec<AckRecord> = records
            .iter()
            .filter_map(|r| match r {
                Record::Ack(a) => Some(*a),
                _ => None,
            })
            .collect();
        assert_eq!(acks.len(), 1);
        assert_eq!((acks[0].frame_index, acks[0].ask_ordinal, acks[0].ack_us), (11, 0, 272_000));
        assert_eq!(t.acks, 1);
        // Frame row first, ack after it (it arrived after that row's emit).
        let pos_frame = records.iter().position(|r| matches!(r, Record::Frame(f) if f.frame_index == 11));
        let pos_ack = records.iter().position(|r| matches!(r, Record::Ack(_)));
        assert!(pos_frame < pos_ack);
    }

    /// After the Tap drops, a late ack goes straight to the sink instead of being lost.
    #[test]
    fn late_ack_after_drop_reaches_the_sink() {
        let (mut t, rx) = test_tap_with_channel(4);
        t.begin_frame(5);
        let hook = t.ack_hook().expect("lab hook");
        t.boundary_prepare_done();
        t.note_locate(LocateOutcome::Ok, 8);
        t.boundary_locate_done();
        t.emit_sent(12);
        drop(t);
        let before: Vec<Record> = drain_all(&rx);
        assert!(before.iter().any(|r| matches!(r, Record::Session(_))));
        hook(Duration::from_micros(5));
        let after = drain_all(&rx);
        assert!(matches!(after.as_slice(), [Record::Ack(a)] if a.frame_index == 5));
    }

    /// The session row is the last record of a session and carries its own integrity.
    #[test]
    fn drop_emits_session_row_last_with_counters() {
        let (mut t, rx) = test_tap_with_channel(8);
        serve_frame(&mut t, 1, 100);
        serve_frame(&mut t, 2, 100);
        t.begin_frame(3);
        t.emit_refused();
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
    }

    #[test]
    fn sampling_records_one_session_in_k() {
        assert!(sampled(0, 1) && sampled(1, 1) && sampled(7, 1));
        assert!(sampled(0, 4) && !sampled(1, 4) && !sampled(3, 4) && sampled(4, 4));
        assert!(sampled(0, 0), "k = 0 behaves as 1");
    }
}
