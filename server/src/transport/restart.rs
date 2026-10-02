//! An outage is not congestion. When a congestion event closes a silence rather than a loss
//! among acknowledgements, restart slow start instead of halving — over any quinn controller,
//! through the public `Controller` trait alone, as `hystart.rs` does. What it measured:
//! `docs/transport/transport-conclusions.md` §3, after a blink. `Trigger::Idle` restarts instead
//! on the first send after an idle spell (RFC 5681 §4.1): §3, the window through a rate step.

use quinn_proto::RttEstimator;
use std::any::Any;
use std::sync::Arc;
use std::time::{Duration, Instant};
use wtransport::quinn::congestion::{
    Controller, ControllerFactory, ControllerMetrics, CubicConfig,
};

/// Two probe timeouts, with quinn's RTT variance sitting near a quarter of the estimate.
const SILENCE_RTTS: u32 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    /// A congestion event over packets sent before a silence in the acknowledgements.
    Silence,
    /// A send after `SILENCE_RTTS` round trips with nothing in flight.
    Idle,
}

/// Watches the acknowledgement stream for a silence of `SILENCE_RTTS` round trips. A congestion
/// event whose lost packets all predate that silence replaces the inner controller with a new
/// one, which is quinn's only way back into slow start: initial window, no ssthresh.
pub struct SlowStartRestart {
    trigger: Trigger,
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
    fn new(trigger: Trigger, cubic: Arc<CubicConfig>, now: Instant, mtu: u16) -> Self {
        Self {
            trigger,
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
        if let Some(empty) = self.empty_since.take() {
            if self.trigger == Trigger::Idle && now.duration_since(empty) >= SILENCE_RTTS * self.rtt {
                self.rebuild(now);
            }
            // Nothing was owed before this send: an idle spell is no outage (W5b).
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
        if self.trigger == Trigger::Silence && self.silence_end.is_some_and(|end| sent <= end) {
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
            trigger: self.trigger,
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
    trigger: Trigger,
    cubic: Arc<CubicConfig>,
}

impl SlowStartRestartConfig {
    pub fn new(trigger: Trigger, initial_window: Option<u64>) -> Self {
        let mut cubic = CubicConfig::default();
        if let Some(v) = initial_window {
            cubic.initial_window(v);
        }
        Self { trigger, cubic: Arc::new(cubic) }
    }
}

impl ControllerFactory for SlowStartRestartConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(SlowStartRestart::new(
            self.trigger,
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
        restart_on(Trigger::Silence)
    }

    fn restart_on(trigger: Trigger) -> SlowStartRestart {
        SlowStartRestart::new(trigger, Arc::new(CubicConfig::default()), Instant::now(), MTU)
    }

    /// Two acknowledgements `gap` apart, then the congestion event that follows them, over
    /// packets sent before the gap.
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

    /// quinn calls `on_ack` once per acknowledged packet: the zero-length gaps inside one batch
    /// must not erase the silence the first packet of it recorded.
    #[test]
    fn a_batch_of_acks_is_one_arrival() {
        let mut r = restart();
        let now = Instant::now();
        r.note_ack(now, RTT);
        for _ in 0..8 {
            r.note_ack(now + 4 * RTT, RTT);
        }
        assert_eq!(r.silence_end, Some(now + 4 * RTT));
    }

    /// The acknowledgement that closes an outage carries the outage as its round-trip sample:
    /// read the gap against that and a long blink raises its own bar out of reach.
    #[test]
    fn the_closing_sample_does_not_raise_the_bar() {
        let mut r = restart();
        let now = Instant::now();
        r.note_ack(now, RTT);
        r.note_ack(now + 5 * RTT, 5 * RTT);
        assert_eq!(r.silence_end, Some(now + 5 * RTT));
    }

    /// The cell that found this: quinn declares the loss an acknowledgement or two after the one
    /// that closed the outage, and a detector that reads only the newest gap misses it.
    #[test]
    fn a_silence_survives_the_acks_that_follow_it() {
        let mut r = restart();
        let now = Instant::now();
        r.note_ack(now, RTT);
        r.note_ack(now + 4 * RTT, RTT);
        r.note_ack(now + 5 * RTT, RTT);
        r.on_congestion_event(now + 5 * RTT, now, false, 1200);
        assert!(in_slow_start(&r));
    }

    /// Loss of packets sent after the outage closed is ordinary congestion, however recent the
    /// outage — otherwise one blink would turn every later loss into a restart.
    #[test]
    fn loss_after_the_silence_closed_is_congestion() {
        let mut r = restart();
        let now = Instant::now();
        r.note_ack(now, RTT);
        r.note_ack(now + 4 * RTT, RTT);
        r.on_congestion_event(now + 6 * RTT, now + 5 * RTT, false, 1200);
        assert!(!in_slow_start(&r));
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

    /// A halved window, then a last batch of acknowledgements at `now` leaving `in_flight`, then
    /// one send `gap` later.
    fn idle_then_send(trigger: Trigger, in_flight: u64, gap: Duration) -> SlowStartRestart {
        let mut r = restart_on(trigger);
        let now = Instant::now();
        r.on_congestion_event(now, now, false, 1200);
        r.note_ack(now, RTT);
        r.on_end_acks(now, in_flight, true, None);
        r.on_sent(now + gap, 1200, 1);
        r
    }

    /// Four round trips with nothing in flight is an idle spell: the next send goes out from the
    /// initial window, not from the window the session had before it.
    #[test]
    fn an_idle_spell_restarts_slow_start() {
        assert!(in_slow_start(&idle_then_send(Trigger::Idle, 0, 4 * RTT)));
    }

    /// Three round trips are not idle enough.
    #[test]
    fn three_idle_round_trips_do_not_restart() {
        assert!(!in_slow_start(&idle_then_send(Trigger::Idle, 0, 3 * RTT)));
    }

    /// A gap with packets still in flight is an outage, the silence trigger's business, not idle.
    #[test]
    fn a_gap_with_packets_in_flight_is_not_idle() {
        assert!(!in_slow_start(&idle_then_send(Trigger::Idle, 1200, 10 * RTT)));
    }

    /// An idle spell is the application's silence, not the path's: loss in the first flight after
    /// it is congestion. The misfire row 96 measured.
    #[test]
    fn an_idle_spell_is_not_an_outage() {
        let mut r = idle_then_send(Trigger::Silence, 0, 10 * RTT);
        let now = Instant::now();
        r.note_ack(now + 11 * RTT, RTT);
        r.on_congestion_event(now + 11 * RTT, now + 10 * RTT, false, 1200);
        assert!(!in_slow_start(&r));
    }

    /// The gap runs from the first send an acknowledgement is owed for, so a blink that starts
    /// as an idle session sends again is still an outage.
    #[test]
    fn a_blink_after_an_idle_spell_is_an_outage() {
        let mut r = idle_then_send(Trigger::Silence, 0, 10 * RTT);
        let now = Instant::now();
        r.note_ack(now + 15 * RTT, RTT);
        r.on_congestion_event(now + 15 * RTT, now + 10 * RTT, false, 1200);
        assert!(in_slow_start(&r));
    }

    /// Each trigger is its own arm: the idle one passes a silence's loss through, and the silence
    /// one keeps its window across an idle spell, as quinn's own Cubic does.
    #[test]
    fn each_trigger_ignores_the_other() {
        let mut r = restart_on(Trigger::Idle);
        acks_then_loss(&mut r, 4 * RTT);
        assert!(!in_slow_start(&r));
        assert!(!in_slow_start(&idle_then_send(Trigger::Silence, 0, 10 * RTT)));
    }
}
