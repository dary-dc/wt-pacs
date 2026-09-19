//! An outage is not congestion. When a congestion event closes a silence rather than a loss
//! among acknowledgements, restart slow start instead of halving — over any quinn controller,
//! through the public `Controller` trait alone, as `hystart.rs` does. What it measured:
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

/// Holds the gap between the last two acknowledgements. A congestion event that ends a gap of
/// `SILENCE_RTTS` round trips replaces the inner controller with a new one, which is quinn's
/// only way back into slow start: initial window, no ssthresh.
pub struct SlowStartRestart {
    cubic: Arc<CubicConfig>,
    inner: Box<dyn Controller>,
    mtu: u16,
    rtt: Duration,
    prev_ack: Option<Instant>,
    last_ack: Option<Instant>,
}

impl SlowStartRestart {
    fn new(cubic: Arc<CubicConfig>, now: Instant, mtu: u16) -> Self {
        Self {
            inner: Arc::clone(&cubic).build(now, mtu),
            cubic,
            mtu,
            rtt: Duration::ZERO,
            prev_ack: None,
            last_ack: None,
        }
    }

    /// One acknowledgement arrival. quinn calls `on_ack` once per acknowledged packet, so only a
    /// new instant is a new arrival. `RttEstimator` cannot be built outside quinn, so this is the
    /// seam the detector is exercised through.
    fn note_ack(&mut self, now: Instant, rtt: Duration) {
        self.rtt = rtt;
        if self.last_ack != Some(now) {
            self.prev_ack = self.last_ack;
            self.last_ack = Some(now);
        }
    }

    fn after_a_silence(&self) -> bool {
        let (Some(last), Some(prev)) = (self.last_ack, self.prev_ack) else {
            return false;
        };
        last.duration_since(prev) >= SILENCE_RTTS * self.rtt
    }
}

impl Controller for SlowStartRestart {
    fn on_sent(&mut self, now: Instant, bytes: u64, last_packet_number: u64) {
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
        if self.after_a_silence() {
            self.inner = Arc::clone(&self.cubic).build(now, self.mtu);
            self.prev_ack = self.last_ack;
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
            prev_ack: self.prev_ack,
            last_ack: self.last_ack,
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
pub struct SlowStartRestartConfig {
    cubic: Arc<CubicConfig>,
}

impl SlowStartRestartConfig {
    pub fn new(initial_window: Option<u64>) -> Self {
        let mut cubic = CubicConfig::default();
        if let Some(v) = initial_window {
            cubic.initial_window(v);
        }
        Self { cubic: Arc::new(cubic) }
    }
}

impl ControllerFactory for SlowStartRestartConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(SlowStartRestart::new(
            Arc::clone(&self.cubic),
            now,
            current_mtu,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MTU: u16 = 1200;
    const RTT: Duration = Duration::from_millis(80);

    fn restart() -> SlowStartRestart {
        SlowStartRestart::new(Arc::new(CubicConfig::default()), Instant::now(), MTU)
    }

    /// Two acknowledgements `gap` apart, then the congestion event that follows them.
    fn acks_then_loss(r: &mut SlowStartRestart, gap: Duration) {
        let now = Instant::now();
        r.note_ack(now, RTT);
        r.note_ack(now + gap, RTT);
        r.on_congestion_event(now + gap, now, false, 1200);
    }

    /// Slow start is where a controller has no threshold yet: `ssthresh` infinite, window at the
    /// initial one. Halving leaves both below it, so the pair tells the two apart.
    fn in_slow_start(r: &SlowStartRestart) -> bool {
        r.metrics().ssthresh == Some(u64::MAX) && r.window() == r.initial_window()
    }

    /// A silence of four round trips is an outage: the controller is back in slow start, not in
    /// congestion avoidance at seven tenths of the window it had.
    #[test]
    fn a_silence_restarts_slow_start() {
        let mut r = restart();
        acks_then_loss(&mut r, 4 * RTT);
        assert!(in_slow_start(&r));
    }

    /// Loss with acknowledgements still arriving is congestion, and is passed through: the inner
    /// controller halves, which leaves a threshold behind and the window under the initial one.
    #[test]
    fn loss_among_acks_is_passed_through() {
        let mut r = restart();
        acks_then_loss(&mut r, RTT);
        assert!(!in_slow_start(&r));
        assert!(r.window() < r.initial_window());
    }

    /// The threshold is four round trips of the estimate that held when the silence began —
    /// three does not restart, four does.
    #[test]
    fn the_threshold_is_four_round_trips() {
        let mut r = restart();
        acks_then_loss(&mut r, 3 * RTT);
        assert!(!in_slow_start(&r));
        let mut r = restart();
        acks_then_loss(&mut r, 4 * RTT);
        assert!(in_slow_start(&r));
    }

    /// One acknowledgement is no gap to measure, so the first congestion event of a session can
    /// never be read as an outage.
    #[test]
    fn a_single_ack_is_not_a_silence() {
        let mut r = restart();
        let now = Instant::now();
        r.note_ack(now, RTT);
        r.on_congestion_event(now + 10 * RTT, now, false, 1200);
        assert!(!in_slow_start(&r));
    }

    /// quinn calls `on_ack` once per acknowledged packet: a batch shares one instant and must
    /// read as one arrival, or the gap collapses to zero and no outage is ever seen.
    #[test]
    fn a_batch_of_acks_is_one_arrival() {
        let mut r = restart();
        let now = Instant::now();
        r.note_ack(now, RTT);
        for _ in 0..8 {
            r.note_ack(now + 4 * RTT, RTT);
        }
        assert!(r.after_a_silence());
    }

    /// A restart consumes the silence: a second congestion event behind the same gap halves the
    /// window it just rebuilt instead of rebuilding it again.
    #[test]
    fn a_restart_consumes_the_silence() {
        let mut r = restart();
        acks_then_loss(&mut r, 4 * RTT);
        let now = Instant::now();
        r.on_congestion_event(now, now, false, 1200);
        assert!(!in_slow_start(&r));
    }
}
