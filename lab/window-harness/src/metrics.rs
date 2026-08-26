use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Instant;

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
    /// Simulated RTT (ms): RTT/2 before ask send, RTT/2 after uni read before cache.
    pub rtt_ms: u64,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct HarnessMetrics {
    pub trace: String,
    pub mode: String,
    pub read_bps: u64,
    pub depth: u32,
    pub arm_label: String,
    pub wanted_frame: u32,
    pub asks_sent: u32,
    pub recovered_ms: f64,
    /// Mean time from reader-wants to displayable; cache hits count as 0.
    pub mean_wait_ms: f64,
    /// p95 of the same wait samples.
    pub p95_wait_ms: f64,
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
    /// Simulated RTT (ms): RTT/2 before ask send, RTT/2 after uni read before cache.
    pub rtt_ms: u64,
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
            arm_label: arm_label.to_string(),
            wanted_frame: self.wanted_frame,
            asks_sent,
            recovered_ms,
            mean_wait_ms,
            p95_wait_ms,
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
