//! How media frames leave the server for a session (process-wide CLI choice).
//! What separates the two shapes: `docs/adr/stream-shape.md`.

use clap::ValueEnum;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum StreamMode {
    /// One long-lived uni: frames arrive strictly in ask order.
    Shared,
    /// Independent delivery per frame; allows `set_priority` and `reset`.
    PerFrame,
    /// Lab only: per-frame, every ask's stream ranked above every fill stream. `docs/native/quic-compared.md` §9.5.
    PerFrameAsksFirst,
}

impl fmt::Display for StreamMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.to_possible_value().expect("no mode is skipped").get_name())
    }
}

#[cfg(test)]
mod tests {
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
}
