//! Path sampling: congestive or exogenous loss? Counters only — see docs/transport/why-these-changes.md §1.

use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::tap::env_enabled;

/// One sample of the QUIC path. Counters are cumulative, as quinn reports them: deltas
/// would make a dropped sample and a quiet path indistinguishable.
#[derive(Debug, Clone, Serialize)]
pub struct PathSample {
    pub session_id: u64,
    /// Milliseconds since the sampler started. Monotonic, so it cannot jump backwards.
    pub t_ms: u64,
    /// quinn's current smoothed RTT estimate, microseconds.
    pub rtt_us: u64,
    /// Smallest RTT so far. `rtt_us - min_rtt_us` is the queueing delay — the diagnostic.
    pub min_rtt_us: u64,
    pub cwnd: u64,
    pub congestion_events: u64,
    pub lost_packets: u64,
    pub lost_bytes: u64,
    pub sent_packets: u64,
    /// PLPMTUD losing consecutive large packets. Expected under congestive loss, so it is
    /// not a handover signal and the classifier must not exclude on it.
    pub black_holes_detected: u64,
    pub current_mtu: u16,
    /// Rows this process failed to write since the last one it did, across all connections.
    /// Rides in the data, not a log: non-zero means this series has holes.
    pub dropped_since_last: u64,
}

/// Samples one connection until it ends. At high connection counts raise the interval
/// rather than sampling a subset: a biased subset is worse than a coarser series.
pub struct PathSampler {
    session_id: u64,
    started: Instant,
    min_rtt: Duration,
}

impl PathSampler {
    /// Enabled by `WTPACS_PATH_TELEMETRY`. Its own switch, not the frame tap's — see
    /// `record::mod`.
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
        // Kept, not derived later: the true minimum may fall between two samples.
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

/// Its own counter, because the tap's would be 0 in every row whenever the tap is off.
/// Joining path rows to frame rows therefore needs both switches on.
static PATH_SESSION_IDS: AtomicU64 = AtomicU64::new(0);

/// Sample `connection` until it closes, appending one JSON line per interval.
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
        // Sampling after close reports a frozen path as a quiet one, biasing toward exogenous.
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

/// Append one JSON line in ONE `write`: the newline must ride in the same buffer, because
/// `writeln!` issues two writes and concurrent appenders interleave between them.
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

    /// Asserts the file's shape, not `append_row`, so it survives the row type changing.
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
