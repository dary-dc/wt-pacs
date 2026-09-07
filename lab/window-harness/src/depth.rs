//! Dynamic ask-depth estimator — docs/lanes/L2-ask-policy.md, with its RTT input made explicit.
//!
//! `D = ceil(U × (1 + RTT / Tf))`, recomputed every 8 completed frames, adopted after two equal
//! evaluations, clamped to `[1, 16]`. `Tf` is the median frame size over the last 8 completions
//! divided by the throughput observed across them. `RTT` comes from the configured [`RttSource`].

use std::collections::VecDeque;
use std::time::Instant;

const WINDOW: usize = 8;
const U: f64 = 0.95;
const D_MIN: u32 = 1;
const D_MAX: u32 = 16;
/// Fewer clean samples than this and `RttSource::Clean` keeps the current `D`.
const MIN_CLEAN_SAMPLES: usize = 4;

/// Where the estimator's RTT comes from. This is the input the v1 and v2 campaigns could not
/// agree on: ask→first-byte measured behind a backed-up stream is the client's own queue, not
/// the path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum RttSource {
    /// A value measured outside the data stream (`--path-rtt-ms`). The transport's own RTT
    /// estimate would be the product equivalent; Chromium 141 exposes none to a page.
    Path,
    /// Median ask→first-byte over the window — the lane's original input.
    FirstByte,
    /// Ask→first-byte from asks issued into an empty pipe only. With fewer than
    /// `MIN_CLEAN_SAMPLES` of them the controller holds its current `D` instead of guessing.
    Clean,
}

impl RttSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Path => "path",
            Self::FirstByte => "first-byte",
            Self::Clean => "clean",
        }
    }
}

#[derive(Debug, Clone)]
struct CompletedSample {
    rtt_ms: f64,
    bytes: u64,
    completed_at: Instant,
    /// The ask went out with nothing else in flight, so ask→first-byte saw the path alone.
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
    rtt_source: RttSource,
    path_rtt_ms: Option<f64>,
    pub d_trajectory: Vec<u32>,
    pub d_min_observed: u32,
    pub d_max_observed: u32,
    /// The computed value alternated A/B/A/B across evaluations (lane stop rule).
    pub oscillating: bool,
    /// `D` sat at the clamp for more than half of the trajectory.
    pub saturated: bool,
    recent_computed: VecDeque<u32>,
}

impl DepthController {
    pub fn new(warm_fixed: u32, rtt_source: RttSource, path_rtt_ms: Option<f64>) -> Self {
        let d = warm_fixed.clamp(D_MIN, D_MAX);
        Self {
            current: d,
            completed: 0,
            eval_count: 0,
            samples: VecDeque::with_capacity(WINDOW),
            last_computed: None,
            rtt_source,
            path_rtt_ms,
            d_trajectory: Vec::new(),
            d_min_observed: d,
            d_max_observed: d,
            oscillating: false,
            saturated: false,
            recent_computed: VecDeque::with_capacity(8),
        }
    }

    pub fn current_d(&self) -> u32 {
        self.current
    }

    /// One frame finished. `rtt_ms` is ask→first-byte when the ask could be paired, `None`
    /// otherwise (the trajectory still advances). Returns the depth now in force.
    pub fn on_frame_completed(
        &mut self,
        rtt_ms: Option<f64>,
        bytes: u64,
        in_flight_at_ask: u32,
        completed_at: Instant,
    ) -> u32 {
        if let Some(rtt) = rtt_ms {
            self.samples.push_back(CompletedSample {
                rtt_ms: rtt,
                bytes,
                completed_at,
                clean_rtt: in_flight_at_ask == 0,
            });
            while self.samples.len() > WINDOW {
                self.samples.pop_front();
            }
        }
        self.completed = self.completed.saturating_add(1);
        self.d_trajectory.push(self.current);

        if self.completed >= WINDOW as u32 && self.completed.is_multiple_of(WINDOW as u32) {
            self.eval_count = self.eval_count.saturating_add(1);
            if let Some(computed) = self.compute_d() {
                self.track_computed(computed);
                self.maybe_adopt(computed);
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
        let at_max = self.d_trajectory.iter().filter(|&&d| d >= D_MAX).count();
        if at_max as f64 / self.d_trajectory.len() as f64 > 0.5 {
            self.saturated = true;
        }
    }

    fn rtt_estimate_ms(&self) -> Option<f64> {
        match self.rtt_source {
            RttSource::Path => self.path_rtt_ms,
            RttSource::FirstByte => median(self.samples.iter().map(|s| s.rtt_ms)),
            RttSource::Clean => {
                let clean: Vec<f64> = self
                    .samples
                    .iter()
                    .filter(|s| s.clean_rtt)
                    .map(|s| s.rtt_ms)
                    .collect();
                if clean.len() >= MIN_CLEAN_SAMPLES {
                    median(clean.iter().copied())
                } else {
                    None
                }
            }
        }
    }

    fn compute_d(&self) -> Option<u32> {
        if self.samples.len() < WINDOW {
            return None;
        }
        let rtt_ms = self.rtt_estimate_ms()?;
        let median_bytes = median(self.samples.iter().map(|s| s.bytes as f64))?;
        let t0 = self.samples.front()?.completed_at;
        let t1 = self.samples.back()?.completed_at;
        let dt_s = t1.duration_since(t0).as_secs_f64();
        if dt_s <= 0.0 || median_bytes <= 0.0 {
            return None;
        }
        // n completions span n-1 inter-arrival gaps.
        let n = self.samples.len() as f64;
        let total_bytes: f64 = self.samples.iter().map(|s| s.bytes as f64).sum();
        let throughput_bps = total_bytes * 8.0 * ((n - 1.0) / n) / dt_s;
        let tf_s = median_bytes * 8.0 / throughput_bps;
        Some(formula(rtt_ms / 1000.0, tf_s))
    }

    fn maybe_adopt(&mut self, computed: u32) {
        let repeated = self.last_computed == Some(computed);
        self.last_computed = Some(computed);
        if repeated && computed != self.current {
            self.current = computed;
            self.d_min_observed = self.d_min_observed.min(computed);
            self.d_max_observed = self.d_max_observed.max(computed);
        }
    }
}

fn formula(rtt_s: f64, tf_s: f64) -> u32 {
    if tf_s <= 0.0 {
        return D_MIN;
    }
    let raw = U * (1.0 + rtt_s / tf_s);
    (raw.ceil() as u32).clamp(D_MIN, D_MAX)
}

fn median(xs: impl Iterator<Item = f64>) -> Option<f64> {
    let mut v: Vec<f64> = xs.collect();
    if v.is_empty() {
        return None;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    Some(if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 })
}

/// Fixed depth for a cell from the window formula: named RTT (ms), mean frame bytes, link Mbps.
pub fn formula_depth(rtt_ms: u64, frame_bytes: u64, link_mbps: f64) -> u32 {
    let tf_s = (frame_bytes as f64 * 8.0) / (link_mbps * 1_000_000.0);
    formula(rtt_ms as f64 / 1000.0, tf_s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn formula_32k_10mbps() {
        assert_eq!(formula_depth(20, 32_000, 10.0), 2);
        assert_eq!(formula_depth(60, 32_000, 10.0), 4);
        assert_eq!(formula_depth(150, 32_000, 10.0), 7);
    }

    /// 32 KB frames landing every 25.6 ms is a 10 Mbps link; feed `n` of them.
    fn feed(c: &mut DepthController, n: u32, first_byte_ms: f64, in_flight_at_ask: u32) {
        let t0 = Instant::now();
        for i in 0..n {
            let at = t0 + Duration::from_micros(25_600 * u64::from(i));
            c.on_frame_completed(Some(first_byte_ms), 32_000, in_flight_at_ask, at);
        }
    }

    /// The interior-D check the v2 smoke never made: a 60 ms path on a 10 Mbps link must
    /// settle at the formula's 4, not at either clamp.
    #[test]
    fn path_source_settles_on_interior_d() {
        let mut c = DepthController::new(2, RttSource::Path, Some(60.0));
        feed(&mut c, 64, 400.0, 8);
        assert_eq!(c.current_d(), 4, "trajectory {:?}", c.d_trajectory);
        assert!(!c.saturated);
        assert!(!c.oscillating);
    }

    /// The failure the v1 rows showed: ask→first-byte behind a full stream is queue time, and
    /// the formula reads it as a long path.
    #[test]
    fn first_byte_source_ratchets_to_clamp_behind_a_queue() {
        let mut c = DepthController::new(2, RttSource::FirstByte, None);
        feed(&mut c, 64, 400.0, 8);
        assert_eq!(c.current_d(), D_MAX);
        assert!(c.saturated);
    }

    #[test]
    fn clean_source_holds_when_every_ask_queued() {
        let mut c = DepthController::new(2, RttSource::Clean, None);
        feed(&mut c, 64, 400.0, 8);
        assert_eq!(c.current_d(), 2, "no clean sample, no change; trajectory {:?}", c.d_trajectory);
    }

    #[test]
    fn clean_source_uses_clean_samples() {
        let mut c = DepthController::new(2, RttSource::Clean, None);
        feed(&mut c, 64, 60.0, 0);
        assert_eq!(c.current_d(), 4);
    }

    #[test]
    fn adoption_needs_two_equal_evaluations() {
        let mut c = DepthController::new(2, RttSource::Path, Some(60.0));
        feed(&mut c, 8, 0.0, 0);
        assert_eq!(c.current_d(), 2, "first evaluation computes 4 but must not adopt it");
        feed(&mut c, 8, 0.0, 0);
        assert_eq!(c.current_d(), 4);
    }
}
