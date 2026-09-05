//! Lab-only Tap hot path — compiled only with `feature = "telemetry"`.
//!
//! Sink/drain/report live in sibling modules. Hot path: build a `Copy` row and
//! `try_send` on an owned `SyncSender` clone (no per-frame global lock).

use crate::record::{LocateOutcome, WriteOutcome};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::time::Instant;

use super::sink::{clone_sender, ensure_sink, shutdown_sink};

pub(super) const RING_CAP: usize = 4096;

pub(super) static SESSION_IDS: AtomicU64 = AtomicU64::new(1);
pub(super) static ACTIVE_TAPS: AtomicU64 = AtomicU64::new(0);
pub(super) static DROP_TOTAL: AtomicU64 = AtomicU64::new(0);
pub(super) static ROWS_OPENED: AtomicU64 = AtomicU64::new(0);
pub(super) static ROWS_CLOSED: AtomicU64 = AtomicU64::new(0);
pub(super) static SESSIONS_STARTED: AtomicU64 = AtomicU64::new(0);

/// Fixed-width row — durations in µs; absent stages are `None` (JSON null).
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct FrameRecord {
    pub kind: &'static str,
    pub session_id: u64,
    pub frame_index: u32,
    pub ask_ordinal: u32,
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
    /// End of last closed stage = start of next (contiguous chain).
    stage_mark: Option<Instant>,
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
        let tx = clone_sender();
        ACTIVE_TAPS.fetch_add(1, Ordering::Relaxed);
        SESSIONS_STARTED.fetch_add(1, Ordering::Relaxed);
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
            stage_mark: None,
        })
    }

    fn take_ordinal(&mut self, frame_index: u32) -> u32 {
        let entry = self.ordinals.entry(frame_index).or_insert(0);
        let n = *entry;
        *entry = entry.saturating_add(1);
        n
    }

    pub(crate) fn begin_frame(&mut self, frame_index: u32) {
        ROWS_OPENED.fetch_add(1, Ordering::Relaxed);
        let t = Instant::now();
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
            prepare_us: self.pending_prepare_us,
            locate_us: self.pending_locate_us,
            send_us,
            serve_us,
            overhead_us,
            server_bytes_sent: self.pending_bytes,
            locate_outcome: self.pending_locate,
            write_outcome: write_outcome as u8,
            dropped_since_last: dropped,
        };
        let Some(tx) = self.tx.as_ref() else {
            return;
        };
        match tx.try_send(row) {
            Ok(()) => {
                ROWS_CLOSED.fetch_add(1, Ordering::Relaxed);
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record::report::{distribution_stats, percentile, RunAccumulator};
    use std::sync::mpsc::sync_channel;

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
            stage_mark: None,
        }
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
            prepare_us: prepare,
            locate_us: locate,
            send_us: send,
            serve_us: serve,
            overhead_us: overhead,
            server_bytes_sent: 100,
            locate_outcome: 0,
            write_outcome: 0,
            dropped_since_last: 0,
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
        let (tx, rx) = sync_channel::<FrameRecord>(4);
        let mut t = test_tap();
        t.tx = Some(tx);
        t.begin_frame(2);
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.boundary_prepare_done();
        t.note_locate(LocateOutcome::Ok, 8);
        t.boundary_locate_done();
        std::thread::sleep(std::time::Duration::from_millis(1));
        t.emit_sent(16);
        let row = rx.try_recv().expect("row");
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
        let (tx, rx) = sync_channel::<FrameRecord>(4);
        let mut t = test_tap();
        t.tx = Some(tx);
        t.begin_frame(1);
        std::thread::sleep(std::time::Duration::from_millis(1));
        // No boundary — refuse owns finalize (prepare failed path).
        t.emit_refused();
        let row = rx.try_recv().expect("row");
        assert!(row.prepare_us.is_some());
        assert!(row.locate_us.is_none());
        assert!(row.send_us.is_none());
        assert_eq!(row.locate_outcome, LocateOutcome::NotFound as u8);
        assert_eq!(row.write_outcome, WriteOutcome::Refused as u8);
        assert_eq!(
            row.serve_us,
            row.prepare_us.unwrap_or(0) + row.overhead_us
        );
    }

    #[test]
    fn emit_refused_closes_open_locate() {
        let (tx, rx) = sync_channel::<FrameRecord>(4);
        let mut t = test_tap();
        t.tx = Some(tx);
        t.begin_frame(2);
        t.boundary_prepare_done();
        std::thread::sleep(std::time::Duration::from_millis(1));
        // No locate boundary — refuse owns finalize (locate failed path).
        t.emit_refused();
        let row = rx.try_recv().expect("row");
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
    fn try_emit_uses_owned_sender_without_global_lock() {
        let (tx, rx) = sync_channel::<FrameRecord>(4);
        let mut t = test_tap();
        t.tx = Some(tx);
        t.begin_frame(3);
        t.boundary_prepare_done();
        t.note_locate(LocateOutcome::Ok, 8);
        t.boundary_locate_done();
        t.emit_sent(12);
        let row = rx.try_recv().expect("row");
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
}
