//! QUIC transport knobs. Unset fields leave quinn's stock value in place.

use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use wtransport::quinn::TransportConfig;

/// RFC 9002 §7.2 initial window for the 1472-byte datagram this path carries; quinn clamps its
/// own default against a 1200-byte datagram, so it starts at 12 000.
const INITIAL_WINDOW_BYTES: u64 = 14_720;

/// quinn's stock idle timeout, in milliseconds; the keep-alive interval is derived from it.
const LIBRARY_IDLE_TIMEOUT_MS: u64 = 30_000;

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
    /// RTT assumed until the first sample, so it only times handshake loss recovery.
    /// quinn default: 333 ms.
    pub initial_rtt_ms: Option<u64>,
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
            initial_rtt_ms: None,
            congestion: Congestion::Cubic,
            prefault: false,
        }
    }
}

impl TransportTuning {
    pub fn to_transport_config(&self) -> Result<TransportConfig> {
        use wtransport::quinn::congestion;

        let mut tc = TransportConfig::default();

        tc.send_fairness(false);
        tc.keep_alive_interval(Some(self.keep_alive_interval()));
        if let Some(ms) = self.initial_rtt_ms {
            tc.initial_rtt(Duration::from_millis(ms));
        }

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
                let mut cc = congestion::CubicConfig::default();
                cc.initial_window(INITIAL_WINDOW_BYTES);
                tc.congestion_controller_factory(Arc::new(cc))
            }
            // BBR already starts at 200 datagrams; raising it is not ours to do.
            Congestion::Bbr => {
                tc.congestion_controller_factory(Arc::new(congestion::BbrConfig::default()))
            }
            Congestion::NewReno => {
                let mut cc = congestion::NewRenoConfig::default();
                cc.initial_window(INITIAL_WINDOW_BYTES);
                tc.congestion_controller_factory(Arc::new(cc))
            }
        };

        Ok(tc)
    }

    fn keep_alive_interval(&self) -> Duration {
        let idle = self.max_idle_timeout_ms.unwrap_or(LIBRARY_IDLE_TIMEOUT_MS);
        Duration::from_millis((idle / 3).max(1))
    }

    /// Always false: the product defaults themselves deviate from the stock stack now, so the
    /// `with_identity` shortcut in `server.rs` would drop them.
    pub fn quic_is_library_default(&self) -> bool {
        false
    }

    pub fn describe(&self) -> String {
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
        if let Some(v) = self.initial_rtt_ms {
            parts.push(format!("initial_rtt_ms={v}"));
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
            initial_rtt_ms: Some(20),
            congestion: Congestion::Bbr,
            prefault: false,
        };
        t.to_transport_config().unwrap();
    }

    /// Frames are one uni stream each; round-robin service would interleave them on the wire,
    /// so fairness is off by default and stays off.
    #[test]
    fn frame_streams_are_served_first_come_first_served() {
        let tc = TransportTuning::default().to_transport_config().unwrap();
        assert!(format!("{tc:?}").contains("send_fairness: false"));
    }

    /// An idle session that times out costs a full handshake on the next frame.
    #[test]
    fn keep_alive_stays_under_the_idle_timeout() {
        let t = TransportTuning {
            max_idle_timeout_ms: Some(9_000),
            ..Default::default()
        };
        assert_eq!(t.keep_alive_interval(), Duration::from_millis(3_000));
        assert!(
            TransportTuning::default().keep_alive_interval()
                < Duration::from_millis(LIBRARY_IDLE_TIMEOUT_MS)
        );
        let tc = t.to_transport_config().unwrap();
        assert!(format!("{tc:?}").contains("keep_alive_interval: Some(3s)"));
    }

    /// The knob reaches the config, and unset leaves quinn's 333 ms in place.
    #[test]
    fn initial_rtt_is_applied_only_when_set() {
        let set = TransportTuning {
            initial_rtt_ms: Some(20),
            ..Default::default()
        }
        .to_transport_config()
        .unwrap();
        assert!(format!("{set:?}").contains("initial_rtt: 20ms"));

        let unset = TransportTuning::default().to_transport_config().unwrap();
        assert!(format!("{unset:?}").contains("initial_rtt: 333ms"));
    }

    /// Operators read `transport=` to see what they overrode; product defaults are not overrides.
    #[test]
    fn describe_reports_only_operator_overrides() {
        assert_eq!(TransportTuning::default().describe(), "default");
        let t = TransportTuning {
            initial_rtt_ms: Some(20),
            ..Default::default()
        };
        assert_eq!(t.describe(), "initial_rtt_ms=20");
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
