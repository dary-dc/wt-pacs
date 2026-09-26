//! How media frames leave the server for a session (process-wide CLI choice).
//! What separates the three shapes: `docs/adr-stream-shape.md`.

use std::fmt;
use std::num::NonZeroUsize;
use std::str::FromStr;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamMode {
    /// One long-lived uni: frames arrive strictly in ask order.
    Shared,
    /// `k` long-lived unis, frames dealt round-robin: a loss holds back only its own stream.
    Pool(NonZeroUsize),
    /// Independent delivery per frame; allows `set_priority` and `reset`.
    PerFrame,
}

impl fmt::Display for StreamMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Shared => f.write_str("shared"),
            Self::Pool(k) => write!(f, "pool:{k}"),
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
            _ => s
                .strip_prefix("pool:")
                .and_then(|k| k.parse::<NonZeroUsize>().ok())
                .map(Self::Pool)
                .ok_or_else(|| format!("expected `shared`, `per-frame` or `pool:<k>`, got `{s}`")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every spelling the CLI and the lab scripts pass round-trips through its own label.
    #[test]
    fn every_mode_round_trips_through_its_label() {
        for s in ["shared", "per-frame", "pool:1", "pool:4", "pool:16"] {
            let mode: StreamMode = s.parse().expect("parses");
            assert_eq!(mode.to_string(), s, "`{s}` did not round-trip");
        }
    }

    /// A pool of zero streams has nowhere to send a frame, so it is rejected at the flag.
    #[test]
    fn a_pool_must_hold_at_least_one_stream() {
        for s in ["pool:0", "pool:", "pool:-1", "pool:x", "pool", "shared:2", ""] {
            assert!(s.parse::<StreamMode>().is_err(), "`{s}` was accepted");
        }
    }
}
