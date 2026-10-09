//! How media frames leave the server for a session (process-wide CLI choice).
//! What separates the two shapes: `docs/adr/stream-shape.md`.

use std::fmt;
use std::str::FromStr;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamMode {
    /// One long-lived uni: frames arrive strictly in ask order.
    Shared,
    /// Independent delivery per frame; allows `set_priority` and `reset`.
    PerFrame,
}

impl fmt::Display for StreamMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Shared => f.write_str("shared"),
            Self::PerFrame => f.write_str("per-frame"),
        }
    }
}

impl FromStr for StreamMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "shared" => Ok(Self::Shared),
            "per-frame" => Ok(Self::PerFrame),
            _ => Err(format!("expected `shared` or `per-frame`, got `{s}`")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every spelling the CLI and the lab scripts pass round-trips through its own label.
    #[test]
    fn every_mode_round_trips_through_its_label() {
        for s in ["shared", "per-frame"] {
            let mode: StreamMode = s.parse().expect("parses");
            assert_eq!(mode.to_string(), s, "`{s}` did not round-trip");
        }
    }

    /// Anything else is rejected at the flag, `pool:k` among them.
    #[test]
    fn an_unknown_mode_is_rejected() {
        for s in ["pool:2", "pool", "shared:2", ""] {
            assert!(s.parse::<StreamMode>().is_err(), "`{s}` was accepted");
        }
    }
}
