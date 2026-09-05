//! How media frames leave the server for a session (process-wide CLI choice).

/// One shared uni for the session, or one uni per frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum StreamMode {
    /// Frames arrive strictly in ask order on one long-lived uni stream.
    Shared,
    /// Independent delivery per frame; allows `set_priority` and `reset`.
    PerFrame,
}

impl StreamMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "shared",
            Self::PerFrame => "per-frame",
        }
    }
}
