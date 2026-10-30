//! An outage is not congestion. When a congestion event closes a silence rather than a loss
//! among acknowledgements, restart slow start instead of halving — over quinn's Cubic, through
//! the public `Controller` trait alone. What it measured:
//! `docs/transport/transport-conclusions.md` §3, after a blink.

use quinn_proto::RttEstimator;
use std::any::Any;
use std::sync::Arc;
use std::time::{Duration, Instant};
use wtransport::quinn::congestion::{
    Controller, ControllerFactory, ControllerMetrics, CubicConfig,
};

/// Two probe timeouts, with quinn's RTT variance sitting near a quarter of the estimate.
const SILENCE_RTTS: u32 = 4;

/// Watches the acknowledgement stream for a silence of `SILENCE_RTTS` round trips. A congestion
/// event whose lost packets all predate that silence replaces the inner controller with a new
/// one, which is quinn's only way back into slow start: initial window, no ssthresh.
pub struct SlowStartRestart {
    cubic: Arc<CubicConfig>,
    inner: Box<dyn Controller>,
    mtu: u16,
    rtt: Duration,
    last_ack: Option<Instant>,
    /// The acknowledgement that closed the last silence, until a congestion event spends it:
    /// quinn declares the loss an acknowledgement or two later, not on the one that closed it.
    silence_end: Option<Instant>,
    /// When the last batch of acknowledgements left nothing in flight.
    empty_since: Option<Instant>,
}

impl SlowStartRestart {
    fn new(cubic: Arc<CubicConfig>, now: Instant, mtu: u16) -> Self {
        Self {
            inner: Arc::clone(&cubic).build(now, mtu),
            cubic,
            mtu,
            rtt: Duration::ZERO,
            last_ack: None,
            silence_end: None,
            empty_since: None,
        }
    }

    fn rebuild(&mut self, now: Instant) {
        self.inner = Arc::clone(&self.cubic).build(now, self.mtu);
    }

    /// One acknowledged packet. The gap is read against the estimate that held before it: the
    /// sample that closes an outage is the outage, and would raise the bar by the silence it
    /// measures. `RttEstimator` cannot be built outside quinn, so this is the seam the detector
    /// is exercised through.
    fn note_ack(&mut self, now: Instant, rtt: Duration) {
        if self.last_ack.is_some_and(|l| now.duration_since(l) >= SILENCE_RTTS * self.rtt) {
            self.silence_end = Some(now);
        }
        self.last_ack = Some(now);
        self.rtt = rtt;
    }
}

impl Controller for SlowStartRestart {
    fn on_sent(&mut self, now: Instant, bytes: u64, last_packet_number: u64) {
        if self.empty_since.take().is_some() {
            // Nothing was owed before this send: an idle spell is no outage.
            self.last_ack = Some(now);
        }
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
        self.note_ack(now, rtt.get());
        self.inner.on_ack(now, sent, bytes, app_limited, rtt);
    }

    fn on_end_acks(
        &mut self,
        now: Instant,
        in_flight: u64,
        app_limited: bool,
        largest_packet_num_acked: Option<u64>,
    ) {
        self.empty_since = (in_flight == 0).then_some(now);
        self.inner
            .on_end_acks(now, in_flight, app_limited, largest_packet_num_acked);
    }

    fn on_congestion_event(
        &mut self,
        now: Instant,
        sent: Instant,
        is_persistent_congestion: bool,
        lost_bytes: u64,
    ) {
        if self.silence_end.is_some_and(|end| sent <= end) {
            self.rebuild(now);
            self.silence_end = None;
            return;
        }
        self.inner
            .on_congestion_event(now, sent, is_persistent_congestion, lost_bytes);
    }

    fn on_mtu_update(&mut self, new_mtu: u16) {
        self.mtu = new_mtu;
        self.inner.on_mtu_update(new_mtu);
    }

    fn window(&self) -> u64 {
        self.inner.window()
    }

    fn metrics(&self) -> ControllerMetrics {
        self.inner.metrics()
    }

    fn clone_box(&self) -> Box<dyn Controller> {
        Box::new(Self {
            cubic: Arc::clone(&self.cubic),
            inner: self.inner.clone_box(),
            mtu: self.mtu,
            rtt: self.rtt,
            last_ack: self.last_ack,
            silence_end: self.silence_end,
            empty_since: self.empty_since,
        })
    }

    fn initial_window(&self) -> u64 {
        self.inner.initial_window()
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any> {
        self
    }
}

pub struct SlowStartRestartConfig {
    cubic: Arc<CubicConfig>,
}

impl SlowStartRestartConfig {
    pub fn new(cubic: Arc<CubicConfig>) -> Self {
        Self { cubic }
    }
}

impl ControllerFactory for SlowStartRestartConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(SlowStartRestart::new(Arc::clone(&self.cubic), now, current_mtu))
    }
}

#[cfg(test)]
mod tests;
