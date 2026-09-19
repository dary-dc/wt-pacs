//! QUIC transport knobs. Unset reproduces quinn's stock configuration byte for byte.

use anyhow::Result;
use std::sync::Arc;
use wtransport::quinn::TransportConfig;

/// Congestion controller. quinn's BBR is a port of quiche's BBRv1, not BBRv3.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, clap::ValueEnum)]
pub enum Congestion {
    #[default]
    Cubic,
    Bbr,
    NewReno,
}

impl Congestion {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cubic => "cubic",
            Self::Bbr => "bbr",
            Self::NewReno => "new-reno",
        }
    }
}

#[derive(Clone, Debug)]
pub struct TransportTuning {
    /// Connection-wide receive window. quinn default: unlimited.
    pub receive_window: Option<u64>,
    /// Per-stream flow-control window. quinn default: 1_250_000.
    pub stream_receive_window: Option<u64>,
    /// Cap on buffered unacknowledged send bytes. quinn default: 10_000_000.
    pub send_window: Option<u64>,
    /// Idle timeout. Applied on the wtransport builder, not inside `TransportConfig`.
    pub max_idle_timeout_ms: Option<u64>,
    /// Server-sent keep-alive. One side is enough to hold a session open, and a browser client
    /// has no such knob, so this is the only lever that reaches one. docs/transport/adr-idle-sessions.md.
    pub keep_alive_interval_ms: Option<u64>,
    pub congestion: Congestion,
    /// Bytes the controller may send before the first ACK. quinn default: 12 000 (S7).
    pub initial_window: Option<u64>,
    /// Fault frame pages in from a blocking thread, because a major fault is not an `.await`.
    pub prefault: bool,
}

impl Default for TransportTuning {
    fn default() -> Self {
        Self {
            receive_window: None,
            stream_receive_window: None,
            send_window: None,
            max_idle_timeout_ms: None,
            keep_alive_interval_ms: None,
            congestion: Congestion::Cubic,
            initial_window: None,
            prefault: false,
        }
    }
}

impl TransportTuning {
    pub fn to_transport_config(&self) -> Result<TransportConfig> {
        use wtransport::quinn::congestion;

        let mut tc = TransportConfig::default();

        if let Some(v) = self.receive_window {
            tc.receive_window(varint(v, "receive-window")?);
        }
        if let Some(v) = self.send_window {
            tc.send_window(v);
        }
        if let Some(v) = self.stream_receive_window {
            tc.stream_receive_window(varint(v, "stream-receive-window")?);
        }
        if let Some(ms) = self.keep_alive_interval_ms {
            tc.keep_alive_interval(Some(std::time::Duration::from_millis(ms)));
        }

        let iw = self.initial_window;
        match self.congestion {
            Congestion::Cubic => {
                let mut c = congestion::CubicConfig::default();
                if let Some(v) = iw {
                    c.initial_window(v);
                }
                tc.congestion_controller_factory(Arc::new(c))
            }
            Congestion::Bbr => {
                let mut c = congestion::BbrConfig::default();
                if let Some(v) = iw {
                    c.initial_window(v);
                }
                tc.congestion_controller_factory(Arc::new(c))
            }
            Congestion::NewReno => {
                let mut c = congestion::NewRenoConfig::default();
                if let Some(v) = iw {
                    c.initial_window(v);
                }
                tc.congestion_controller_factory(Arc::new(c))
            }
        };

        Ok(tc)
    }

    /// QUIC stack is still the library default — use `with_identity`, not a custom transport.
    pub fn quic_is_library_default(&self) -> bool {
        self.receive_window.is_none()
            && self.send_window.is_none()
            && self.stream_receive_window.is_none()
            && self.max_idle_timeout_ms.is_none()
            && self.keep_alive_interval_ms.is_none()
            && self.initial_window.is_none()
            && matches!(self.congestion, Congestion::Cubic)
    }

    pub fn describe(&self) -> String {
        if self.quic_is_library_default() {
            return "default".to_string();
        }
        let mut parts = Vec::new();
        if let Some(v) = self.send_window {
            parts.push(format!("send_window={v}"));
        }
        if let Some(v) = self.receive_window {
            parts.push(format!("receive_window={v}"));
        }
        if let Some(v) = self.stream_receive_window {
            parts.push(format!("stream_receive_window={v}"));
        }
        if let Some(v) = self.max_idle_timeout_ms {
            parts.push(format!("max_idle_timeout_ms={v}"));
        }
        if let Some(v) = self.keep_alive_interval_ms {
            parts.push(format!("keep_alive_interval_ms={v}"));
        }
        if let Some(v) = self.initial_window {
            parts.push(format!("initial_window={v}"));
        }
        if !matches!(self.congestion, Congestion::Cubic) {
            parts.push(format!("congestion={}", self.congestion.as_str()));
        }
        if parts.is_empty() {
            "default".to_string()
        } else {
            parts.join(",")
        }
    }
}

fn varint(v: u64, what: &str) -> Result<wtransport::quinn::VarInt> {
    wtransport::quinn::VarInt::from_u64(v)
        .map_err(|_| anyhow::anyhow!("{what} {v} exceeds the QUIC varint maximum"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_tuning_builds() {
        TransportTuning::default().to_transport_config().unwrap();
    }

    #[test]
    fn every_knob_builds() {
        let t = TransportTuning {
            receive_window: Some(64 << 20),
            stream_receive_window: Some(8 << 20),
            send_window: Some(32 << 20),
            max_idle_timeout_ms: Some(60_000),
            keep_alive_interval_ms: Some(20_000),
            congestion: Congestion::Bbr,
            initial_window: Some(32 * 1200),
            prefault: false,
        };
        t.to_transport_config().unwrap();
    }

    /// A keep-alive interval is a custom transport: taking the library default would drop it
    /// silently, and a session held open is the whole point. docs/transport/adr-idle-sessions.md.
    #[test]
    fn keep_alive_alone_leaves_the_library_default_behind() {
        let t = TransportTuning {
            keep_alive_interval_ms: Some(20_000),
            ..TransportTuning::default()
        };
        assert!(!t.quic_is_library_default());
        assert!(t.describe().contains("keep_alive_interval_ms=20000"));
        t.to_transport_config().unwrap();
    }

    /// An initial window alone is a custom transport: S7's second lever is this knob, and
    /// taking the library default would drop it. docs/transport/transport-conclusions.md.
    #[test]
    fn an_initial_window_alone_leaves_the_library_default_behind() {
        let t = TransportTuning {
            initial_window: Some(38_400),
            ..TransportTuning::default()
        };
        assert!(!t.quic_is_library_default());
        assert!(t.describe().contains("initial_window=38400"));
        t.to_transport_config().unwrap();
    }

    #[test]
    fn oversized_window_is_an_error() {
        let t = TransportTuning {
            receive_window: Some(u64::MAX),
            ..Default::default()
        };
        assert!(t.to_transport_config().is_err());
    }
}
