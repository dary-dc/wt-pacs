use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Instant;

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
    /// When true, depth is the warm-up fixed value and adapts per L2 estimator.
    pub dynamic_depth: bool,
    /// Path RTT (ms) for dynamic BDP formula when measured/configured (L2 v2).
    pub path_rtt_ms: Option<u64>,
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
    /// p95 of the same wait samples (ask→displayable diagnostic).
    pub p95_wait_ms: f64,
    /// Primary L2 v2 metric: p95 lateness vs reader schedule.
    #[serde(default)]
    pub p95_lateness_ms: f64,
    #[serde(default)]
    pub mean_lateness_ms: f64,
    #[serde(default)]
    pub frac_steps_late: f64,
    /// Raw per-step lateness (ms); on-time / cache hits are 0.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lateness_ms: Vec<f64>,
    /// Raw per-step waits (ms); cache hits are 0. Ask→display diagnostic.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub wait_ms: Vec<f64>,
    /// Ask→first-byte samples (ms). Path-RTT probe must use these, not `wait_ms`
    /// (displayable includes full-frame transfer).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ask_first_byte_ms: Vec<f64>,
    /// Median of `ask_first_byte_ms` (0 if empty).
    #[serde(default)]
    pub median_ask_first_byte_ms: f64,
    pub wait_samples: u32,
    #[serde(default)]
    pub duplicate_asks: u32,
    #[serde(default)]
    pub unique_frames_asked: u32,
    #[serde(default)]
    pub drain_incomplete: bool,
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
    /// Dynamic arm: min/max D observed; 0 when not dynamic.
    #[serde(default)]
    pub d_min_observed: u32,
    #[serde(default)]
    pub d_max_observed: u32,
    /// Dynamic arm: `d_current` after each completed displayable step.
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
    /// Per want: ask→displayable (0 on cache hit at ask time).
    pub wait_samples_ms: Vec<f64>,
    /// Per step: displayable − scheduled reader time (primary L2 v2 metric).
    pub lateness_samples_ms: Vec<f64>,
    /// Ask→first-byte (length-prefix) samples for path-RTT probes.
    pub ask_first_byte_samples_ms: Vec<f64>,
    pub duplicate_asks: u32,
    pub drain_incomplete: bool,
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
            wait_samples_ms: Vec::new(),
            lateness_samples_ms: Vec::new(),
            ask_first_byte_samples_ms: Vec::new(),
            duplicate_asks: 0,
            drain_incomplete: false,
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

    pub fn on_envelope(&mut self, index: u32, nbytes: u64) {
        self.frames_on_wire += 1;
        self.bytes_on_wire += nbytes;
        self.cache.insert(index);
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

    pub fn record_step(&mut self, lateness_ms: f64, ask_wait_ms: f64) {
        self.lateness_samples_ms.push(lateness_ms);
        self.wait_samples_ms.push(ask_wait_ms);
    }

    pub fn record_ask_first_byte_ms(&mut self, ms: f64) {
        self.ask_first_byte_samples_ms.push(ms);
    }

    pub fn record_wait_ms(&mut self, ms: f64) {
        self.wait_samples_ms.push(ms);
    }

    pub fn note_duplicate_ask(&mut self) {
        self.duplicate_asks = self.duplicate_asks.saturating_add(1);
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
        d_min_observed: u32,
        d_max_observed: u32,
        d_current: Vec<u32>,
        depth_oscillating: bool,
        depth_saturated: bool,
        drain_incomplete: bool,
        duplicate_asks: u32,
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
        let (mean_lateness_ms, p95_lateness_ms) = wait_stats(&self.lateness_samples_ms);
        let median_ask_first_byte_ms = {
            let mut v = self.ask_first_byte_samples_ms.clone();
            if v.is_empty() {
                0.0
            } else {
                v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let n = v.len();
                if n % 2 == 1 {
                    v[n / 2]
                } else {
                    (v[n / 2 - 1] + v[n / 2]) / 2.0
                }
            }
        };
        let late = self
            .lateness_samples_ms
            .iter()
            .filter(|&&x| x > 0.0)
            .count();
        let frac_steps_late = if self.lateness_samples_ms.is_empty() {
            0.0
        } else {
            late as f64 / self.lateness_samples_ms.len() as f64
        };
        let ask_join = crate::client::take_ask_join();
        let unique_frames_asked = ask_join
            .iter()
            .map(|r| r.frame_index)
            .collect::<HashSet<_>>()
            .len() as u32;
        let wait_samples = self.lateness_samples_ms.len().max(self.wait_samples_ms.len()) as u32;
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
            p95_lateness_ms,
            mean_lateness_ms,
            frac_steps_late,
            lateness_ms: self.lateness_samples_ms.clone(),
            wait_ms: self.wait_samples_ms.clone(),
            ask_first_byte_ms: self.ask_first_byte_samples_ms.clone(),
            median_ask_first_byte_ms,
            wait_samples: wait_samples,
            duplicate_asks,
            unique_frames_asked,
            drain_incomplete,
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
            ask_join,
            d_min_observed,
            d_max_observed,
            d_current,
            depth_oscillating,
            depth_saturated,
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
    let rank = rank.clamp(1, n);
    sorted_asc[rank - 1]
}

fn wait_stats(samples: &[f64]) -> (f64, f64) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p95 = nearest_rank_percentile(&sorted, 95.0);
    (mean, p95)
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
}
