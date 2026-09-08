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

/// How frame bytes reach the connection's send buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, clap::ValueEnum)]
pub enum SendPath {
    /// `wrap()` into a fresh Vec, then `write_all` — two full-frame copies. Reproduces `main`.
    #[cfg(feature = "lab")]
    Copy,
    /// `Bytes` slice of the mapping + `write_all_chunks` — no full-frame copy.
    #[default]
    Chunked,
}

#[derive(Clone, Debug)]
pub struct TransportTuning {
    /// Connection-wide receive window. quinn default: unlimited.
    pub receive_window: Option<u64>,
    /// Cap on buffered unacknowledged send bytes. quinn default: 10_000_000.
    pub send_window: Option<u64>,
    pub congestion: Congestion,
    /// Round-robin between same-priority streams. quinn default: true. Moot under `shared`.
    #[cfg(feature = "lab")]
    pub send_fairness: Option<bool>,
    /// UDP GSO on the send path. quinn default: on.
    #[cfg(feature = "lab")]
    pub segmentation_offload: bool,
    pub send_path: SendPath,
    /// Fault frame pages in from a blocking thread, because a major fault is not an `.await`.
    pub prefault: bool,
}

impl Default for TransportTuning {
    fn default() -> Self {
        Self {
            receive_window: None,
            send_window: None,
            congestion: Congestion::Cubic,
            #[cfg(feature = "lab")]
            send_fairness: None,
            #[cfg(feature = "lab")]
            segmentation_offload: true,
            send_path: SendPath::Chunked,
            prefault: true,
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
        #[cfg(feature = "lab")]
        {
            if let Some(v) = self.send_fairness {
                tc.send_fairness(v);
            }
            tc.enable_segmentation_offload(self.segmentation_offload);
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
            send_window: Some(32 << 20),
            congestion: Congestion::Bbr,
            #[cfg(feature = "lab")]
            send_fairness: Some(false),
            #[cfg(feature = "lab")]
            segmentation_offload: false,
            send_path: SendPath::default(),
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
