//! Process-wide telemetry sink — batches in, rows to disk, summary on a timer, report at the end.
//!
//! The drain thread appends every record to `telemetry-server.rows` as it arrives (exact, fixed
//! width), folds it into the live histograms, and rewrites `telemetry-server.json` every
//! `WTPACS_TELEMETRY_SUMMARY_MS` (default 5 000). A hard kill therefore loses at most the last
//! unflushed batch of rows and leaves a summary no older than the timer. The final report is
//! written when the last session's `Tap` drops (normal end) or when [`flush_on_exit`] is called
//! from the signal handler; it is exact from the row file when the rows fit the inline cap.

use super::report::{final_report, progress_report, LiveSummary, TelemetryReport, INLINE_CAP_DEFAULT};
use super::rows;
use super::tap::{env_u64, Batch, BATCH, RING_CAP};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tracing::{info, warn};

static SINK: OnceLock<Mutex<Option<SyncSender<Batch>>>> = OnceLock::new();
static DRAIN: OnceLock<Mutex<Option<JoinHandle<()>>>> = OnceLock::new();
/// Set by `flush_on_exit`; the drain loop checks it between receives.
static SHUTDOWN: AtomicBool = AtomicBool::new(false);

fn sink_cell() -> &'static Mutex<Option<SyncSender<Batch>>> {
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
    let (tx, rx) = sync_channel(RING_CAP / BATCH);
    *guard = Some(tx);
    info!(path = %path.display(), ring_rows = RING_CAP, batch = BATCH, "server telemetry sink started");
    let handle = std::thread::spawn(move || drain_loop(rx, path));
    if let Ok(mut drain) = drain_cell().lock() {
        *drain = Some(handle);
    }
}

pub(super) fn clone_sender() -> Option<SyncSender<Batch>> {
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

/// `telemetry-server.json` → `telemetry-server.rows`, beside it.
pub(super) fn rows_path_for(json_path: &Path) -> PathBuf {
    json_path.with_extension("rows")
}

pub(super) fn write_json(path: &Path, report: &TelemetryReport) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut writer = BufWriter::new(File::create(&tmp)?);
        serde_json::to_writer_pretty(&mut writer, report)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
    // Rename so a reader never sees a half-written report on a timer rewrite.
    std::fs::rename(&tmp, path)
}

struct RowFile {
    path: PathBuf,
    writer: BufWriter<File>,
}

impl RowFile {
    fn create(path: PathBuf) -> std::io::Result<Self> {
        let mut writer = BufWriter::with_capacity(1 << 20, File::create(&path)?);
        writer.write_all(&rows::header())?;
        Ok(Self { path, writer })
    }
}

fn drain_loop(rx: Receiver<Batch>, json_path: PathBuf) {
    if let Some(parent) = json_path.parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    let mut row_file = match RowFile::create(rows_path_for(&json_path)) {
        Ok(f) => Some(f),
        Err(err) => {
            warn!(%err, "telemetry: cannot create row file; summary only");
            None
        }
    };
    let mut live = LiveSummary::new();
    let period = Duration::from_millis(env_u64("WTPACS_TELEMETRY_SUMMARY_MS", 5_000).max(100));
    let inline_cap = env_u64("WTPACS_TELEMETRY_INLINE_CAP", INLINE_CAP_DEFAULT);
    let mut last_summary = Instant::now();

    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(batch) => absorb(&batch, &mut row_file, &mut live),
            Err(RecvTimeoutError::Timeout) => {
                if SHUTDOWN.load(Ordering::SeqCst) {
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if last_summary.elapsed() >= period {
            if let Some(f) = row_file.as_mut() {
                let _ = f.writer.flush();
            }
            let report = progress_report(&live, row_file.as_ref().map(|f| f.path.as_path()));
            if let Err(err) = write_json(&json_path, &report) {
                warn!(%err, path = %json_path.display(), "telemetry: progress summary failed");
            }
            last_summary = Instant::now();
        }
    }
    // Rows already queued when shutdown was requested still belong to the run.
    while let Ok(batch) = rx.try_recv() {
        absorb(&batch, &mut row_file, &mut live);
    }

    let rows_path = row_file.as_ref().map(|f| f.path.clone());
    if let Some(mut f) = row_file.take() {
        let _ = f.writer.flush();
    }

    let report = final_report(&live, rows_path.as_deref(), inline_cap);
    match write_json(&json_path, &report) {
        Ok(()) => info!(
            path = %json_path.display(),
            frames = live.frames,
            acks = live.acks,
            sessions = live.sessions.len(),
            method = report.summary.percentile_method,
            "server telemetry report written"
        ),
        Err(err) => warn!(%err, path = %json_path.display(), "telemetry: report write failed"),
    }
}

fn absorb(batch: &Batch, row_file: &mut Option<RowFile>, live: &mut LiveSummary) {
    for rec in batch {
        if let Some(f) = row_file.as_mut() {
            if let Err(err) = f.writer.write_all(&rows::encode(rec)) {
                warn!(%err, "telemetry: row write failed; summary only from here");
                *row_file = None;
            }
        }
        live.fold(rec);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record::tap::{FrameRecord, Record};

    /// The process-global sink exists once; this is the one test that owns it.
    #[test]
    fn flush_on_exit_writes_report_and_rows_while_a_sender_is_still_alive() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("wtpacs-sink-{stamp}.json"));
        ensure_sink(path.clone());
        let tx = clone_sender().expect("sender after ensure_sink");
        tx.try_send(vec![Record::Frame(FrameRecord {
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
            ack_us: None,
            server_bytes_sent: 100,
            locate_outcome: 0,
            write_outcome: 0,
            dropped_since_last: 0,
        })])
        .expect("queue batch");

        // `tx` is still alive here — a session mid-flight. Flush must not wait for it.
        flush_on_exit();

        let text = std::fs::read_to_string(&path).expect("report written by flush");
        assert!(text.contains("\"server_frames\""));
        assert!(text.contains("\"written_records\": 1"));
        assert!(text.contains("\"frame_index\": 4"));
        assert!(text.contains("\"percentile_method\": \"exact-sort\""));
        assert!(text.contains("\"rows_file\": \"wtpacs-sink-"));
        let rows_path = rows_path_for(&path);
        let rows_len = std::fs::metadata(&rows_path).expect("row file").len();
        assert_eq!(rows_len as usize, rows::HEADER_BYTES + rows::RECORD_BYTES);
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(rows_path);
        drop(tx);
    }
}
