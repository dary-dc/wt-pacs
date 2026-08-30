//! Dynamic ask-depth estimator — docs/lanes/L2-ask-policy.md
//!
//! L2 v2: path RTT for the BDP formula when set (`--path-rtt-ms`); ask→first-byte
//! samples feed Tf/throughput only when `in_flight_at_ask <= 1` (not HOL-contaminated).

use std::collections::VecDeque;
use std::time::Instant;

const WINDOW: usize = 8;
const U: f64 = 0.95;
const D_MIN: u32 = 1;
const D_MAX: u32 = 16;

#[derive(Debug, Clone)]
struct CompletedSample {
    rtt_ms: f64,
    bytes: u64,
    completed_at: Instant,
    /// True when ask→first-byte is usable as a path probe (not behind queue).
    clean_rtt: bool,
}

/// Live depth controller for the dynamic arm.
#[derive(Debug)]
pub struct DepthController {
    current: u32,
    completed: u32,
    eval_count: u32,
    samples: VecDeque<CompletedSample>,
    last_computed: Option<u32>,
    pub d_trajectory: Vec<u32>,
    pub d_min_observed: u32,
    pub d_max_observed: u32,
    pub oscillating: bool,
    /// D pinned at clamp for >50% of trajectory after warm-up.
    pub saturated: bool,
    recent_adopts: VecDeque<(u32, u32)>,
    /// Measured/configured path RTT (ms) for the BDP formula; overrides median when set.
    path_rtt_ms: Option<f64>,
    recent_computed: VecDeque<u32>,
}

impl DepthController {
    pub fn new(warm_fixed: u32) -> Self {
        Self::with_path_rtt(warm_fixed, None)
    }

    pub fn with_path_rtt(warm_fixed: u32, path_rtt_ms: Option<u64>) -> Self {
        let d = warm_fixed.clamp(D_MIN, D_MAX);
        Self {
            current: d,
            completed: 0,
            eval_count: 0,
            samples: VecDeque::with_capacity(WINDOW),
            last_computed: None,
            d_trajectory: Vec::new(),
            d_min_observed: d,
            d_max_observed: d,
            oscillating: false,
            saturated: false,
            recent_adopts: VecDeque::with_capacity(6),
            path_rtt_ms: path_rtt_ms.map(|v| v as f64),
            recent_computed: VecDeque::with_capacity(8),
        }
    }

    pub fn current_d(&self) -> u32 {
        self.current
    }

    /// `rtt_ms` = None when ask pairing missing; trajectory still advances.
    pub fn on_frame_completed(
        &mut self,
        rtt_ms: Option<f64>,
        bytes: u64,
        in_flight_at_ask: u32,
    ) -> u32 {
        if let Some(rtt) = rtt_ms {
            let clean_rtt = in_flight_at_ask <= 1;
            self.samples.push_back(CompletedSample {
                rtt_ms: rtt,
                bytes,
                completed_at: Instant::now(),
                clean_rtt,
            });
            while self.samples.len() > WINDOW {
                self.samples.pop_front();
            }
        }
        self.completed = self.completed.saturating_add(1);
        self.d_trajectory.push(self.current);
        self.d_min_observed = self.d_min_observed.min(self.current);
        self.d_max_observed = self.d_max_observed.max(self.current);

        if self.completed >= WINDOW as u32 && self.completed % WINDOW as u32 == 0 {
            self.eval_count = self.eval_count.saturating_add(1);
            if let Some(computed) = self.compute_d() {
                self.track_computed(computed);
                self.maybe_adopt(computed, self.eval_count);
            }
        }
        self.check_saturated();
        self.current
    }

    fn track_computed(&mut self, computed: u32) {
        self.recent_computed.push_back(computed);
        while self.recent_computed.len() > 8 {
            self.recent_computed.pop_front();
        }
        // A/B/A/B on consecutive *computed* values (lane stop rule intent).
        if self.recent_computed.len() >= 4 {
            let v: Vec<u32> = self.recent_computed.iter().copied().collect();
            let n = v.len();
            if v[n - 4] == v[n - 2] && v[n - 3] == v[n - 1] && v[n - 4] != v[n - 3] {
                self.oscillating = true;
            }
        }
    }

    fn check_saturated(&mut self) {
        if self.d_trajectory.len() < WINDOW {
            return;
        }
        let at_max = self
            .d_trajectory
            .iter()
            .filter(|&&d| d >= D_MAX)
            .count();
        if at_max as f64 / self.d_trajectory.len() as f64 > 0.5 {
            self.saturated = true;
        }
    }

    fn compute_d(&self) -> Option<u32> {
        if self.samples.len() < WINDOW {
            return None;
        }
        let n = self.samples.len();
        let rtt = if let Some(path) = self.path_rtt_ms {
            path
        } else {
            let clean: Vec<f64> = self
                .samples
                .iter()
                .filter(|s| s.clean_rtt)
                .map(|s| s.rtt_ms)
                .collect();
            if clean.len() >= 4 {
                median_f64(&clean)?
            } else {
                median_f64(&self.samples.iter().map(|s| s.rtt_ms).collect::<Vec<_>>())?
            }
        };
        let bytes: Vec<f64> = self.samples.iter().map(|s| s.bytes as f64).collect();
        let median_bytes = median_f64(&bytes)?;
        let t0 = self.samples.front()?.completed_at;
        let t1 = self.samples.back()?.completed_at;
        let dt_s = t1.duration_since(t0).as_secs_f64();
        if dt_s <= 0.0 || median_bytes <= 0.0 {
            return None;
        }
        let total_bytes: f64 = self.samples.iter().map(|s| s.bytes as f64).sum();
        let span_factor = if n > 1 {
            (n - 1) as f64 / n as f64
        } else {
            1.0
        };
        let throughput_bps = (total_bytes * 8.0) * span_factor / dt_s;
        if throughput_bps <= 0.0 {
            return None;
        }
        let tf_s = (median_bytes * 8.0) / throughput_bps;
        if tf_s <= 0.0 {
            return None;
        }
        let rtt_s = rtt / 1000.0;
        let raw = U * (1.0 + rtt_s / tf_s);
        Some((raw.ceil() as u32).clamp(D_MIN, D_MAX))
    }

    fn maybe_adopt(&mut self, computed: u32, eval_index: u32) {
        if computed == self.current {
            self.last_computed = Some(computed);
            return;
        }
        match self.last_computed {
            Some(prev) if prev == computed => {
                self.current = computed;
                self.last_computed = Some(computed);
                self.d_min_observed = self.d_min_observed.min(self.current);
                self.d_max_observed = self.d_max_observed.max(self.current);
                self.recent_adopts.push_back((eval_index, computed));
                while self.recent_adopts.len() > 6 {
                    self.recent_adopts.pop_front();
                }
                if self.recent_adopts.len() >= 4 {
                    let v: Vec<(u32, u32)> = self.recent_adopts.iter().copied().collect();
                    let n = v.len();
                    let (e0, a) = v[n - 4];
                    let (e1, b) = v[n - 3];
                    let (e2, a2) = v[n - 2];
                    let (e3, b2) = v[n - 1];
                    if e1 == e0 + 1
                        && e2 == e1 + 1
                        && e3 == e2 + 1
                        && a == a2
                        && b == b2
                        && a != b
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
        assert_eq!(formula_depth(20, 32_000, 10.0), 2);
        assert_eq!(formula_depth(60, 32_000, 10.0), 4);
        assert_eq!(formula_depth(150, 32_000, 10.0), 7);
    }

    #[test]
    fn path_rtt_zero_keeps_d_shallow() {
        let mut c = DepthController::with_path_rtt(2, Some(0));
        for _ in 0..64 {
            c.on_frame_completed(Some(400.0), 32_000, 8);
        }
        assert!(
            c.current_d() <= 2,
            "path_rtt=0 must not ratchet to clamp, got {}",
            c.current_d()
        );
        assert!(!c.saturated);
    }
}
