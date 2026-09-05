//! Process-wide telemetry sink — channel setup, drain thread, file write.

use super::report::{finalize_report, RunAccumulator};
use super::tap::{FrameRecord, DROP_TOTAL, RING_CAP};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Mutex, OnceLock};
use tracing::{info, warn};

static SINK: OnceLock<Mutex<Option<SyncSender<FrameRecord>>>> = OnceLock::new();

fn sink_cell() -> &'static Mutex<Option<SyncSender<FrameRecord>>> {
    SINK.get_or_init(|| Mutex::new(None))
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
    std::thread::spawn(move || drain_loop(rx, path));
}

pub(super) fn clone_sender() -> Option<SyncSender<FrameRecord>> {
    sink_cell()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().cloned())
}

fn drain_loop(rx: Receiver<FrameRecord>, path: PathBuf) {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    let mut frames = Vec::new();
    let mut acc = RunAccumulator::default();
    while let Ok(row) = rx.recv() {
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
