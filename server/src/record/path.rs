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

/// Append one JSON line. Best-effort: telemetry must never take down a session, so every
/// failure here is swallowed rather than propagated (R7 — no panics on the record path).
fn append_row(path: &str, row: &PathSample) {
    let Ok(line) = serde_json::to_string(row) else {
        return;
    };
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{line}");
    }
}
