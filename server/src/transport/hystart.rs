//! RFC 9406's slow-start exit, over any quinn controller, through the public `Controller` trait
//! alone — no fork, no patch. Why it exists and what it measured:
//! `docs/transport/transport-conclusions.md` §3, the slow-start exit.

use std::any::Any;
use std::sync::Arc;
use std::time::{Duration, Instant};
use wtransport::quinn::congestion::{
    Controller, ControllerFactory, ControllerMetrics, CubicConfig,
};
use quinn_proto::RttEstimator;

/// RFC 9406 §4.2.
const N_RTT_SAMPLE: u32 = 8;
const MIN_RTT_THRESH: Duration = Duration::from_millis(4);
const MAX_RTT_THRESH: Duration = Duration::from_millis(16);

/// Watches the per-round minimum RTT and, when it rises, stops the inner controller growing
/// exponentially: the window is capped where slow start left it and opens one datagram per round
/// trip after that. The inner controller is never told anything untrue, so a real congestion
/// event still does exactly what it did before, and from then on this is a pass-through.
pub struct HyStart {
    inner: Box<dyn Controller>,
    mtu: u64,
    /// Highest packet number sent; the round ends when an ack covers it.
    last_sent: u64,
    round_ends_at: u64,
    current_min: Option<Duration>,
    last_min: Option<Duration>,
    samples: u32,
    /// `Some` once slow start has been left behind; `None` again after a congestion event.
    cap: Option<u64>,
    done: bool,
}

impl HyStart {
    fn new(inner: Box<dyn Controller>, mtu: u16) -> Self {
        Self {
            inner,
            mtu: u64::from(mtu),
            last_sent: 0,
            round_ends_at: 0,
            current_min: None,
            last_min: None,
            samples: 0,
            cap: None,
            done: false,
        }
    }

    /// One RTT sample, from the ack path or from a test. `RttEstimator` cannot be built outside
    /// quinn, so this is the seam the detector is exercised through.
    fn observe(&mut self, seen: Duration) {
        if self.done || self.cap.is_some() {
            return;
        }
        self.current_min = Some(self.current_min.map_or(seen, |m| m.min(seen)));
        self.samples += 1;
    }

    fn rtt_has_risen(&self) -> bool {
        let (Some(current), Some(last)) = (self.current_min, self.last_min) else {
            return false;
        };
        current >= last + (last / 8).clamp(MIN_RTT_THRESH, MAX_RTT_THRESH)
    }
}

impl Controller for HyStart {
    fn on_sent(&mut self, now: Instant, bytes: u64, last_packet_number: u64) {
        self.last_sent = last_packet_number;
        self.inner.on_sent(now, bytes, last_packet_number);
    }

    fn on_ack(
        &mut self,
        now: Instant,
        sent: Instant,
        bytes: u64,
        app_limited: bool,
        rtt: &RttEstimator,
    ) {
        // quinn does not expose the per-packet sample, so this reads the smoothed estimate:
        // the same signal, later than RFC 9406 would see it.
        self.observe(rtt.get());
        self.inner.on_ack(now, sent, bytes, app_limited, rtt);
    }

    fn on_end_acks(
        &mut self,
        now: Instant,
        in_flight: u64,
        app_limited: bool,
        largest_packet_num_acked: Option<u64>,
    ) {
        self.inner
            .on_end_acks(now, in_flight, app_limited, largest_packet_num_acked);
        if self.done || !largest_packet_num_acked.is_some_and(|n| n >= self.round_ends_at) {
            return;
        }
        self.round_ends_at = self.last_sent;
        match self.cap {
            Some(cap) => self.cap = Some(cap + self.mtu),
            None if self.samples >= N_RTT_SAMPLE && self.rtt_has_risen() => {
                self.cap = Some(self.inner.window());
            }
            None => {
                self.last_min = self.current_min;
                self.current_min = None;
                self.samples = 0;
            }
        }
    }

    fn on_congestion_event(
        &mut self,
        now: Instant,
        sent: Instant,
        is_persistent_congestion: bool,
        lost_bytes: u64,
    ) {
        self.done = true;
        self.cap = None;
        self.inner
            .on_congestion_event(now, sent, is_persistent_congestion, lost_bytes);
    }

    fn on_mtu_update(&mut self, new_mtu: u16) {
        self.mtu = u64::from(new_mtu);
        self.inner.on_mtu_update(new_mtu);
    }

    fn window(&self) -> u64 {
        match self.cap {
            Some(cap) => self.inner.window().min(cap),
            None => self.inner.window(),
        }
    }

    fn metrics(&self) -> ControllerMetrics {
        let mut m = self.inner.metrics();
        m.congestion_window = self.window();
        m
    }

    fn clone_box(&self) -> Box<dyn Controller> {
        Box::new(Self {
            inner: self.inner.clone_box(),
            ..*self
        })
    }

    fn initial_window(&self) -> u64 {
        self.inner.initial_window()
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any> {
        self
    }
}

#[derive(Default)]
pub struct HyStartConfig {
    cubic: Arc<CubicConfig>,
}

impl HyStartConfig {
    pub fn new(initial_window: Option<u64>) -> Self {
        let mut cubic = CubicConfig::default();
        if let Some(v) = initial_window {
            cubic.initial_window(v);
        }
        Self { cubic: Arc::new(cubic) }
    }
}

impl ControllerFactory for HyStartConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(HyStart::new(
            Arc::clone(&self.cubic).build(now, current_mtu),
            current_mtu,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MTU: u16 = 1200;

    fn hystart() -> HyStart {
        HyStart::new(Arc::new(CubicConfig::default()).build(Instant::now(), MTU), MTU)
    }

    /// Drives `rounds` rounds of `N_RTT_SAMPLE` samples each, at a steady RTT then a risen one.
    fn rounds(h: &mut HyStart, rounds: u64, rtt: Duration) {
        let now = Instant::now();
        for round in 0..rounds {
            h.last_sent = (round + 1) * 100;
            for _ in 0..N_RTT_SAMPLE {
                h.observe(rtt);
            }
            h.on_end_acks(now, 0, false, Some(h.round_ends_at));
        }
    }

    /// A steady RTT never caps: the wrapper costs a controller nothing until it has evidence.
    #[test]
    fn a_steady_rtt_never_caps() {
        let mut h = hystart();
        rounds(&mut h, 8, Duration::from_millis(40));
        assert_eq!(h.cap, None);
        assert_eq!(h.window(), h.inner.window());
    }

    /// A rise of an eighth over a round, held for a round's worth of samples, leaves slow start
    /// — and it caps where the controller had got to, not below it.
    #[test]
    fn a_risen_rtt_caps_at_the_window_it_reached() {
        let mut h = hystart();
        rounds(&mut h, 2, Duration::from_millis(40));
        let before = h.inner.window();
        rounds(&mut h, 1, Duration::from_millis(60));
        assert_eq!(h.cap, Some(before), "capped where slow start left it");
        assert_eq!(h.window(), before.min(h.inner.window()));
    }

    /// Fewer than `N_RTT_SAMPLE` samples in a round is not evidence, however far the RTT moved.
    #[test]
    fn a_short_round_is_not_evidence() {
        let mut h = hystart();
        rounds(&mut h, 2, Duration::from_millis(40));
        let now = Instant::now();
        h.last_sent = 900;
        for _ in 0..(N_RTT_SAMPLE - 1) {
            h.observe(Duration::from_millis(400));
        }
        h.on_end_acks(now, 0, false, Some(h.round_ends_at));
        assert_eq!(h.cap, None);
    }

    /// The window a capped controller reports never exceeds the cap, and opens one datagram per
    /// round after it — that is the whole of the slow-start exit.
    #[test]
    fn a_cap_opens_one_datagram_per_round() {
        let mut h = hystart();
        h.cap = Some(10_000);
        let capped = h.window();
        assert_eq!(capped, 10_000.min(h.inner.window()));
        let now = Instant::now();
        h.last_sent = 500;
        h.on_end_acks(now, 0, false, Some(500));
        assert_eq!(h.cap, Some(10_000 + u64::from(MTU)));
    }

    /// A congestion event hands control back for good: the cap goes and the detector stops, so
    /// nothing this wrapper does can outlive the slow start it was watching.
    #[test]
    fn a_congestion_event_makes_it_a_pass_through() {
        let mut h = hystart();
        h.cap = Some(10_000);
        let now = Instant::now();
        h.on_congestion_event(now, now, false, 1200);
        assert!(h.done && h.cap.is_none());
        assert_eq!(h.window(), h.inner.window());
    }

    /// The RFC's threshold: an eighth of the last round's minimum, clamped to 4..=16 ms.
    #[test]
    fn the_threshold_is_an_eighth_clamped() {
        let mut h = hystart();
        h.last_min = Some(Duration::from_millis(80));
        h.current_min = Some(Duration::from_millis(89));
        assert!(!h.rtt_has_risen(), "9 ms is under an eighth of 80 ms");
        h.current_min = Some(Duration::from_millis(90));
        assert!(h.rtt_has_risen());
        // An eighth of 8 ms is 1 ms, so the 4 ms floor decides instead.
        h.last_min = Some(Duration::from_millis(8));
        h.current_min = Some(Duration::from_millis(11));
        assert!(!h.rtt_has_risen());
        h.current_min = Some(Duration::from_millis(12));
        assert!(h.rtt_has_risen());
    }
}
