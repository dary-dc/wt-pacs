//! `cubic-restart` that skips the cut on a loss that met no queue — option 1 of
//! `docs/transport/transport-conclusions.md` §1, *Beyond Cubic and BBR* (CLASSIFY).

use crate::transport::restart::SlowStartRestartConfig;
use quinn_proto::RttEstimator;
use std::any::Any;
use std::sync::Arc;
use std::time::{Duration, Instant};
use wtransport::quinn::congestion::{Controller, ControllerFactory, ControllerMetrics};

/// RFC 9406's queue threshold: an eighth of the minimum RTT, at least 4 ms.
fn queue_threshold(min_rtt: Duration) -> Duration {
    (min_rtt / 8).max(Duration::from_millis(4))
}

pub struct LossClassify {
    inner: Box<dyn Controller>,
    /// `now − sent` of the last packet acknowledged: the queue the next declared loss met.
    rtt_latest: Duration,
    min_rtt: Duration,
}

impl LossClassify {
    /// `RttEstimator` cannot be built outside quinn, so this is the seam the tests drive.
    fn note_ack(&mut self, now: Instant, sent: Instant, min_rtt: Duration) {
        self.rtt_latest = now.saturating_duration_since(sent);
        self.min_rtt = min_rtt;
    }

    fn met_no_queue(&self) -> bool {
        !self.min_rtt.is_zero() && self.rtt_latest < self.min_rtt + queue_threshold(self.min_rtt)
    }
}

impl Controller for LossClassify {
    fn on_sent(&mut self, now: Instant, bytes: u64, last_packet_number: u64) {
        self.inner.on_sent(now, bytes, last_packet_number);
    }

    fn on_ack(&mut self, now: Instant, sent: Instant, bytes: u64, app_limited: bool, rtt: &RttEstimator) {
        self.note_ack(now, sent, rtt.min());
        self.inner.on_ack(now, sent, bytes, app_limited, rtt);
    }

    fn on_end_acks(&mut self, now: Instant, in_flight: u64, app_limited: bool, largest: Option<u64>) {
        self.inner.on_end_acks(now, in_flight, app_limited, largest);
    }

    /// quinn reports an ECN CE mark as an event with no bytes lost; it and persistent congestion always cut.
    fn on_congestion_event(&mut self, now: Instant, sent: Instant, persistent: bool, lost_bytes: u64) {
        if !persistent && lost_bytes > 0 && self.met_no_queue() {
            return;
        }
        self.inner.on_congestion_event(now, sent, persistent, lost_bytes);
    }

    fn on_mtu_update(&mut self, new_mtu: u16) {
        self.inner.on_mtu_update(new_mtu);
    }

    fn window(&self) -> u64 {
        self.inner.window()
    }

    fn metrics(&self) -> ControllerMetrics {
        self.inner.metrics()
    }

    fn clone_box(&self) -> Box<dyn Controller> {
        Box::new(Self { inner: self.inner.clone_box(), rtt_latest: self.rtt_latest, min_rtt: self.min_rtt })
    }

    fn initial_window(&self) -> u64 {
        self.inner.initial_window()
    }

    fn into_any(self: Box<Self>) -> Box<dyn Any> {
        self
    }
}

pub struct LossClassifyConfig {
    restart: Arc<SlowStartRestartConfig>,
}

impl LossClassifyConfig {
    pub fn new(initial_window: Option<u64>) -> Self {
        Self { restart: Arc::new(SlowStartRestartConfig::new(initial_window)) }
    }
}

impl ControllerFactory for LossClassifyConfig {
    fn build(self: Arc<Self>, now: Instant, current_mtu: u16) -> Box<dyn Controller> {
        Box::new(LossClassify {
            inner: Arc::clone(&self.restart).build(now, current_mtu),
            rtt_latest: Duration::ZERO,
            min_rtt: Duration::ZERO,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::restart::SlowStartRestart;

    const MIN_RTT: Duration = Duration::from_millis(80);

    fn classify() -> LossClassify {
        let c = Arc::new(LossClassifyConfig::new(None));
        let built = c.build(Instant::now(), 1200).into_any().downcast::<LossClassify>().expect("a LossClassify");
        *built
    }

    /// The window after one loss event whose last acknowledged packet took `rtt_latest`.
    fn window_after_loss(min_rtt: Duration, rtt_latest: Duration, persistent: bool, lost_bytes: u64) -> u64 {
        let mut c = classify();
        let now = Instant::now() + Duration::from_secs(1);
        c.note_ack(now, now - rtt_latest, min_rtt);
        c.on_congestion_event(now, now - rtt_latest, persistent, lost_bytes);
        c.window()
    }

    fn initial() -> u64 {
        classify().initial_window()
    }

    /// A loss whose round trip met no queue keeps the window: no multiplicative decrease.
    #[test]
    fn a_loss_that_met_no_queue_keeps_the_window() {
        assert_eq!(window_after_loss(MIN_RTT, MIN_RTT + Duration::from_millis(9), false, 1200), initial());
    }

    /// A loss behind a queue of q* or more is congestion and is passed to `cubic-restart`, which cuts.
    #[test]
    fn a_loss_behind_a_queue_cuts() {
        assert!(window_after_loss(MIN_RTT, MIN_RTT + Duration::from_millis(10), false, 1200) < initial());
    }

    /// q* is an eighth of the minimum RTT, never under 4 ms: at 20 ms the bar is 24, not 22.5.
    #[test]
    fn the_threshold_is_rfc_9406s() {
        let min = Duration::from_millis(20);
        assert_eq!(window_after_loss(min, Duration::from_micros(23_900), false, 1200), initial());
        assert!(window_after_loss(min, Duration::from_millis(24), false, 1200) < initial());
        let min = Duration::from_millis(200);
        assert_eq!(window_after_loss(min, Duration::from_micros(224_900), false, 1200), initial());
        assert!(window_after_loss(min, Duration::from_millis(225), false, 1200) < initial());
    }

    /// Persistent congestion collapses the window whatever the round trip said.
    #[test]
    fn persistent_congestion_always_cuts() {
        assert!(window_after_loss(MIN_RTT, MIN_RTT, true, 1200) < initial());
    }

    /// An ECN CE mark (an event with no bytes lost) always cuts.
    #[test]
    fn a_ce_mark_always_cuts() {
        assert!(window_after_loss(MIN_RTT, MIN_RTT, false, 0) < initial());
    }

    /// Before the first RTT sample nothing can be classed, so a loss cuts.
    #[test]
    fn no_sample_no_skip() {
        assert!(window_after_loss(Duration::ZERO, Duration::ZERO, false, 1200) < initial());
    }

    /// The controller it wraps is `cubic-restart`, so the two arms differ in the classifier alone.
    #[test]
    fn it_wraps_cubic_restart() {
        assert!(classify().inner.into_any().downcast::<SlowStartRestart>().is_ok());
    }
}
