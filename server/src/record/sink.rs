//! Process-wide telemetry sink — channel setup, drain thread, file write.
//!
//! The report is written once, when the drain thread ends. That happens when the last session's
//! `Tap` drops (normal end) or when [`flush_on_exit`] is called from a signal handler (the harvest
//! sends SIGTERM between runs; a report that dies with the process is a half harvest).

use super::report::{finalize_report, RunAccumulator};
use super::tap::{FrameRecord, DROP_TOTAL, RING_CAP};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;
use tracing::{info, warn};

static SINK: OnceLock<Mutex<Option<SyncSender<FrameRecord>>>> = OnceLock::new();
static DRAIN: OnceLock<Mutex<Option<JoinHandle<()>>>> = OnceLock::new();
/// Set by `flush_on_exit`; the drain loop checks it between receives.
static SHUTDOWN: AtomicBool = AtomicBool::new(false);

fn sink_cell() -> &'static Mutex<Option<SyncSender<FrameRecord>>> {
    SINK.get_or_init(|| Mutex::new(None))
}

fn drain_cell() -> &'static Mutex<Option<JoinHandle<()>>> {
    DRAIN.get_or_init(|| Mutex::new(None))
}

pub(super) fn shutdown_sink() {
    if let Ok(mut guard) = sink_cell().lock() {
        *guard = None;
    }
}

pub(super) fn ensure_sink(path: PathBuf) {
    let mut guard = sink_cell().lock().expect("telemetry sink lock");
    if guard.is_some() {
        return;
    }
    let (tx, rx) = sync_channel(RING_CAP);
    *guard = Some(tx);
    info!(path = %path.display(), cap = RING_CAP, "server telemetry sink started");
    let handle = std::thread::spawn(move || drain_loop(rx, path));
    if let Ok(mut drain) = drain_cell().lock() {
        *drain = Some(handle);
    }
}

pub(super) fn clone_sender() -> Option<SyncSender<FrameRecord>> {
    sink_cell()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().cloned())
}

/// Write the report now and wait for it. For process shutdown on a signal: sessions still open
/// keep their sender clones, so the drain loop is told to stop instead of waiting for them.
/// Rows emitted after this point are counted as drops, not lost silently.
pub fn flush_on_exit() {
    SHUTDOWN.store(true, Ordering::SeqCst);
    shutdown_sink();
    let handle = drain_cell().lock().ok().and_then(|mut guard| guard.take());
    if let Some(handle) = handle {
        if handle.join().is_err() {
            warn!("telemetry: drain thread panicked during flush");
        }
    }
}

fn drain_loop(rx: Receiver<FrameRecord>, path: PathBuf) {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    let mut frames = Vec::new();
    let mut acc = RunAccumulator::default();
    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(row) => {
                acc.push(&row);
                frames.push(row);
            }
            Err(RecvTimeoutError::Timeout) => {
                if SHUTDOWN.load(Ordering::SeqCst) {
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    // Rows already queued when shutdown was requested still belong to the run.
    while let Ok(row) = rx.try_recv() {
        acc.push(&row);
        frames.push(row);
    }

    let written = frames.len();
    let report = finalize_report(frames, acc.build_summary());

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

    // Touch DROP_TOTAL so the symbol stays used if no drops occurred (helps absence greps stay meaningful).
    let _ = DROP_TOTAL.load(Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record::tap::FrameRecord;

    /// The process-global sink exists once; this is the one test that owns it.
    #[test]
    fn flush_on_exit_writes_report_while_a_sender_is_still_alive() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("wtpacs-sink-{stamp}.json"));
        ensure_sink(path.clone());
        let tx = clone_sender().expect("sender after ensure_sink");
        tx.try_send(FrameRecord {
            kind: "server_frame",
            session_id: 1,
            frame_index: 4,
            ask_ordinal: 0,
            t_ask_us: 0,
            batch_position: 0,
            batch_size: 1,
            prepare_us: Some(10),
            locate_us: Some(0),
            send_us: Some(30),
            serve_us: 41,
            overhead_us: 1,
            server_bytes_sent: 100,
            locate_outcome: 0,
            write_outcome: 0,
            dropped_since_last: 0,
        })
        .expect("queue row");

        // `tx` is still alive here — a session mid-flight. Flush must not wait for it.
        flush_on_exit();

        let text = std::fs::read_to_string(&path).expect("report written by flush");
        assert!(text.contains("\"server_frames\""));
        assert!(text.contains("\"written_records\": 1"));
        assert!(text.contains("\"frame_index\": 4"));
        let _ = std::fs::remove_file(path);
        drop(tx);
    }
}
