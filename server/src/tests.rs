use super::*;
use series_server::{Congestion, TransportTuning};

fn parse(flags: &[&str]) -> ServeConfig {
    Args::try_parse_from([&["series-server", "--series", "s.sbnd"], flags].concat()).expect("parses").serve
}

/// The restart after a silence is the default controller: it won every dropped blink and tied
/// everywhere else. docs/transport/transport-conclusions.md §3.
#[test]
fn the_default_controller_is_cubic_restart() {
    assert_eq!(parse(&[]).tuning.congestion, Congestion::CubicRestart);
    assert_eq!(parse(&["--congestion", "cubic"]).tuning.congestion, Congestion::Cubic);
    assert_eq!(parse(&["--congestion", "bbr-bound"]).tuning.congestion, Congestion::BbrBound);
}

/// `cubic-classify` is the lab's: a build without `lab-classify` refuses the flag.
#[cfg(not(feature = "lab-classify"))]
#[test]
fn the_default_build_has_no_cubic_classify() {
    assert!(Args::try_parse_from(["series-server", "--series", "s.sbnd", "--congestion", "cubic-classify"]).is_err());
}

/// Under `lab-classify` the flag names the lab's controller.
#[cfg(feature = "lab-classify")]
#[test]
fn cubic_classify_parses_under_its_feature() {
    assert_eq!(parse(&["--congestion", "cubic-classify"]).tuning.congestion, Congestion::CubicClassify);
}

/// The opening ask is on unless turned off, and the bare flag the lab scripts pass still parses.
#[test]
fn the_opening_ask_is_on_by_default_with_a_way_off() {
    assert!(parse(&[]).opening_ask);
    assert!(parse(&["--opening-ask"]).opening_ask);
    assert!(!parse(&["--opening-ask", "false"]).opening_ask);
}

/// `TransportTuning::default()` is what the server runs with when no transport flag is given.
#[test]
fn no_transport_flag_parses_to_the_default_tuning() {
    assert_eq!(parse(&[]).tuning, TransportTuning::default());
    assert_eq!(parse(&[]).tuning.initial_window, None);
}

/// Every transport flag `lab/` passes still parses, under its old name, into its field.
#[test]
fn every_transport_flag_the_lab_passes_parses() {
    let flags = [
        "--send-window-bytes", "1",
        "--max-idle-timeout-ms", "2",
        "--keep-alive-interval-ms", "3",
        "--congestion", "bbr",
        "--initial-window-bytes", "4",
        "--initial-rtt-ms", "5",
        "--reply-repeated-initial",
    ];
    let tuning = TransportTuning {
        send_window: Some(1),
        max_idle_timeout_ms: Some(2),
        keep_alive_interval_ms: Some(3),
        congestion: Congestion::Bbr,
        initial_window: Some(4),
        initial_rtt_ms: Some(5),
        reply_repeated_initial: true,
        segmentation_offload: true,
    };
    assert_eq!(parse(&flags).tuning, tuning);
}

/// A build without `lab-levers` refuses each of its flags.
#[cfg(not(feature = "lab-levers"))]
#[test]
fn the_default_build_refuses_every_lab_lever() {
    for flag in [&["--force-pool-reads"][..], &["--hold-sessions"], &["--stall-after-bytes", "1"], &["--segmentation-offload", "false"]] {
        assert!(Args::try_parse_from([&["series-server", "--series", "s.sbnd"], flag].concat()).is_err(), "{flag:?} parsed");
    }
}

/// Under `lab-levers` every lever the lab passes parses into its field.
#[cfg(feature = "lab-levers")]
#[test]
fn every_lab_lever_parses_under_its_feature() {
    use series_server::LabLevers;
    assert_eq!(parse(&[]).lab, LabLevers::default());
    let flags = ["--force-pool-reads", "--hold-sessions", "--stall-after-bytes", "7", "--segmentation-offload", "false"];
    let lab = LabLevers { force_pool_reads: true, hold_sessions: true, stall_after_bytes: Some(7), segmentation_offload: false };
    assert_eq!(parse(&flags).lab, lab);
}
