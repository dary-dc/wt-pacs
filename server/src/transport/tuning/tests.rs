use super::*;

/// quinn's stock stack: the knob under test is then the only departure from it.
fn stock() -> TransportTuning {
    TransportTuning { congestion: Congestion::Cubic, ..TransportTuning::default() }
}

/// The default controller starts at quinn's 12 000 bytes, and the flag's 38 400 reaches every
/// controller: the wider window measured behind deep buffers is opt-in.
#[test]
fn the_wider_initial_window_is_opt_in() {
    let start = |t: TransportTuning| t.congestion.factory(t.initial_window).build(std::time::Instant::now(), 1200).initial_window();
    assert_eq!(start(TransportTuning::default()), 12_000);
    for congestion in [Congestion::Cubic, Congestion::Bbr, Congestion::CubicRestart, Congestion::BbrBound] {
        assert_eq!(start(TransportTuning { congestion, initial_window: Some(38_400), ..TransportTuning::default() }), 38_400);
    }
}

#[test]
fn default_tuning_builds() {
    TransportTuning::default().to_transport_config().expect("builds");
}

#[test]
fn every_knob_builds() {
    let t = TransportTuning {
        send_window: Some(32 << 20),
        max_idle_timeout_ms: Some(60_000),
        keep_alive_interval_ms: Some(20_000),
        congestion: Congestion::Bbr,
        initial_window: Some(32 * 1200),
        initial_rtt_ms: Some(100),
        reply_repeated_initial: true,
        segmentation_offload: false,
    };
    t.to_transport_config().expect("builds");
}

/// Every departure from quinn's stock stack is named in the banner, so a measured row cannot
/// be mislabelled, and the stock stack names none. docs/transport/transport-conclusions.md §3.
#[test]
fn each_knob_set_is_named_in_the_banner() {
    assert_eq!(stock().describe(), "default");
    for (t, want) in [
        (TransportTuning { send_window: Some(1 << 20), ..stock() }, "send_window=1048576"),
        (TransportTuning { max_idle_timeout_ms: Some(60_000), ..stock() }, "max_idle_timeout_ms=60000"),
        (TransportTuning { keep_alive_interval_ms: Some(20_000), ..stock() }, "keep_alive_interval_ms=20000"),
        (TransportTuning { initial_window: Some(38_400), ..stock() }, "initial_window=38400"),
        (TransportTuning { initial_rtt_ms: Some(100), ..stock() }, "initial_rtt_ms=100"),
        (TransportTuning { reply_repeated_initial: true, ..stock() }, "reply_repeated_initial"),
        (TransportTuning { segmentation_offload: false, ..stock() }, "segmentation_offload=false"),
    ] {
        assert!(t.describe().contains(want), "{} lacks {want}", t.describe());
        t.to_transport_config().expect("builds");
    }
}

/// An idle timeout quinn cannot encode stops the server at start rather than being dropped.
#[test]
fn an_idle_timeout_out_of_range_is_refused() {
    let t = TransportTuning { max_idle_timeout_ms: Some(u64::MAX), ..stock() };
    assert!(t.to_transport_config().is_err());
}

/// The default controller is the restart after a silence, which quinn's stock stack lacks, and
/// a run must say it carries it.
#[test]
fn the_default_controller_is_cubic_restart() {
    let t = TransportTuning::default();
    assert_eq!(t.congestion, Congestion::CubicRestart);
    assert!(t.describe().contains("congestion=cubic-restart"));
}

/// The loss bound is opt-in under its own name, a run on it says so, and the name builds it.
#[test]
fn the_loss_bound_is_named_and_builds() {
    let t = TransportTuning { congestion: Congestion::BbrBound, initial_window: Some(38_400), ..stock() };
    assert!(t.describe().contains("congestion=bbr-bound"));
    t.to_transport_config().expect("builds");
    let built = Congestion::BbrBound.factory(None).build(std::time::Instant::now(), 1200);
    assert!(built.into_any().downcast::<crate::transport::loss_bound::LossBound>().is_ok());
}

/// `cubic-classify` wraps `cubic-restart`, so the two arms differ in the classifier alone, and the
/// initial window reaches it.
#[cfg(feature = "lab-classify")]
#[test]
fn cubic_classify_wraps_cubic_restart() {
    let built = Congestion::CubicClassify.factory(Some(38_400)).build(std::time::Instant::now(), 1200);
    assert_eq!(built.initial_window(), 38_400);
    let classify = built.into_any().downcast::<cc_classify::LossClassify>().expect("a LossClassify");
    assert!(classify.into_inner().into_any().downcast::<crate::transport::restart::SlowStartRestart>().is_ok());
}
