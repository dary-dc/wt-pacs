use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub use crate::depth::RttSource;

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

/// Which frames the client wants ahead of the one on screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum WindowShape {
    /// Centre, then the next frames in the direction of travel, clamped at the study edges.
    Forward,
    /// Centre ± radius modulo the frame count — the v2 campaign's window. At the study start it
    /// asks for the last frames of the study; kept only so those rows can be reproduced.
    Ring,
}

impl WindowShape {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Forward => "forward",
            Self::Ring => "ring",
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
    /// In-flight ask cap `D`; 0 = unbounded. The frame on screen is always asked — the cap
    /// bounds prefetch, as it would in a viewer.
    pub depth: u32,
    /// Frames wanted ahead of the one on screen. 0 = ask only for what is on screen.
    pub prefetch: u32,
    pub window_shape: WindowShape,
    /// After settle + wanted, dwell this many ms to measure fill_rate.
    pub fill_dwell_ms: u64,
    /// Study frame count for window construction.
    pub frame_count: u32,
    pub mode: HarnessMode,
    /// Pre-fetch all schedule frames before settle (E2 warm-cache control).
    pub warm_cache: bool,
    /// Emulated path RTT (ms): half before each ask leaves, half before each frame is
    /// displayable. Lets a loopback run reproduce the pipelining a real path needs.
    pub rtt_ms: u64,
    /// Must match the server's `--stream-mode`.
    pub stream_mode: StreamMode,
    /// Bind the client socket IPv4-only (hosts without IPv6).
    pub ipv4: bool,
    /// When true, `depth` is the warm-up value and adapts per the L2 estimator.
    pub dynamic_depth: bool,
    pub rtt_source: RttSource,
    /// Path RTT (ms) for `RttSource::Path`.
    pub path_rtt_ms: Option<u64>,
}

impl RunConfig {
    /// The in-flight cap as the ask loop sees it.
    pub fn max_in_flight(&self) -> u32 {
        if self.depth == 0 {
            u32::MAX
        } else {
            self.depth
        }
    }
}

/// What the dynamic arm did, for the report.
#[derive(Debug, Clone, Default)]
pub struct DepthReport {
    pub depth: u32,
    pub d_min_observed: u32,
    pub d_max_observed: u32,
    pub d_current: Vec<u32>,
    pub oscillating: bool,
    pub saturated: bool,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct HarnessMetrics {
    pub trace: String,
    pub mode: String,
    pub read_bps: u64,
    pub depth: u32,
    #[serde(default)]
    pub prefetch: u32,
    #[serde(default)]
    pub window_shape: String,
    #[serde(default)]
    pub rtt_source: String,
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
    /// p95 of the same wait samples (ask→displayable diagnostic).
    pub p95_wait_ms: f64,
    /// Primary L2 metric: lateness vs the reader schedule (displayable − scheduled), per step.
    #[serde(default)]
    pub p95_lateness_ms: f64,
    #[serde(default)]
    pub mean_lateness_ms: f64,
    #[serde(default)]
    pub lateness_median_ms: f64,
    #[serde(default)]
    pub lateness_p75_ms: f64,
    #[serde(default)]
    pub lateness_max_ms: f64,
    #[serde(default)]
    pub frac_steps_late: f64,
    /// Per-step lateness (ms) in step order; on-time / cache hits are 0.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lateness_ms: Vec<f64>,
    /// Per-step ask→displayable (ms) in step order; cache hits are 0.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub wait_ms: Vec<f64>,
    /// Ask→first-byte samples (ms), emulated RTT included. Path-RTT probes use these, not
    /// `wait_ms` (displayable includes the full-frame transfer).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ask_first_byte_ms: Vec<f64>,
    #[serde(default)]
    pub median_ask_first_byte_ms: f64,
    pub wait_samples: u32,
    #[serde(default)]
    pub duplicate_asks: u32,
    #[serde(default)]
    pub unique_frames_asked: u32,
    #[serde(default)]
    pub drain_incomplete: bool,
    /// Trace start → last step displayable (ms). Zero when nothing was displayable.
    #[serde(default)]
    pub wall_ms: f64,
    /// bytes_on_wire × 8 over first ask → last arrival. The link the run actually saw.
    #[serde(default)]
    pub achieved_mbps: f64,
    /// Frames that arrived but no step of the trace ever wants — what a reversal or a jump
    /// leaves in the pipe.
    #[serde(default)]
    pub stranded_frames: u32,
    #[serde(default)]
    pub stranded_bytes: u64,
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
    /// Emulated RTT (ms), see `RunConfig::rtt_ms`.
    pub rtt_ms: u64,
    /// Per FoD ask sent: `(frame_index, ask_ordinal)` for offline join with server Tap.
    /// Ordinals increment per `frame_index` within the session (same rule as server Tap).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ask_join: Vec<AskJoinRow>,
    /// Dynamic arm: min/max D observed; the fixed depth otherwise.
    #[serde(default)]
    pub d_min_observed: u32,
    #[serde(default)]
    pub d_max_observed: u32,
    /// Dynamic arm: `d_current` after each completed frame.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub d_current: Vec<u32>,
    /// Dynamic arm tripped the oscillation stop condition.
    #[serde(default)]
    pub depth_oscillating: bool,
    #[serde(default)]
    pub depth_saturated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AskJoinRow {
    pub frame_index: u32,
    pub ask_ordinal: u32,
}

#[derive(Debug, Clone, Copy)]
struct StepSample {
    index: usize,
    lateness_ms: f64,
    wait_ms: f64,
}

#[derive(Debug)]
pub struct MetricsState {
    pub wanted_frame: u32,
    /// Every frame some step of the trace wants; `None` in saturate mode.
    wanted_frames: Option<HashSet<u32>>,
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
    pub stranded_frames: u32,
    pub stranded_bytes: u64,
    pub fill_active: bool,
    pub fill_frames: u32,
    pub fill_bytes: u64,
    pub fill_started_at: Option<Instant>,
    /// Client-side display cache: frame index is displayable once present.
    pub cache: HashSet<u32>,
    /// When each cached frame arrived (its last arrival).
    arrivals: HashMap<u32, Instant>,
    steps: Vec<StepSample>,
    /// Ask→first-byte (length-prefix) samples for path-RTT probes.
    pub ask_first_byte_samples_ms: Vec<f64>,
    pub drain_incomplete: bool,
    pub trace_start: Option<Instant>,
    pub first_ask_at: Option<Instant>,
    pub last_arrival_at: Option<Instant>,
    pub last_displayable_at: Option<Instant>,
}

impl MetricsState {
    pub fn new(wanted: u32, wanted_frames: Option<HashSet<u32>>) -> Self {
        Self {
            wanted_frame: wanted,
            wanted_frames,
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
            stranded_frames: 0,
            stranded_bytes: 0,
            fill_active: false,
            fill_frames: 0,
            fill_bytes: 0,
            fill_started_at: None,
            cache: HashSet::new(),
            arrivals: HashMap::new(),
            steps: Vec::new(),
            ask_first_byte_samples_ms: Vec::new(),
            drain_incomplete: false,
            trace_start: None,
            first_ask_at: None,
            last_arrival_at: None,
            last_displayable_at: None,
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

    pub fn note_ask(&mut self, at: Instant) {
        self.first_ask_at.get_or_insert(at);
    }

    pub fn on_envelope(&mut self, index: u32, nbytes: u64) {
        let now = Instant::now();
        self.frames_on_wire += 1;
        self.bytes_on_wire += nbytes;
        self.cache.insert(index);
        self.arrivals.insert(index, now);
        self.last_arrival_at = Some(now);
        if self.settled {
            self.frames_after_settle += 1;
            self.bytes_after_settle += nbytes;
        }
        if self.fill_active {
            self.fill_frames += 1;
            self.fill_bytes += nbytes;
        }
        if matches!(&self.wanted_frames, Some(w) if !w.contains(&index)) {
            self.stranded_frames += 1;
            self.stranded_bytes += nbytes;
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

    /// Step `index` became displayable at `at`.
    pub fn record_step(&mut self, index: usize, lateness_ms: f64, wait_ms: f64, at: Instant) {
        self.steps.push(StepSample { index, lateness_ms, wait_ms });
        self.last_displayable_at = Some(match self.last_displayable_at {
            Some(prev) if prev > at => prev,
            _ => at,
        });
    }

    pub fn record_ask_first_byte_ms(&mut self, ms: f64) {
        self.ask_first_byte_samples_ms.push(ms);
    }

    /// When `frame` last arrived, if it is in the cache.
    pub fn arrived_at(&self, frame: u32) -> Option<Instant> {
        self.arrivals.get(&frame).copied()
    }

    pub fn finalize(
        &self,
        cfg: &RunConfig,
        trace: &str,
        mode: &str,
        arm_label: &str,
        asks_sent: u32,
        depth: &DepthReport,
    ) -> HarnessMetrics {
        let recovered_ms = match (self.reversal_at, self.first_byte_wanted_at) {
            (Some(r), Some(w)) => w.duration_since(r).as_secs_f64() * 1000.0,
            _ => 0.0,
        };
        let dwell_s = cfg.fill_dwell_ms as f64 / 1000.0;
        let fill_rate = if dwell_s > 0.0 { self.fill_frames as f64 / dwell_s } else { 0.0 };
        let throughput_bps = if dwell_s > 0.0 { (self.fill_bytes as f64 * 8.0) / dwell_s } else { 0.0 };
        let link_util = if cfg.read_bps > 0 { throughput_bps / cfg.read_bps as f64 } else { 0.0 };

        let mut steps = self.steps.clone();
        steps.sort_by_key(|s| s.index);
        let lateness_ms: Vec<f64> = steps.iter().map(|s| s.lateness_ms).collect();
        let wait_ms: Vec<f64> = steps.iter().map(|s| s.wait_ms).collect();
        let (mean_wait_ms, p95_wait_ms) = wait_stats(&wait_ms);
        let (mean_lateness_ms, p95_lateness_ms) = wait_stats(&lateness_ms);
        let mut sorted_lateness = lateness_ms.clone();
        sorted_lateness.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let late = lateness_ms.iter().filter(|&&x| x > 0.0).count();
        let frac_steps_late = if lateness_ms.is_empty() { 0.0 } else { late as f64 / lateness_ms.len() as f64 };

        let mut first_byte = self.ask_first_byte_samples_ms.clone();
        first_byte.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let wall_ms = match (self.trace_start, self.last_displayable_at) {
            (Some(t0), Some(t1)) => t1.saturating_duration_since(t0).as_secs_f64() * 1000.0,
            _ => 0.0,
        };
        let achieved_mbps = match (self.first_ask_at, self.last_arrival_at) {
            (Some(t0), Some(t1)) if t1 > t0 => {
                self.bytes_on_wire as f64 * 8.0 / t1.duration_since(t0).as_secs_f64() / 1e6
            }
            _ => 0.0,
        };
        let ask_join = crate::client::take_ask_join();
        let unique_frames_asked = ask_join.iter().map(|r| r.frame_index).collect::<HashSet<_>>().len() as u32;
        // Every ask after the first for the same frame went out on the wire twice.
        let duplicate_asks = ask_join.iter().filter(|r| r.ask_ordinal > 0).count() as u32;
        HarnessMetrics {
            trace: trace.to_string(),
            mode: mode.to_string(),
            read_bps: cfg.read_bps,
            depth: depth.depth,
            prefetch: cfg.prefetch,
            window_shape: cfg.window_shape.as_str().to_string(),
            rtt_source: if cfg.dynamic_depth { cfg.rtt_source.as_str().to_string() } else { String::new() },
            stream_mode: cfg.stream_mode.as_str().to_string(),
            peak_outstanding: crate::client::peak_outstanding(),
            arm_label: arm_label.to_string(),
            wanted_frame: self.wanted_frame,
            asks_sent,
            recovered_ms,
            mean_wait_ms,
            p95_wait_ms,
            p95_lateness_ms,
            mean_lateness_ms,
            lateness_median_ms: nearest_rank_percentile(&sorted_lateness, 50.0),
            lateness_p75_ms: nearest_rank_percentile(&sorted_lateness, 75.0),
            lateness_max_ms: sorted_lateness.last().copied().unwrap_or(0.0),
            frac_steps_late,
            lateness_ms,
            wait_ms: wait_ms.clone(),
            ask_first_byte_ms: self.ask_first_byte_samples_ms.clone(),
            median_ask_first_byte_ms: nearest_rank_percentile(&first_byte, 50.0),
            wait_samples: wait_ms.len() as u32,
            duplicate_asks,
            unique_frames_asked,
            drain_incomplete: self.drain_incomplete,
            wall_ms,
            achieved_mbps,
            stranded_frames: self.stranded_frames,
            stranded_bytes: self.stranded_bytes,
            fill_rate,
            fill_frames: self.fill_frames,
            fill_bytes: self.fill_bytes,
            fill_dwell_ms: cfg.fill_dwell_ms,
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
            warm_cache: cfg.warm_cache,
            rtt_ms: cfg.rtt_ms,
            ask_join,
            d_min_observed: depth.d_min_observed,
            d_max_observed: depth.d_max_observed,
            d_current: depth.d_current.clone(),
            depth_oscillating: depth.oscillating,
            depth_saturated: depth.saturated,
        }
    }
}

/// Nearest-rank percentile (L2 / client telemetry contract).
///
/// `rank = ceil(p/100 × N)`, clamped to `[1, N]`; value = `sorted[rank - 1]`.
pub fn nearest_rank_percentile(sorted_asc: &[f64], p: f64) -> f64 {
    if sorted_asc.is_empty() {
        return 0.0;
    }
    let n = sorted_asc.len();
    let rank = ((p / 100.0) * n as f64).ceil() as usize;
    sorted_asc[rank.clamp(1, n) - 1]
}

fn wait_stats(samples: &[f64]) -> (f64, f64) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    (mean, nearest_rank_percentile(&sorted, 95.0))
}

pub type SharedMetrics = Arc<Mutex<MetricsState>>;

#[cfg(test)]
mod tests {
    use super::*;

    /// Vector where old `((N-1)*0.95).ceil()` index and nearest-rank disagree.
    #[test]
    fn nearest_rank_disagrees_with_old_index() {
        let n = 20usize;
        let sorted: Vec<f64> = (0..n).map(|i| i as f64).collect();
        let old_idx = (((n as f64 - 1.0) * 0.95).ceil() as usize).min(n - 1);
        let old = sorted[old_idx];
        let near = nearest_rank_percentile(&sorted, 95.0);
        assert_ne!(old, near, "old_idx={old_idx} old={old} near={near}");
        // nearest-rank: ceil(0.95*20)=19 → sorted[18]
        assert_eq!(near, 18.0);
    }

    #[test]
    fn nearest_rank_n1() {
        assert_eq!(nearest_rank_percentile(&[42.0], 95.0), 42.0);
    }

    /// Steps complete out of order (a cache hit resolves at once); the report is in step order.
    #[test]
    fn lateness_is_reported_in_step_order() {
        let mut m = MetricsState::new(0, None);
        let now = Instant::now();
        m.record_step(2, 30.0, 30.0, now);
        m.record_step(0, 10.0, 10.0, now);
        m.record_step(1, 0.0, 0.0, now);
        let cfg = RunConfig {
            wt_url: String::new(), read_bps: 0, timeout_ms: 0, depth: 0, prefetch: 0,
            window_shape: WindowShape::Forward, fill_dwell_ms: 0, frame_count: 1,
            mode: HarnessMode::Trace, warm_cache: false, rtt_ms: 0, stream_mode: StreamMode::Shared,
            ipv4: false, dynamic_depth: false, rtt_source: RttSource::FirstByte, path_rtt_ms: None,
        };
        let out = m.finalize(&cfg, "t", "trace", "a", 0, &DepthReport::default());
        assert_eq!(out.lateness_ms, vec![10.0, 0.0, 30.0]);
        assert_eq!(out.lateness_max_ms, 30.0);
        assert_eq!(out.lateness_median_ms, 10.0);
    }
}
