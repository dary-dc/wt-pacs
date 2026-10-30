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
    #[cfg(feature = "lab-levers")]
    PerFrameAsksFirst,
}

impl fmt::Display for StreamMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.to_possible_value().expect("no mode is skipped").get_name())
    }
}

#[cfg(test)]
mod tests;
