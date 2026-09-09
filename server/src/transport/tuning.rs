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
    pub congestion: Congestion,
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
            congestion: Congestion::Cubic,
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

        match self.congestion {
            Congestion::Cubic => {
                tc.congestion_controller_factory(Arc::new(congestion::CubicConfig::default()))
            }
            Congestion::Bbr => {
                tc.congestion_controller_factory(Arc::new(congestion::BbrConfig::default()))
            }
            Congestion::NewReno => {
                tc.congestion_controller_factory(Arc::new(congestion::NewRenoConfig::default()))
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
            congestion: Congestion::Bbr,
            prefault: false,
        };
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
