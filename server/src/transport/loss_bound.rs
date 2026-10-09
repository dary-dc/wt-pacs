//! quinn's BBR under BBRv3's loss bound: a round losing over 2 % caps the window at 0.85 of
//! `inflight_hi`, which clean rounds regrow 1, 2, 4… packets at a time. Over the public
//! `Controller` trait, as `restart.rs` is. `docs/transport/transport-conclusions.md` §1, BB3.

use quinn_proto::RttEstimator;
use std::any::Any;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use wtransport::quinn::congestion::{BbrConfig, Controller, ControllerFactory, ControllerMetrics};

const LOSS_THRESH: f64 = 0.02;
/// `inflight_hi`'s floor, in BDPs.
const BETA: f64 = 0.7;
/// The window's share of `inflight_hi` between probes (v3's CRUISE).
const HEADROOM: f64 = 0.85;
/// The bandwidth filter's length, in rounds.
const ROUNDS: usize = 10;
const MIN_PACKETS: u64 = 4;

pub struct LossBound {
    inner: Box<dyn Controller>,
    mtu: u16,
    min_rtt: Duration,
    in_flight: u64,
    /// A round ends with the first acknowledgement of a packet sent after it began.
    round_start: Option<Instant>,
    round_delivered: u64,
    round_lost: u64,
    round_app_limited: bool,
    /// Bytes per second delivered in each of the last `ROUNDS` rounds that were not app-limited.
    rates: VecDeque<f64>,
    inflight_hi: Option<u64>,
    /// Packets the next clean round adds to `inflight_hi`.
    growth: u64,
}

impl LossBound {
    fn new(bbr: Arc<BbrConfig>, now: Instant, mtu: u16) -> Self {
        Self {
            inner: bbr.build(now, mtu),
            mtu,
            min_rtt: Duration::ZERO,
            in_flight: 0,
            round_start: None,
            round_delivered: 0,
            round_lost: 0,
            round_app_limited: false,
            rates: VecDeque::with_capacity(ROUNDS),
            inflight_hi: None,
            growth: 1,
        }
    }

    /// `RttEstimator` cannot be built outside quinn, so this is the seam the rounds are exercised through.
    fn note_ack(&mut self, now: Instant, sent: Instant, bytes: u64, app_limited: bool, min_rtt: Duration) {
        self.min_rtt = min_rtt;
        self.round_delivered += bytes;
        self.round_app_limited |= app_limited;
        match self.round_start {
            None => self.round_start = Some(now),
            Some(start) if sent >= start => self.end_round(now, start),
            Some(_) => {}
        }
    }

    fn end_round(&mut self, now: Instant, start: Instant) {
        let elapsed = now.duration_since(start).as_secs_f64();
        if !self.round_app_limited && elapsed > 0.0 {
            if self.rates.len() == ROUNDS {
                self.rates.pop_front();
            }
            self.rates.push_back(self.round_delivered as f64 / elapsed);
        }
        let total = self.round_delivered + self.round_lost;
        if total > 0 && self.round_lost as f64 > LOSS_THRESH * total as f64 {
            let floor = (BETA * self.bdp()) as u64;
            self.inflight_hi = Some(self.in_flight.max(floor));
            self.growth = 1;
        } else if let Some(hi) = self.inflight_hi {
            self.inflight_hi = Some(hi.saturating_add(self.growth * u64::from(self.mtu)));
            self.growth = self.growth.saturating_mul(2);
        }
        self.round_start = Some(now);
        self.round_delivered = 0;
        self.round_lost = 0;
        self.round_app_limited = false;
    }

    /// The best rate of the last rounds × the minimum round trip, in bytes; 0 before a round closes.
    fn bdp(&self) -> f64 {
        self.rates.iter().copied().fold(0.0, f64::max) * self.min_rtt.as_secs_f64()
    }

    fn cap(&self) -> Option<u64> {
        let hi = self.inflight_hi?;
        Some(((HEADROOM * hi as f64) as u64).max(MIN_PACKETS * u64::from(self.mtu)))
    }
}

impl Controller for LossBound {
    fn on_sent(&mut self, now: Instant, bytes: u64, last_packet_number: u64) {
        self.inner.on_sent(now, bytes, last_packet_number);
    }

    fn on_ack(&mut self, now: Instant, sent: Instant, bytes: u64, app_limited: bool, rtt: &RttEstimator) {
        self.note_ack(now, sent, bytes, app_limited, rtt.min());
        self.inner.on_ack(now, sent, bytes, app_limited, rtt);
    }

    fn on_end_acks(&mut self, now: Instant, in_flight: u64, app_limited: bool, largest: Option<u64>) {
        self.in_flight = in_flight;
        self.inner.on_end_acks(now, in_flight, app_limited, largest);
    }

    fn on_congestion_event(&mut self, now: Instant, sent: Instant, persistent: bool, lost_bytes: u64) {
        self.round_lost += lost_bytes;
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
            mtu: self.mtu,
            min_rtt: self.min_rtt,
            in_flight: self.in_flight,
            round_start: self.round_start,
            round_delivered: self.round_delivered,
            round_lost: self.round_lost,
            round_app_limited: self.round_app_limited,
            rates: self.rates.clone(),
            inflight_hi: self.inflight_hi,
            growth: self.growth,
        })
    }

    fn initial_window(&self) -> u64 {
        self.inner.initial_window()
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any> {
        self
    }
}

pub struct LossBoundConfig {
    bbr: Arc<BbrConfig>,
}

impl LossBoundConfig {
    pub fn new(initial_window: Option<u64>) -> Self {
        let mut bbr = BbrConfig::default();
        if let Some(v) = initial_window {
            bbr.initial_window(v);
        }
        Self { bbr: Arc::new(bbr) }
    }
}

impl ControllerFactory for LossBoundConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(LossBound::new(Arc::clone(&self.bbr), now, current_mtu))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MTU: u16 = 1200;
    const PKT: u64 = MTU as u64;
    const RTT: Duration = Duration::from_millis(80);

    fn bound() -> LossBound {
        LossBound::new(Arc::new(BbrConfig::default()), Instant::now(), MTU)
    }

    /// One round trip from `start`: `delivered` packets acknowledged in ten pieces, `lost` declared
    /// lost, `in_flight` left at its end. The first piece acknowledges a packet sent before the
    /// round, the last one sent at its start, which closes it.
    fn round(b: &mut LossBound, start: Instant, delivered: u64, lost: u64, in_flight: u64) -> Instant {
        b.round_start.get_or_insert(start);
        b.in_flight = in_flight * PKT;
        b.on_congestion_event(start, start, false, lost * PKT);
        let piece = RTT / 10;
        for i in 1..=10u32 {
            let sent = if i == 10 { start } else { start - RTT };
            b.note_ack(start + piece * i, sent, delivered * PKT / 10, false, RTT);
        }
        start + RTT
    }

    /// With no lossy round the window is BBR's own, whatever else happened.
    #[test]
    fn before_a_lossy_round_the_window_is_bbrs() {
        let mut b = bound();
        let mut now = Instant::now();
        for _ in 0..5 {
            now = round(&mut b, now, 100, 0, 80);
        }
        assert_eq!(b.cap(), None);
        assert_eq!(b.window(), b.inner.window());
    }

    /// A round losing 2 % sets nothing; one losing over 2 % holds the window to 0.85 × the in-flight
    /// it ended with — here above 0.7 × BDP, so the in-flight is `inflight_hi`.
    #[test]
    fn a_round_losing_over_2_percent_sets_the_cap() {
        let mut b = bound();
        let now = round(&mut b, Instant::now(), 98, 2, 80);
        assert_eq!(b.cap(), None, "a 2 % round set the cap");
        round(&mut b, now, 97, 3, 80);
        assert_eq!(b.inflight_hi, Some(80 * PKT));
        let cap = (0.85 * (80 * PKT) as f64) as u64;
        assert_eq!(b.cap(), Some(cap));
        assert!(b.inner.window() > cap, "BBR's own window does not exceed the cap here");
        assert_eq!(b.window(), cap, "the window is not held to the cap");
    }

    /// `inflight_hi` never falls under 0.7 × the path's BDP: 100 packets a round trip is a
    /// 100-packet BDP, so a lossy round ending at 20 in flight still leaves 70.
    #[test]
    fn inflight_hi_is_floored_at_0_7_bdp() {
        let mut b = bound();
        let now = round(&mut b, Instant::now(), 100, 0, 100);
        round(&mut b, now, 90, 10, 20);
        let hi = b.inflight_hi.expect("a lossy round set no cap") as f64;
        assert!((hi / (0.7 * (100 * PKT) as f64) - 1.0).abs() < 0.02, "inflight_hi {hi} is not 0.7 × BDP");
    }

    /// Each clean round after the cap adds 1, 2, 4… packets to `inflight_hi`, and the next lossy
    /// round starts the count again from one.
    #[test]
    fn clean_rounds_regrow_it_1_2_4_packets() {
        let mut b = bound();
        let mut now = round(&mut b, Instant::now(), 90, 10, 50);
        let hi = b.inflight_hi.unwrap();
        let mut added = Vec::new();
        for _ in 0..3 {
            now = round(&mut b, now, 100, 0, 50);
            added.push((b.inflight_hi.unwrap() - hi) / PKT);
        }
        assert_eq!(added, [1, 3, 7]);
        now = round(&mut b, now, 90, 10, 50);
        let hi = b.inflight_hi.unwrap();
        round(&mut b, now, 100, 0, 50);
        assert_eq!(b.inflight_hi.unwrap() - hi, PKT, "a lossy round did not restart the growth");
    }
}
