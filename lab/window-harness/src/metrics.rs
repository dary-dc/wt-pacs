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

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum WindowShape {
    /// (c, c+1, c-1, c+2, c-2, …) — for traces that reverse.
    Symmetric,
    /// (c, c+1, c+2, …) — for strictly forward traces.
    Forward,
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
    /// Window shape around the cursor. `Forward` for one-way traces.
    pub window_shape: WindowShape,
    /// Override trace step interval (ms). None = use the trace file.
    pub step_interval_ms: Option<u64>,
    /// Optional QUIC per-stream receive window (bytes). None = stack default.
    pub stream_recv_window: Option<u64>,
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
    /// p95 of the same wait samples (includes cache-hit zeros).
    pub p95_wait_ms: f64,
    /// Mean of positive waits only (network misses). 0 if no misses.
    pub miss_mean_wait_ms: f64,
    /// Nearest-rank p95 of positive waits only. 0 if no misses.
    pub miss_p95_wait_ms: f64,
    /// Steps that were already displayable (wait recorded as 0).
    pub cache_hits: u32,
    /// Steps that waited on the network (wait > 0).
    pub cache_misses: u32,
    /// cache_hits / wait_samples.
    pub cache_hit_rate: f64,
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
    /// Wall time of the trace step loop (ms).
    #[serde(default)]
    pub step_loop_ms: f64,
    /// Median wait in the first half of step-loop samples (ms).
    #[serde(default)]
    pub wait_h1_median_ms: f64,
    /// Median wait in the second half of step-loop samples (ms).
    #[serde(default)]
    pub wait_h2_median_ms: f64,
    /// bytes_on_wire*8/step_loop_s as fraction of read_bps (A5).
    #[serde(default)]
    pub link_util_measured: f64,
    /// Per step: ms the frame became displayable **after its scheduled display time**,
    /// floored at 0. This is the reader-clock metric — `wait_ms` starts at the harness's
    /// ask, so it cannot see a loop that has fallen behind its own cadence.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lateness_ms: Vec<f64>,
    /// Mean of `lateness_ms`.
    #[serde(default)]
    pub late_mean_ms: f64,
    /// Nearest-rank p95 of `lateness_ms`. Supported by every step, not just misses.
    #[serde(default)]
    pub late_p95_ms: f64,
    #[serde(default)]
    pub late_max_ms: f64,
    /// Fraction of steps displayable within `ON_TIME_MS` of their scheduled time.
    #[serde(default)]
    pub on_time_rate: f64,
    /// Per FoD ask sent: `(frame_index, ask_ordinal)` for offline join with server Tap.
    /// Ordinals increment per `frame_index` within the session (same rule as server Tap).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ask_join: Vec<AskJoinRow>,
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
    /// Per want: ms until displayable (0 on cache hit).
    pub wait_samples_ms: Vec<f64>,
    /// Per want: ms past the step's scheduled display time (0 if on time).
    pub lateness_samples_ms: Vec<f64>,
    /// Wall ms of the windowed step loop (set by client).
    pub step_loop_ms: f64,
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
            step_loop_ms: 0.0,
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

    pub fn record_wait_ms(&mut self, ms: f64) {
        self.wait_samples_ms.push(ms);
    }

    /// Lateness against the step's own scheduled display time. Only the trace step
    /// loop has a schedule, so settle / dwell waits do not call this.
    pub fn record_lateness_ms(&mut self, ms: f64) {
        self.lateness_samples_ms.push(ms.max(0.0));
    }

    #[allow(clippy::too_many_arguments)]
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
        let misses: Vec<f64> = self
            .wait_samples_ms
            .iter()
            .copied()
            .filter(|ms| *ms > 0.0)
            .collect();
        let cache_misses = misses.len() as u32;
        let cache_hits = self.wait_samples_ms.len() as u32 - cache_misses;
        let cache_hit_rate = if self.wait_samples_ms.is_empty() {
            0.0
        } else {
            cache_hits as f64 / self.wait_samples_ms.len() as f64
        };
        let (miss_mean_wait_ms, miss_p95_wait_ms) = wait_stats(&misses);
        let (wait_h1_median_ms, wait_h2_median_ms) = half_medians(&self.wait_samples_ms);
        let (late_mean_ms, late_p95_ms) = wait_stats(&self.lateness_samples_ms);
        let late_max_ms = self
            .lateness_samples_ms
            .iter()
            .copied()
            .fold(0.0f64, f64::max);
        let on_time_rate = if self.lateness_samples_ms.is_empty() {
            0.0
        } else {
            self.lateness_samples_ms.iter().filter(|ms| **ms <= ON_TIME_MS).count() as f64
                / self.lateness_samples_ms.len() as f64
        };
        let link_util_measured = if self.step_loop_ms > 0.0 && read_bps > 0 {
            (self.bytes_on_wire as f64 * 8.0) / (self.step_loop_ms / 1000.0) / (read_bps as f64)
        } else {
            0.0
        };
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
            miss_mean_wait_ms,
            miss_p95_wait_ms,
            cache_hits,
            cache_misses,
            cache_hit_rate,
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
            step_loop_ms: self.step_loop_ms,
            wait_h1_median_ms,
            wait_h2_median_ms,
            link_util_measured,
            lateness_ms: self.lateness_samples_ms.clone(),
            late_mean_ms,
            late_p95_ms,
            late_max_ms,
            on_time_rate,
            ask_join: crate::client::take_ask_join(),
        }
    }
}

/// A step displayable within this much of its scheduled time kept the reader's cadence.
/// One frame interval at the cadences this lane runs is 31-32 ms, so 100 ms is ~3 steps:
/// wide enough that scheduler jitter is not counted as lateness, narrow enough that a
/// reader who actually waited is.
pub const ON_TIME_MS: f64 = 100.0;

/// Nearest-rank percentile (L2 brief / client telemetry contract).
/// `rank = ceil(p/100 × N)` clamped to `[1, N]`; value = `sorted[rank - 1]`.
fn percentile_nearest_rank(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let n = sorted.len();
    let rank = ((p / 100.0) * n as f64).ceil() as usize;
    let rank = rank.clamp(1, n);
    sorted[rank - 1]
}


fn half_medians(samples: &[f64]) -> (f64, f64) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mid = samples.len() / 2;
    let (a, b) = if mid == 0 {
        (samples, &[][..])
    } else {
        (&samples[..mid], &samples[mid..])
    };
    let med = |xs: &[f64]| -> f64 {
        if xs.is_empty() {
            return 0.0;
        }
        let mut v = xs.to_vec();
        v.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
        v[v.len() / 2]
    };
    (med(a), med(b))
}

fn wait_stats(samples: &[f64]) -> (f64, f64) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p95 = percentile_nearest_rank(&sorted, 95.0);
    (mean, p95)
}

#[cfg(test)]
mod wait_stats_tests {
    use super::{percentile_nearest_rank, wait_stats};

    #[test]
    fn nearest_rank_disagrees_with_old_index_formula() {
        // N=20: old idx = ceil((19)*0.95)=19 → sorted[19]; nearest-rank rank=ceil(0.95*20)=19 → sorted[18].
        let samples: Vec<f64> = (1..=20).map(|i| i as f64).collect();
        let mut sorted = samples.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let old_idx = (((sorted.len() as f64 - 1.0) * 0.95).ceil() as usize).min(sorted.len() - 1);
        let old = sorted[old_idx];
        let new = percentile_nearest_rank(&sorted, 95.0);
        assert_ne!(old, new, "fixture must disagree: old={old} new={new}");
        assert_eq!(new, 19.0);
        let (_mean, p95) = wait_stats(&samples);
        assert_eq!(p95, 19.0);
    }

    #[test]
    fn lateness_sees_a_backlog_that_wait_ms_cannot() {
        // A loop that falls behind its cadence still reports short waits, because
        // `wait_ms` starts at the ask: by the time the harness asks, the frame is
        // close. Lateness is measured against the step's *scheduled* display time,
        // so it reports the backlog. This is the v2 defect (L1_V2_ADVERSARIAL_REVIEW
        // §B1) expressed as a test.
        let mut m = super::MetricsState::new(0);
        for i in 0..160 {
            m.record_wait_ms(30.0);
            // On schedule for 140 steps, then a backlog that grows and never drains.
            m.record_lateness_ms(if i < 140 { 0.0 } else { (i - 139) as f64 * 100.0 });
        }
        let (_, p95_wait) = super::wait_stats(&m.wait_samples_ms);
        let (_, p95_late) = super::wait_stats(&m.lateness_samples_ms);
        assert_eq!(p95_wait, 30.0, "waits look healthy throughout");
        assert_eq!(p95_late, 1_200.0, "lateness reports the backlog");
        assert_eq!(m.lateness_samples_ms.len(), 160, "every step contributes, hit or miss");
    }

    #[test]
    fn a_single_late_step_needs_late_max_not_late_p95() {
        // Honest about the same tail-support limit that voided miss_p95: one late step
        // in twenty sits above the p95 rank, so the percentile reads 0. `late_max_ms`
        // is what catches it — report both, never the p95 alone.
        let mut m = super::MetricsState::new(0);
        for _ in 0..19 {
            m.record_lateness_ms(0.0);
        }
        m.record_lateness_ms(2_000.0);
        let (_, p95_late) = super::wait_stats(&m.lateness_samples_ms);
        assert_eq!(p95_late, 0.0);
        let max = m.lateness_samples_ms.iter().copied().fold(0.0f64, f64::max);
        assert_eq!(max, 2_000.0);
    }

    #[test]
    fn lateness_floors_at_zero_and_counts_on_time_steps() {
        let mut m = super::MetricsState::new(0);
        // A frame ready before its scheduled time is on time, not negatively late.
        m.record_lateness_ms(-40.0);
        m.record_lateness_ms(super::ON_TIME_MS - 1.0);
        m.record_lateness_ms(super::ON_TIME_MS + 1.0);
        assert_eq!(m.lateness_samples_ms[0], 0.0);
        let on_time = m
            .lateness_samples_ms
            .iter()
            .filter(|ms| **ms <= super::ON_TIME_MS)
            .count();
        assert_eq!(on_time, 2);
    }

    #[test]
    fn miss_only_ignores_cache_hit_zeros() {
        // 19 zeros + one 100ms miss → all-sample nearest-rank p95 is 0; miss-only p95 is 100.
        let mut samples = vec![0.0; 19];
        samples.push(100.0);
        let (mean_all, p95_all) = wait_stats(&samples);
        assert_eq!(p95_all, 0.0);
        assert!((mean_all - 5.0).abs() < 1e-9);
        let misses: Vec<f64> = samples.into_iter().filter(|ms| *ms > 0.0).collect();
        let (miss_mean, miss_p95) = wait_stats(&misses);
        assert_eq!(miss_mean, 100.0);
        assert_eq!(miss_p95, 100.0);
    }
}

pub type SharedMetrics = Arc<Mutex<MetricsState>>;
