use super::*;

/// Every spelling the CLI and the lab scripts pass round-trips through its own label.
#[test]
fn every_mode_round_trips_through_its_label() {
    for s in ["shared", "per-frame", "per-frame-asks-first"] {
        let mode = StreamMode::from_str(s, false).expect("parses");
        assert_eq!(mode.to_string(), s, "`{s}` did not round-trip");
    }
}

/// Anything else is rejected at the flag, `pool:k` among them.
#[test]
fn an_unknown_mode_is_rejected() {
    for s in ["pool:2", "pool", "shared:2", ""] {
        assert!(StreamMode::from_str(s, false).is_err(), "`{s}` was accepted");
    }
}
