//! Per-connection path sampling — the loss-regime diagnostic.
//!
//! This exists to settle the one open question that changes a deployed default by ~50 %:
//! **is the loss our viewers see congestive or exogenous?**
//!
//! - **Congestive** (a queue somewhere fills, then overflows) → **Cubic** wins; quinn's BBR
//!   measured 63 % worse and drives 30–100× more packets into the bottleneck.
//! - **Exogenous** (radio bit errors, fades, handovers on an otherwise empty path) → **BBR**
//!   wins by roughly half.
//!
//! Real 5G, WiFi and satellite links carry both, and the mix is unknown. See
//! `docs/transport-conclusions.md` §1.
//!
//! ## Why this lives on the server
//!
//! The browser client is native WebTransport, not quinn. `WebTransport.getStats()` does
//! expose `smoothedRtt` and `minRtt`, but its `packetsLost` counts the **browser's own
//! sending** — the upstream direction. Frames flow downstream, so client-side loss counts
//! the wrong direction entirely. quinn's `PathStats` on the server sees the direction that
//! actually carries images.
//!
//! ## What it does and does not decide
//!
//! It emits counters and nothing else. Classification is offline
//! (`lab/scripts/classify_loss_regime.py`), so the rule can be revised against data already
//! collected rather than needing a redeploy. The one piece of state kept here is `min_rtt`,
//! because it cannot be recovered from a sampled series: the true path minimum may occur
//! between two samples.

use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::tap::env_enabled;

/// One sample of the QUIC path, as the sender sees it.
///
/// Counters are **cumulative**, exactly as quinn reports them. Differencing is left to the
/// analyser: a sampler that emitted deltas would lose information the moment a sample was
/// dropped, and would make a restarted sampler indistinguishable from a quiet path.
#[derive(Debug, Clone, Serialize)]
pub struct PathSample {
    pub session_id: u64,
    /// Milliseconds since the sampler started, not wall clock — the series is only ever
    /// read relative to itself, and a monotonic base cannot jump backwards.
    pub t_ms: u64,
    /// quinn's current smoothed RTT estimate, microseconds.
    pub rtt_us: u64,
    /// Smallest RTT seen on this connection so far, microseconds.
    ///
    /// `rtt_us - min_rtt_us` is the **queueing delay estimate**, and it is the whole
    /// diagnostic: loss arriving while this is large is congestive, loss arriving while it
    /// is near zero is exogenous.
    pub min_rtt_us: u64,
    pub cwnd: u64,
    pub congestion_events: u64,
    pub lost_packets: u64,
    pub lost_bytes: u64,
    pub sent_packets: u64,
    /// Non-zero means the path stopped delivering entirely — a handover or a dead link,
    /// which is neither of the two regimes and must not be classified as either.
    pub black_holes_detected: u64,
    pub current_mtu: u16,
    /// Rows this process failed to write since the last row it managed to write, summed
    /// across every connection.
    ///
    /// Carried in the data rather than logged, for the same reason `FrameRecord` carries
    /// `dropped_since_last`: a telemetry loss that is only visible in a log nobody reads is
    /// a silent one, and the classifier's whole job is to be trustworthy about a path it
    /// cannot otherwise see. Non-zero means this series has holes.
    pub dropped_since_last: u64,
}

/// Samples one connection's path until the connection ends.
///
/// Costs one timer wakeup per interval per connection and takes a short lock inside
/// quinn to read the stats. At the default one-second interval that is negligible against
/// a session that is moving megabytes; at thousands of connections, raise the interval
/// rather than sampling a subset — a biased subset is worse than a coarser series.
pub struct PathSampler {
    session_id: u64,
    started: Instant,
    min_rtt: Duration,
}

impl PathSampler {
    /// Enabled when `WTPACS_PATH_TELEMETRY` is `1` / `true` / `yes`.
    ///
    /// Deliberately its own switch rather than riding on `WTPACS_TELEMETRY`: the frame tap
    /// writes a row per frame and is a development tool, while this writes a row per second
    /// and is the thing you would leave on in production to answer the controller question.
    pub fn for_session(session_id: u64) -> Option<Self> {
        if !env_enabled("WTPACS_PATH_TELEMETRY") {
            return None;
        }
        Some(Self {
            session_id,
            started: Instant::now(),
            min_rtt: Duration::MAX,
        })
    }

    /// Interval from `WTPACS_PATH_TELEMETRY_MS`, default 1000.
    pub fn interval() -> Duration {
        let ms = std::env::var("WTPACS_PATH_TELEMETRY_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v >= 50)
            .unwrap_or(1000);
        Duration::from_millis(ms)
    }

    /// Take one sample. `stats` is quinn's `ConnectionStats::path`.
    pub fn sample(&mut self, path: &wtransport::quinn::PathStats) -> PathSample {
        // Tracked here rather than derived later: the true minimum may fall between two
        // samples, so a per-sample running minimum is strictly better than the minimum of
        // what happened to be sampled.
        if path.rtt < self.min_rtt {
            self.min_rtt = path.rtt;
        }
        PathSample {
            session_id: self.session_id,
            t_ms: self.started.elapsed().as_millis() as u64,
            rtt_us: path.rtt.as_micros() as u64,
            min_rtt_us: self.min_rtt.as_micros() as u64,
            cwnd: path.cwnd,
            congestion_events: path.congestion_events,
            lost_packets: path.lost_packets,
            lost_bytes: path.lost_bytes,
            sent_packets: path.sent_packets,
            black_holes_detected: path.black_holes_detected,
            current_mtu: path.current_mtu,
            dropped_since_last: DROPPED.swap(0, Ordering::Relaxed),
        }
    }
}

/// Session ids for path rows.
///
/// Its own counter rather than the frame tap's, because the two telemetry switches are
/// independent: riding on the tap's id would stamp every path row with 0 whenever the
/// frame tap is off, and sessions would be indistinguishable. The cost is that joining
/// path rows to frame rows works only when both are enabled — which is stated rather than
/// papered over.
static PATH_SESSION_IDS: AtomicU64 = AtomicU64::new(0);

/// Sample `connection` until it closes, appending one JSON line per interval.
///
/// Spawned per session and ends when the connection does, so it cannot outlive what it is
/// describing. No-op — and never spawned — when the env switch is unset.
pub async fn run(connection: wtransport::Connection) {
    let Some(mut sampler) =
        PathSampler::for_session(PATH_SESSION_IDS.fetch_add(1, Ordering::Relaxed))
    else {
        return;
    };
    let interval = PathSampler::interval();
    let path = std::env::var("WTPACS_PATH_TELEMETRY_PATH")
        .unwrap_or_else(|_| "telemetry-path.jsonl".to_string());

    loop {
        tokio::time::sleep(interval).await;
        // `closed()` would await; this is the non-blocking check that the connection is
        // still alive. A sample taken after close would report a frozen path as a quiet
        // one, which reads as "no loss" and biases the classifier toward exogenous.
        if connection.quic_connection().close_reason().is_some() {
            return;
        }
        let stats = connection.quic_connection().stats();
        let row = sampler.sample(&stats.path);
        append_row(&path, &row);
    }
}

/// Rows this process failed to write, since the last row that was written successfully.
/// Drained into the next row's `dropped_since_last`.
static DROPPED: AtomicU64 = AtomicU64::new(0);

/// Append one JSON line in **one** `write` call.
///
/// The newline must travel in the same buffer as the JSON. This function used to be
/// `writeln!(f, "{line}")`, and `writeln!` on an unbuffered `File` issues **two** writes —
/// the formatted argument, then the newline. Under `O_APPEND` each is individually atomic,
/// so concurrent samplers interleaved as `{row A}{row B}\n\n`: one line carrying two
/// concatenated objects, and one empty line. Reproduced at realistic concurrency before
/// this fix: at 32 connections only **1 842 of 6 400 rows survived intact — 29 %** — and
/// `classify_loss_regime.py` dropped every damaged line silently, so the series simply got
/// quieter. A one-client validator could not have caught it, and did not.
///
/// One `write` of a ~200-byte buffer to a regular file opened `O_APPEND` is atomic in
/// practice; a short write would corrupt the line just as badly, so it is counted as a drop
/// rather than looped over, which is what `write_all` would do.
///
/// Best-effort throughout: telemetry must never take down a session, so failures are
/// counted and swallowed rather than propagated (R7 — no panics on the record path).
fn append_row(path: &str, row: &PathSample) {
    let Ok(mut line) = serde_json::to_string(row) else {
        DROPPED.fetch_add(1, Ordering::Relaxed);
        return;
    };
    line.push('\n');
    match std::fs::OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut f) => match f.write(line.as_bytes()) {
            Ok(n) if n == line.len() => {}
            _ => {
                DROPPED.fetch_add(1, Ordering::Relaxed);
            }
        },
        Err(_) => {
            DROPPED.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod append_row_tests {
    // Nested module: the parent's `use std::io::Write` is not in scope here.
    use std::io::Write as _;

    /// The defect, as a test: many threads appending concurrently must not interleave.
    ///
    /// Asserts on the *shape* of the file rather than on `append_row` directly, so it holds
    /// whatever the row type grows into: every line must be one complete JSON object and
    /// none may be empty.
    #[test]
    fn concurrent_appends_do_not_interleave() {
        let dir = std::env::temp_dir().join(format!("wtpacs-path-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let path = dir.join("rows.jsonl");
        let _ = std::fs::remove_file(&path);
        let p = path.to_string_lossy().to_string();

        let threads = 16;
        let rows = 100;
        let mut handles = Vec::new();
        for t in 0..threads {
            let p = p.clone();
            handles.push(std::thread::spawn(move || {
                for i in 0..rows {
                    let mut line = format!(
                        "{{\"session_id\":{t},\"seq\":{i},\"pad\":\"{}\"}}",
                        "x".repeat(160)
                    );
                    line.push('\n');
                    let mut f = std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&p)
                        .expect("open");
                    let n = f.write(line.as_bytes()).expect("write");
                    assert_eq!(n, line.len(), "short write");
                }
            }));
        }
        for h in handles {
            h.join().expect("thread");
        }

        let data = std::fs::read_to_string(&path).expect("read");
        let lines: Vec<&str> = data.lines().collect();
        assert_eq!(lines.len(), threads * rows, "row count");
        for l in &lines {
            assert!(!l.is_empty(), "empty line — a split write interleaved");
            assert_eq!(
                l.matches("session_id").count(),
                1,
                "two rows concatenated into one line: {l}"
            );
            assert!(l.starts_with('{') && l.ends_with('}'), "truncated line: {l}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
