use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// How the reader advances through the trace.
///
/// This is the single most consequential setting in the harness. See
/// `docs/transport-conclusions.md` §2: with `Closed`, no stream-shape or
/// head-of-line-blocking question can be answered, because the reader travels at the
/// speed of the transport and is never stuck behind data it no longer wants.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum ReaderMode {
    /// Block for each cursor to become displayable before advancing.
    ///
    /// Models a viewer that refuses to scroll past a blank frame. Every prior campaign
    /// ran this way. Retained so those results stay reproducible — **not** for
    /// stream-shape work.
    Closed,
    /// Advance on the trace's own wall clock, whatever has arrived.
    ///
    /// Models a viewer dragging a scrollbar: the reader keeps moving, the transport
    /// falls behind, and frames still in flight become frames nobody wants any more.
    /// This is the only mode in which head-of-line blocking can occur.
    Open,
}

impl ReaderMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Open => "open",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum StreamMode {
    /// One persistent uni stream for the session.
    Shared,
    /// One uni stream per frame.
    PerFrame,
}

impl StreamMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "shared",
            Self::PerFrame => "per-frame",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarnessMode {
    /// Trace-driven fly / settle (E2).
    Trace,
    /// Stationary pipeline fill only (E1).
    Saturate,
}

#[derive(Debug, Clone)]
pub struct RunConfig {
    pub wt_url: String,
    pub read_bps: u64,
    pub timeout_ms: u64,
    /// Outstanding-ask depth D (0 = legacy fire-all schedule).
    pub depth: u32,
    /// After settle + wanted, dwell this many ms to measure fill_rate.
    pub fill_dwell_ms: u64,
    /// Study frame count for window construction.
    pub frame_count: u32,
    pub mode: HarnessMode,
    /// Pre-fetch all schedule frames before settle (E2 warm-cache control).
    pub warm_cache: bool,
    /// Simulated RTT (ms), applied once on the return path.
    pub rtt_ms: u64,
    /// Must match the server's `--stream-mode`.
    pub stream_mode: StreamMode,
    /// Local bind IP for the client socket. `0.0.0.0` on hosts without an IPv6 stack.
    pub bind_ip: std::net::IpAddr,
    /// Client display-cache capacity in frames; 0 = unbounded.
    pub cache_frames: usize,
    /// Whether the reader waits for the transport or runs on its own clock.
    pub reader_mode: ReaderMode,
    /// Open-loop only: after the last step, keep resolving outstanding wants for this
    /// long before declaring the remainder censored.
    pub drain_ms: u64,
    /// Multiplier on the trace's `step_interval_ms`. >1 slows the reader, <1 speeds it up.
    ///
    /// Exists because the reader's offered load must be set against the rate the link can
    /// **achieve**, not the rate it is labelled with. At 1 % loss and 600 ms RTT, Cubic's
    /// Mathis ceiling is 0.24 Mbps while a 30 fps reader over 64 KB frames demands ~15
    /// Mbps — a 62× overload in which every arm simply collapses and nothing is
    /// distinguished. Calibrated once per cell on a single reference arm, then frozen
    /// across all arms so the operating point cannot be tuned per-arm.
    pub step_scale: f64,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct HarnessMetrics {
    pub trace: String,
    pub mode: String,
    pub read_bps: u64,
    pub depth: u32,
    /// Stream architecture this run was measured on. Depth results are not comparable across it.
    pub stream_mode: String,
    /// Peak concurrent outstanding asks actually observed. If this is below `depth`,
    /// the harness did not produce the concurrency it claims and the run is void.
    #[serde(default)]
    pub peak_outstanding: u32,
    pub arm_label: String,
    pub wanted_frame: u32,
    pub asks_sent: u32,
    pub recovered_ms: f64,
    /// Mean time from reader-wants to displayable; cache hits count as 0.
    pub mean_wait_ms: f64,
    /// p95 of the same wait samples.
    pub p95_wait_ms: f64,
    /// Raw per-step waits (ms); cache hits are 0. For derived random arm offline.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub wait_ms: Vec<f64>,
    pub wait_samples: u32,
    /// Steady-state frames/s while fill is active.
    pub fill_rate: f64,
    pub fill_frames: u32,
    pub fill_bytes: u64,
    pub fill_dwell_ms: u64,
    /// fill_bytes*8/dwell_s as fraction of read_bps (E1 util).
    pub link_util: f64,
    pub wasted_bytes: u64,
    pub commitment_depth: u32,
    pub wanted_received: bool,
    pub frames_on_wire: u32,
    pub bytes_on_wire: u64,
    pub frames_after_settle: u32,
    pub bytes_after_settle: u64,
    pub frames_before_settle: u32,
    pub bytes_before_settle: u64,
    pub warm_cache: bool,
    /// Simulated RTT (ms), applied once on the return path.
    pub rtt_ms: u64,
    /// Per FoD ask sent: `(frame_index, ask_ordinal)` for offline join with server Tap.
    /// Ordinals increment per `frame_index` within the session (same rule as server Tap).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ask_join: Vec<AskJoinRow>,

    // ---- open-loop reader instrumentation -------------------------------------------
    /// `closed` or `open`. Results are not comparable across it.
    #[serde(default)]
    pub reader_mode: String,
    /// Wants the run ended without ever satisfying, counted at the censoring bound.
    ///
    /// **Must be reported with every p95.** An arm that fails to deliver otherwise loses
    /// its slowest samples and wins the comparison by delivering less — the exact bias
    /// that made a closed-loop p95 look respectable.
    #[serde(default)]
    pub censored_waits: u32,
    /// `censored_waits / wait_samples`. Above the campaign's void threshold the arm
    /// collapsed and its p95 means nothing.
    #[serde(default)]
    pub censored_frac: f64,
    /// How far behind its own clock the reader finished, in ms.
    ///
    /// Open-loop only, and the direct evidence that the reader was *able* to outrun the
    /// transport: at 0 the reader kept its schedule and the run tested nothing that a
    /// closed-loop run does not.
    #[serde(default)]
    pub reader_lag_ms: f64,
    /// Bytes that arrived for a frame the reader had already scrolled away from.
    ///
    /// This is the head-of-line-blocking load itself. **If it is 0, no stream-shape
    /// comparison from the run is admissible** — nothing was ever queued ahead of
    /// something wanted.
    #[serde(default)]
    pub stranded_bytes: u64,
    /// Frames counted in `stranded_bytes`.
    #[serde(default)]
    pub stranded_frames: u32,
    /// Steps whose centre ask was suppressed by the hard outstanding ceiling.
    /// Non-zero voids the run's p95 — see `client::center_asks_dropped`.
    #[serde(default)]
    pub center_asks_dropped: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct AskJoinRow {
    pub frame_index: u32,
    pub ask_ordinal: u32,
}

#[derive(Debug)]
pub struct MetricsState {
    pub wanted_frame: u32,
    pub settled: bool,
    pub reversal_at: Option<Instant>,
    pub first_byte_wanted_at: Option<Instant>,
    pub wasted_bytes: u64,
    pub commitment_depth: u32,
    pub wanted_received: bool,
    pub frames_on_wire: u32,
    pub bytes_on_wire: u64,
    pub frames_after_settle: u32,
    pub bytes_after_settle: u64,
    pub fill_active: bool,
    pub fill_frames: u32,
    pub fill_bytes: u64,
    pub fill_started_at: Option<Instant>,
    /// Client-side display cache: frame index is displayable once present.
    pub cache: HashSet<u32>,
    /// LRU order for `cache`, most-recently-used last. Empty when the cache is unbounded.
    pub cache_lru: Vec<u32>,
    /// Max frames held, 0 = unbounded. A tablet browser cannot hold a whole CT series:
    /// 500 slices at 250 KB is 125 MB. With an unbounded cache the client holds the
    /// entire study within seconds and no jump can miss, which collapses the
    /// informative sample count and makes head-of-line blocking unmeasurable.
    pub cache_cap: usize,
    /// Per want: ms until displayable (0 on cache hit).
    pub wait_samples_ms: Vec<f64>,

    // ---- open-loop reader state -----------------------------------------------------
    /// Instant each frame index most recently arrived.
    ///
    /// The open-loop reader resolves waits from these recorded instants rather than by
    /// polling cache membership. That makes the measured wait independent of poll
    /// granularity (the closed-loop path quantised every wait to its 2 ms sleep) and
    /// immune to a frame arriving and being LRU-evicted between polls.
    pub last_arrival: HashMap<u32, Instant>,
    /// Frame indices the reader currently has on screen or in its prefetch window.
    /// Anything arriving outside this set is stranded — see `stranded_bytes`.
    pub live_window: HashSet<u32>,
    pub stranded_bytes: u64,
    pub stranded_frames: u32,
    pub censored_waits: u32,
    /// How far behind its own clock an open-loop reader finished, in ms. See
    /// `HarnessMetrics::reader_lag_ms`.
    pub reader_lag_ms: f64,
}

impl MetricsState {
    pub fn new(wanted: u32) -> Self {
        Self {
            wanted_frame: wanted,
            settled: false,
            reversal_at: None,
            first_byte_wanted_at: None,
            wasted_bytes: 0,
            commitment_depth: 0,
            wanted_received: false,
            frames_on_wire: 0,
            bytes_on_wire: 0,
            frames_after_settle: 0,
            bytes_after_settle: 0,
            fill_active: false,
            fill_frames: 0,
            fill_bytes: 0,
            fill_started_at: None,
            cache: HashSet::new(),
            cache_lru: Vec::new(),
            cache_cap: 0,
            wait_samples_ms: Vec::new(),
            last_arrival: HashMap::new(),
            live_window: HashSet::new(),
            stranded_bytes: 0,
            stranded_frames: 0,
            censored_waits: 0,
            reader_lag_ms: 0.0,
        }
    }

    pub fn settle(&mut self) {
        if !self.settled {
            self.settled = true;
            self.reversal_at = Some(Instant::now());
        }
    }

    pub fn start_fill(&mut self) {
        self.fill_active = true;
        self.fill_frames = 0;
        self.fill_bytes = 0;
        self.fill_started_at = Some(Instant::now());
    }

    pub fn stop_fill(&mut self) {
        self.fill_active = false;
    }

    /// Insert `index` and evict least-recently-used frames beyond `cache_cap`.
    pub fn touch_cache(&mut self, index: u32) {
        if let Some(pos) = self.cache_lru.iter().position(|&x| x == index) {
            self.cache_lru.remove(pos);
        }
        self.cache_lru.push(index);
        self.cache.insert(index);
        if self.cache_cap > 0 {
            while self.cache_lru.len() > self.cache_cap {
                let evicted = self.cache_lru.remove(0);
                self.cache.remove(&evicted);
            }
        }
    }

    pub fn on_envelope(&mut self, index: u32, nbytes: u64) {
        self.frames_on_wire += 1;
        self.bytes_on_wire += nbytes;
        self.last_arrival.insert(index, Instant::now());
        // A frame the reader has already scrolled past. Counted only once the reader has
        // established a window at all, so the warm-cache prefetch is not miscounted as
        // stranding.
        if !self.live_window.is_empty() && !self.live_window.contains(&index) {
            self.stranded_bytes += nbytes;
            self.stranded_frames += 1;
        }
        self.touch_cache(index);
        if self.settled {
            self.frames_after_settle += 1;
            self.bytes_after_settle += nbytes;
        }
        if self.fill_active {
            self.fill_frames += 1;
            self.fill_bytes += nbytes;
        }

        if index == self.wanted_frame {
            if self.first_byte_wanted_at.is_none() {
                self.first_byte_wanted_at = Some(Instant::now());
            }
            self.wanted_received = true;
            return;
        }
        if self.settled {
            self.wasted_bytes += nbytes;
            self.commitment_depth += 1;
        }
    }

    pub fn record_wait_ms(&mut self, ms: f64) {
        self.wait_samples_ms.push(ms);
    }

    pub fn finalize(
        &self,
        trace: &str,
        mode: &str,
        read_bps: u64,
        depth: u32,
        arm_label: &str,
        asks_sent: u32,
        fill_dwell_ms: u64,
        warm_cache: bool,
        rtt_ms: u64,
        stream_mode: StreamMode,
        reader_mode: ReaderMode,
    ) -> HarnessMetrics {
        let recovered_ms = match (self.reversal_at, self.first_byte_wanted_at) {
            (Some(r), Some(w)) => w.duration_since(r).as_secs_f64() * 1000.0,
            _ => 0.0,
        };
        let dwell_s = fill_dwell_ms as f64 / 1000.0;
        let fill_rate = if dwell_s > 0.0 {
            self.fill_frames as f64 / dwell_s
        } else {
            0.0
        };
        let throughput_bps = if dwell_s > 0.0 {
            (self.fill_bytes as f64 * 8.0) / dwell_s
        } else {
            0.0
        };
        let link_util = if read_bps > 0 {
            throughput_bps / read_bps as f64
        } else {
            0.0
        };
        let (mean_wait_ms, p95_wait_ms) = wait_stats(&self.wait_samples_ms);
        HarnessMetrics {
            trace: trace.to_string(),
            mode: mode.to_string(),
            read_bps,
            depth,
            stream_mode: stream_mode.as_str().to_string(),
            peak_outstanding: crate::client::peak_outstanding(),
            arm_label: arm_label.to_string(),
            wanted_frame: self.wanted_frame,
            asks_sent,
            recovered_ms,
            mean_wait_ms,
            p95_wait_ms,
            wait_ms: self.wait_samples_ms.clone(),
            wait_samples: self.wait_samples_ms.len() as u32,
            fill_rate,
            fill_frames: self.fill_frames,
            fill_bytes: self.fill_bytes,
            fill_dwell_ms,
            link_util,
            wasted_bytes: self.wasted_bytes,
            commitment_depth: self.commitment_depth,
            wanted_received: self.wanted_received,
            frames_on_wire: self.frames_on_wire,
            bytes_on_wire: self.bytes_on_wire,
            frames_after_settle: self.frames_after_settle,
            bytes_after_settle: self.bytes_after_settle,
            frames_before_settle: self.frames_on_wire.saturating_sub(self.frames_after_settle),
            bytes_before_settle: self.bytes_on_wire.saturating_sub(self.bytes_after_settle),
            warm_cache,
            rtt_ms,
            ask_join: crate::client::take_ask_join(),
            reader_mode: reader_mode.as_str().to_string(),
            censored_waits: self.censored_waits,
            censored_frac: if self.wait_samples_ms.is_empty() {
                0.0
            } else {
                self.censored_waits as f64 / self.wait_samples_ms.len() as f64
            },
            reader_lag_ms: self.reader_lag_ms,
            stranded_bytes: self.stranded_bytes,
            stranded_frames: self.stranded_frames,
            center_asks_dropped: crate::client::center_asks_dropped(),
        }
    }
}

fn wait_stats(samples: &[f64]) -> (f64, f64) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((sorted.len() as f64 - 1.0) * 0.95).ceil() as usize;
    let p95 = sorted[idx.min(sorted.len() - 1)];
    (mean, p95)
}

pub type SharedMetrics = Arc<Mutex<MetricsState>>;
