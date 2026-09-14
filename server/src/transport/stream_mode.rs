//! How media frames leave the server for a session (process-wide CLI choice).

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum StreamMode {
    /// One long-lived uni: frames arrive strictly in ask order.
    Shared,
    /// Independent delivery per frame, each stream ranked by ask order (arm Q).
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
