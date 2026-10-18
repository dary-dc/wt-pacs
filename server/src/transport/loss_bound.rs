//! quinn's BBR under BBRv3's loss bound: a round losing over 2 % caps the window at 0.85 of
//! `inflight_hi`, which clean rounds regrow 1, 2, 4… packets at a time. Over the public
//! `Controller` trait, as `restart.rs` is. `docs/transport/transport-conclusions.md` §1, *quinn's BBR against BBRv3*.

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
    pub fn new(bbr: Arc<BbrConfig>) -> Self {
        Self { bbr }
    }
}

impl ControllerFactory for LossBoundConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(LossBound::new(Arc::clone(&self.bbr), now, current_mtu))
    }
}

#[cfg(test)]
mod tests;
