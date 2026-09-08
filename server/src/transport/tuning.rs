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
    /// Header halves and codestream as three `write_all(&[u8])` — one full-frame copy.
    #[cfg(feature = "lab")]
    Split,
    /// `Bytes` slice of the mapping + `write_all_chunks` — no full-frame copy.
    #[default]
    Chunked,
}

#[derive(Clone, Debug)]
pub struct TransportTuning {
    /// Connection-wide receive window. quinn default: unlimited.
    pub receive_window: Option<u64>,
    /// Per-stream flow-control window. quinn default: 1_250_000.
    #[cfg(feature = "lab")]
    pub stream_receive_window: Option<u64>,
    /// Cap on buffered unacknowledged send bytes. quinn default: 10_000_000.
    pub send_window: Option<u64>,
    pub congestion: Congestion,
    /// Round-robin between same-priority streams. quinn default: true. Moot under `shared`.
    #[cfg(feature = "lab")]
    pub send_fairness: Option<bool>,
    /// UDP GSO on the send path. quinn default: on.
    #[cfg(feature = "lab")]
    pub segmentation_offload: bool,
    /// Starting MTU before DPLMTUD raises it. quinn default: 1200.
    #[cfg(feature = "lab")]
    pub initial_mtu: Option<u16>,
    /// DPLMTUD on/off. quinn default: on, searching up to 1452.
    #[cfg(feature = "lab")]
    pub mtu_discovery: bool,
    /// QUIC ACK-frequency extension. quinn default: off.
    #[cfg(feature = "lab")]
    pub ack_frequency: bool,
    /// SO_SNDBUF on the UDP socket. Unset leaves the OS default.
    #[cfg(feature = "lab")]
    pub socket_send_buffer: Option<usize>,
    /// SO_RCVBUF on the UDP socket. Unset leaves the OS default.
    #[cfg(feature = "lab")]
    pub socket_recv_buffer: Option<usize>,
    pub send_path: SendPath,
    /// Fault frame pages in from a blocking thread, because a major fault is not an `.await`.
    pub prefault: bool,
}

impl Default for TransportTuning {
    fn default() -> Self {
        Self {
            receive_window: None,
            #[cfg(feature = "lab")]
            stream_receive_window: None,
            send_window: None,
            congestion: Congestion::Cubic,
            #[cfg(feature = "lab")]
            send_fairness: None,
            #[cfg(feature = "lab")]
            segmentation_offload: true,
            #[cfg(feature = "lab")]
            initial_mtu: None,
            #[cfg(feature = "lab")]
            mtu_discovery: true,
            #[cfg(feature = "lab")]
            ack_frequency: false,
            #[cfg(feature = "lab")]
            socket_send_buffer: None,
            #[cfg(feature = "lab")]
            socket_recv_buffer: None,
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
            use wtransport::quinn::{AckFrequencyConfig, MtuDiscoveryConfig};
            if let Some(v) = self.stream_receive_window {
                tc.stream_receive_window(varint(v, "stream-receive-window")?);
            }
            if let Some(v) = self.send_fairness {
                tc.send_fairness(v);
            }
            if let Some(v) = self.initial_mtu {
                tc.initial_mtu(v);
            }
            tc.mtu_discovery_config(self.mtu_discovery.then(MtuDiscoveryConfig::default));
            tc.ack_frequency_config(self.ack_frequency.then(AckFrequencyConfig::default));
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

    /// True when nothing here needs a UDP socket built by hand.
    #[cfg(feature = "lab")]
    pub fn socket_buffers_are_default(&self) -> bool {
        self.socket_send_buffer.is_none() && self.socket_recv_buffer.is_none()
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
            #[cfg(feature = "lab")]
            stream_receive_window: Some(8 << 20),
            send_window: Some(32 << 20),
            congestion: Congestion::Bbr,
            #[cfg(feature = "lab")]
            send_fairness: Some(false),
            #[cfg(feature = "lab")]
            segmentation_offload: false,
            #[cfg(feature = "lab")]
            initial_mtu: Some(1452),
            #[cfg(feature = "lab")]
            mtu_discovery: false,
            #[cfg(feature = "lab")]
            ack_frequency: true,
            #[cfg(feature = "lab")]
            socket_send_buffer: Some(4 << 20),
            #[cfg(feature = "lab")]
            socket_recv_buffer: Some(4 << 20),
            send_path: SendPath::default(),
            prefault: false,
        };
        t.to_transport_config().unwrap();
        #[cfg(feature = "lab")]
        assert!(!t.socket_buffers_are_default());
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
