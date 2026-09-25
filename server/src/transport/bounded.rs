//! quinn's BBR with its window held to `gain` × its own path estimate: BBRv1 keeps two BDPs in
//! flight and the bottleneck queues or drops the second. Over the public `Controller` trait, as
//! `restart.rs` is. What it measured: `docs/transport/transport-conclusions.md` §1, BB2.

use quinn_proto::RttEstimator;
use std::any::Any;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use wtransport::quinn::congestion::{BbrConfig, Controller, ControllerFactory, ControllerMetrics};

/// BBR's own bandwidth filter length, in round trips.
const ROUNDS: usize = 10;
/// BBR's floor on the window, in packets.
const MIN_PACKETS: u64 = 4;

pub struct BoundedBbr {
    inner: Box<dyn Controller>,
    gain: f64,
    mtu: u16,
    min_rtt: Duration,
    round_start: Option<Instant>,
    round_bytes: u64,
    /// Bytes per second delivered in each of the last `ROUNDS` round trips that were not app-limited.
    rates: VecDeque<f64>,
}

impl BoundedBbr {
    fn new(bbr: Arc<BbrConfig>, gain: f64, now: Instant, mtu: u16) -> Self {
        Self {
            inner: bbr.build(now, mtu),
            gain,
            mtu,
            min_rtt: Duration::ZERO,
            round_start: None,
            round_bytes: 0,
            rates: VecDeque::with_capacity(ROUNDS),
        }
    }

    /// One acknowledgement. A round closes after one minimum round trip, and yields a rate sample
    /// unless the sender was short of data. `RttEstimator` cannot be built outside quinn, so this
    /// is the seam the estimate is exercised through.
    fn note_ack(&mut self, now: Instant, bytes: u64, app_limited: bool, min_rtt: Duration) {
        self.min_rtt = min_rtt;
        let start = *self.round_start.get_or_insert(now);
        self.round_bytes += bytes;
        let elapsed = now.duration_since(start);
        if min_rtt.is_zero() || elapsed < min_rtt {
            return;
        }
        if !app_limited {
            if self.rates.len() == ROUNDS {
                self.rates.pop_front();
            }
            self.rates.push_back(self.round_bytes as f64 / elapsed.as_secs_f64());
        }
        self.round_start = Some(now);
        self.round_bytes = 0;
    }

    /// `gain` × the best rate of the last rounds × the minimum round trip; none until a round closes.
    fn cap(&self) -> Option<u64> {
        let rate = self.rates.iter().copied().fold(None, |m: Option<f64>, r| Some(m.map_or(r, |m| m.max(r))))?;
        let bdp = rate * self.min_rtt.as_secs_f64();
        Some(((self.gain * bdp) as u64).max(MIN_PACKETS * u64::from(self.mtu)))
    }
}

impl Controller for BoundedBbr {
    fn on_sent(&mut self, now: Instant, bytes: u64, last_packet_number: u64) {
        self.inner.on_sent(now, bytes, last_packet_number);
    }

    fn on_ack(&mut self, now: Instant, sent: Instant, bytes: u64, app_limited: bool, rtt: &RttEstimator) {
        self.note_ack(now, bytes, app_limited, rtt.min());
        self.inner.on_ack(now, sent, bytes, app_limited, rtt);
    }

    fn on_end_acks(&mut self, now: Instant, in_flight: u64, app_limited: bool, largest: Option<u64>) {
        self.inner.on_end_acks(now, in_flight, app_limited, largest);
    }

    fn on_congestion_event(&mut self, now: Instant, sent: Instant, persistent: bool, lost_bytes: u64) {
        self.inner.on_congestion_event(now, sent, persistent, lost_bytes);
    }

    fn on_mtu_update(&mut self, new_mtu: u16) {
        self.mtu = new_mtu;
        self.inner.on_mtu_update(new_mtu);
    }

    fn window(&self) -> u64 {
        let window = self.inner.window();
        self.cap().map_or(window, |cap| window.min(cap))
    }

    fn metrics(&self) -> ControllerMetrics {
        let mut m = self.inner.metrics();
        m.congestion_window = self.window();
        m
    }

    fn clone_box(&self) -> Box<dyn Controller> {
        Box::new(Self {
            inner: self.inner.clone_box(),
            gain: self.gain,
            mtu: self.mtu,
            min_rtt: self.min_rtt,
            round_start: self.round_start,
            round_bytes: self.round_bytes,
            rates: self.rates.clone(),
        })
    }

    fn initial_window(&self) -> u64 {
        self.inner.initial_window()
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any> {
        self
    }
}

pub struct BoundedBbrConfig {
    bbr: Arc<BbrConfig>,
    gain: f64,
}

impl BoundedBbrConfig {
    pub fn new(gain: f64, initial_window: Option<u64>) -> Self {
        let mut bbr = BbrConfig::default();
        if let Some(v) = initial_window {
            bbr.initial_window(v);
        }
        Self { bbr: Arc::new(bbr), gain }
    }
}

impl ControllerFactory for BoundedBbrConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(BoundedBbr::new(Arc::clone(&self.bbr), self.gain, now, current_mtu))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MTU: u16 = 1200;
    const RTT: Duration = Duration::from_millis(80);

    /// `rounds` round trips at `rate` bytes a second, acknowledged in ten pieces each.
    fn feed(b: &mut BoundedBbr, start: Instant, rounds: u32, rate: f64, app_limited: bool) -> Instant {
        let piece = RTT / 10;
        let mut now = start;
        for _ in 0..rounds * 10 {
            now += piece;
            b.note_ack(now, (rate * piece.as_secs_f64()) as u64, app_limited, RTT);
        }
        now
    }

    fn bounded(gain: f64) -> BoundedBbr {
        BoundedBbr::new(Arc::new(BbrConfig::default()), gain, Instant::now(), MTU)
    }

    /// With nothing measured the window is BBR's own; once a round closes it is `gain` × rate ×
    /// minimum round trip — 2.5 MB/s over 80 ms is a 200 KB path.
    #[test]
    fn the_cap_is_gain_times_the_measured_path() {
        let mut b = bounded(1.25);
        assert_eq!(b.cap(), None, "a cap before any round closed");
        assert_eq!(b.window(), b.inner.window(), "the window is not BBR's own before a cap");
        feed(&mut b, Instant::now(), 3, 2_500_000.0, false);
        let cap = b.cap().expect("a cap after three rounds") as f64;
        assert!((cap / (1.25 * 200_000.0) - 1.0).abs() < 0.12, "cap {cap} is not 1.25 × 200 KB");
    }

    /// A path narrower than BBR's own window holds the window to it: 100 KB/s over 80 ms is 8 KB,
    /// under the initial window BBR would otherwise keep.
    #[test]
    fn a_cap_under_bbrs_window_is_the_window() {
        let mut b = bounded(1.0);
        feed(&mut b, Instant::now(), 2, 100_000.0, false);
        let cap = b.cap().unwrap();
        assert!(cap < b.inner.window(), "the test path is not narrower than BBR's window");
        assert_eq!(b.window(), cap, "the window is not held to the cap");
    }

    /// The filter keeps the best rate of the last rounds, so one slow round does not shrink the
    /// window, and a round the sender left short of data is no sample at all.
    #[test]
    fn a_slow_or_app_limited_round_does_not_shrink_it() {
        let mut b = bounded(1.0);
        let now = feed(&mut b, Instant::now(), 3, 2_500_000.0, false);
        let before = b.cap().unwrap();
        let now = feed(&mut b, now, ROUNDS as u32 + 1, 500_000.0, true);
        assert_eq!(b.cap().unwrap(), before, "app-limited rounds moved the cap");
        feed(&mut b, now, 1, 1_000_000.0, false);
        assert_eq!(b.cap().unwrap(), before, "one slow round shrank the cap");
    }

    /// A path too slow to fill four packets still gets four: BBR's own floor.
    #[test]
    fn the_cap_never_goes_under_four_packets() {
        let mut b = bounded(1.0);
        feed(&mut b, Instant::now(), 2, 1_000.0, false);
        assert_eq!(b.cap(), Some(MIN_PACKETS * MTU as u64));
    }
}
