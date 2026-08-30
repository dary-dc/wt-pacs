//! Dynamic ask-depth estimator — docs/lanes/L2-ask-policy.md
//!
//! Implement exactly as specified; do not vary the rule.

use std::collections::VecDeque;
use std::time::Instant;

const WINDOW: usize = 8;
const U: f64 = 0.95;
const D_MIN: u32 = 1;
const D_MAX: u32 = 16;

#[derive(Debug, Clone)]
struct CompletedSample {
    /// ask → first-byte, milliseconds.
    rtt_ms: f64,
    bytes: u64,
    completed_at: Instant,
}

/// Live depth controller for the dynamic arm.
#[derive(Debug)]
pub struct DepthController {
    /// Depth held through warm-up and until damping admits a change.
    current: u32,
    completed: u32,
    samples: VecDeque<CompletedSample>,
    /// Last computed D (before damping adopt). Two equal consecutive computes adopt.
    last_computed: Option<u32>,
    /// Per completed-frame `d_current` trajectory.
    pub d_trajectory: Vec<u32>,
    pub d_min_observed: u32,
    pub d_max_observed: u32,
    /// Set when D alternates every evaluation despite damping — stop the campaign.
    pub oscillating: bool,
    recent_adopts: VecDeque<u32>,
}

impl DepthController {
    pub fn new(warm_fixed: u32) -> Self {
        let d = warm_fixed.clamp(D_MIN, D_MAX);
        Self {
            current: d,
            completed: 0,
            samples: VecDeque::with_capacity(WINDOW),
            last_computed: None,
            d_trajectory: Vec::new(),
            d_min_observed: d,
            d_max_observed: d,
            oscillating: false,
            recent_adopts: VecDeque::with_capacity(6),
        }
    }

    pub fn current_d(&self) -> u32 {
        self.current
    }

    /// Record one completed frame. `rtt_ms` = first-byte − ask. Returns the D to use next.
    pub fn on_frame_completed(&mut self, rtt_ms: f64, bytes: u64) -> u32 {
        self.samples.push_back(CompletedSample {
            rtt_ms,
            bytes,
            completed_at: Instant::now(),
        });
        while self.samples.len() > WINDOW {
            self.samples.pop_front();
        }
        self.completed = self.completed.saturating_add(1);
        self.d_trajectory.push(self.current);
        self.d_min_observed = self.d_min_observed.min(self.current);
        self.d_max_observed = self.d_max_observed.max(self.current);

        // Warm-up: fixed D until 8 frames completed. Recompute every 8 thereafter.
        if self.completed >= WINDOW as u32 && self.completed % WINDOW as u32 == 0 {
            if let Some(computed) = self.compute_d() {
                self.maybe_adopt(computed);
            }
        }
        self.current
    }

    fn compute_d(&self) -> Option<u32> {
        if self.samples.len() < WINDOW {
            return None;
        }
        let rtts: Vec<f64> = self.samples.iter().map(|s| s.rtt_ms).collect();
        let rtt = median_f64(&rtts)?;
        let bytes: Vec<f64> = self.samples.iter().map(|s| s.bytes as f64).collect();
        let median_bytes = median_f64(&bytes)?;
        let t0 = self.samples.front()?.completed_at;
        let t1 = self.samples.back()?.completed_at;
        let dt_s = t1.duration_since(t0).as_secs_f64();
        if dt_s <= 0.0 || median_bytes <= 0.0 {
            return None;
        }
        let total_bytes: f64 = self.samples.iter().map(|s| s.bytes as f64).sum();
        let throughput_bps = (total_bytes * 8.0) / dt_s;
        if throughput_bps <= 0.0 {
            return None;
        }
        // Tf = median frame bytes ÷ observed throughput (seconds).
        let tf_s = (median_bytes * 8.0) / throughput_bps;
        if tf_s <= 0.0 {
            return None;
        }
        let rtt_s = rtt / 1000.0;
        let raw = U * (1.0 + rtt_s / tf_s);
        let d = raw.ceil() as u32;
        Some(d.clamp(D_MIN, D_MAX))
    }

    fn maybe_adopt(&mut self, computed: u32) {
        // Damping: adopt only if differs by ≥ 1 from current AND same value on 2 consecutive evals.
        if computed == self.current {
            self.last_computed = Some(computed);
            return;
        }
        match self.last_computed {
            Some(prev) if prev == computed => {
                let old = self.current;
                self.current = computed;
                self.last_computed = Some(computed);
                self.d_min_observed = self.d_min_observed.min(self.current);
                self.d_max_observed = self.d_max_observed.max(self.current);
                self.recent_adopts.push_back(computed);
                while self.recent_adopts.len() > 6 {
                    self.recent_adopts.pop_front();
                }
                // Oscillation: A B A B despite damping (adopted every eval alternating).
                if self.recent_adopts.len() >= 4 {
                    let v: Vec<u32> = self.recent_adopts.iter().copied().collect();
                    let n = v.len();
                    if v[n - 1] == v[n - 3]
                        && v[n - 2] == v[n - 4]
                        && v[n - 1] != v[n - 2]
                        && old != computed
                    {
                        self.oscillating = true;
                    }
                }
            }
            _ => {
                self.last_computed = Some(computed);
            }
        }
    }
}

fn median_f64(xs: &[f64]) -> Option<f64> {
    if xs.is_empty() {
        return None;
    }
    let mut v = xs.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 {
        Some(v[n / 2])
    } else {
        Some((v[n / 2 - 1] + v[n / 2]) / 2.0)
    }
}

/// Fixed depth for a cell from the window formula, given named RTT (ms), mean frame bytes, link Mbps.
pub fn formula_depth(rtt_ms: u64, frame_bytes: u64, link_mbps: f64) -> u32 {
    let tf_s = (frame_bytes as f64 * 8.0) / (link_mbps * 1_000_000.0);
    if tf_s <= 0.0 {
        return D_MIN;
    }
    let raw = U * (1.0 + (rtt_ms as f64 / 1000.0) / tf_s);
    (raw.ceil() as u32).clamp(D_MIN, D_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formula_32k_10mbps() {
        // Tf = 32000*8/10e6 = 25.6 ms
        assert_eq!(formula_depth(20, 32_000, 10.0), 2);
        assert_eq!(formula_depth(60, 32_000, 10.0), 4);
        assert_eq!(formula_depth(150, 32_000, 10.0), 7);
    }

    #[test]
    fn warm_up_holds_fixed() {
        let mut c = DepthController::new(4);
        for _ in 0..7 {
            assert_eq!(c.on_frame_completed(60.0, 32_000), 4);
        }
        assert_eq!(c.d_trajectory.len(), 7);
        assert_eq!(c.current_d(), 4);
    }

    #[test]
    fn damping_needs_two_consecutive() {
        let mut c = DepthController::new(4);
        // Force samples that compute a different D by injecting via maybe_adopt path.
        // After 8 completions we recompute; with tiny RTT and huge throughput D→1.
        for _ in 0..8 {
            c.on_frame_completed(1.0, 32_000);
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        // First compute of a new value should not adopt yet.
        let after_first = c.current_d();
        // If compute produced something other than 4, still at 4 until second agree.
        assert_eq!(after_first, 4);
        for _ in 0..8 {
            c.on_frame_completed(1.0, 32_000);
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        // After two consecutive identical computes, may have adopted.
        assert!(!c.oscillating);
    }
}
