//! QUIC transport knobs, in one place, with the quinn default recorded next to each.
//!
//! Every field is `Option` or carries an explicit default equal to quinn's, so an
//! unset `TransportTuning` reproduces the stock configuration byte for byte. That is
//! what makes an arm in `lab/scripts/quic_opt_bench.sh` a single-variable change.

use anyhow::Result;
use std::sync::Arc;
use wtransport::quinn::TransportConfig;

/// Congestion controller. quinn's default is Cubic; its BBR is a port of quiche's
/// BBRv1 and is marked experimental upstream — not BBRv3.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, clap::ValueEnum)]
pub enum Congestion {
    #[default]
    Cubic,
    Bbr,
    NewReno,
}

/// How frame bytes reach the connection's send buffer.
///
/// Three arms because there are three historical shapes, and the increment that
/// matters is `Split` → `Chunked`, not `Copy` → `Chunked`. See
/// `docs/quic-transport-optimization.md` §1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, clap::ValueEnum)]
pub enum SendPath {
    /// `wrap()` into a fresh Vec, then `write_all(&[u8])`. **Two** full-frame copies.
    /// The oldest shape; kept only so the historical delta stays reproducible.
    Copy,
    /// `[len]`, `[index]`, codestream as three `write_all(&[u8])` calls — no contiguous
    /// buffer, so `wrap()`'s copy is gone, but quinn still copies the codestream into
    /// its send buffer. **One** full-frame copy. This is the shape on
    /// `cursor/client-frame-pipeline-telemetry-8017`, and the baseline to beat.
    Split,
    /// `Bytes` slice of the mapping + `write_all_chunks`. **No** full-frame copy.
    #[default]
    Chunked,
}

#[derive(Clone, Debug)]
pub struct TransportTuning {
    /// Per-stream flow-control window. quinn default: 1_250_000 (100 Mbps × 100 ms).
    pub stream_receive_window: Option<u64>,
    /// Connection-wide receive window. quinn default: unlimited.
    pub receive_window: Option<u64>,
    /// Cap on buffered unacknowledged send bytes. quinn default: 10_000_000.
    pub send_window: Option<u64>,
    /// Round-robin between same-priority streams. quinn default: true.
    pub send_fairness: Option<bool>,
    /// Starting MTU before DPLMTUD raises it. quinn default: 1200.
    pub initial_mtu: Option<u16>,
    /// DPLMTUD on/off. quinn default: on, searching up to 1452.
    pub mtu_discovery: bool,
    pub congestion: Congestion,
    /// QUIC ACK-frequency extension. quinn default: off.
    pub ack_frequency: bool,
    /// UDP GSO on the send path. quinn default: on.
    pub segmentation_offload: bool,
    /// SO_SNDBUF / SO_RCVBUF on the UDP socket. Unset leaves the OS default.
    pub socket_send_buffer: Option<usize>,
    pub socket_recv_buffer: Option<usize>,
    pub send_path: SendPath,
    /// Fault frame pages in from a blocking thread before writing them.
    ///
    /// On by default, and correct when the page cache is cold — a major fault is not an
    /// `.await`, so taking it on the executor stalls every task sharing the thread. It
    /// costs one `spawn_blocking` round trip per frame, which is why it is measurable.
    pub prefault: bool,
}

impl Default for TransportTuning {
    /// quinn's defaults, except `send_path` — see `docs/quic-transport-optimization.md`.
    fn default() -> Self {
        Self {
            stream_receive_window: None,
            receive_window: None,
            send_window: None,
            send_fairness: None,
            initial_mtu: None,
            mtu_discovery: true,
            congestion: Congestion::Cubic,
            ack_frequency: false,
            segmentation_offload: true,
            socket_send_buffer: None,
            socket_recv_buffer: None,
            send_path: SendPath::Chunked,
            prefault: true,
        }
    }
}

impl TransportTuning {
    /// Build the quinn `TransportConfig` this tuning describes.
    pub fn to_transport_config(&self) -> Result<TransportConfig> {
        use wtransport::quinn::congestion;
        use wtransport::quinn::{AckFrequencyConfig, MtuDiscoveryConfig};

        let mut tc = TransportConfig::default();

        if let Some(v) = self.stream_receive_window {
            tc.stream_receive_window(varint(v, "stream-receive-window")?);
        }
        if let Some(v) = self.receive_window {
            tc.receive_window(varint(v, "receive-window")?);
        }
        if let Some(v) = self.send_window {
            tc.send_window(v);
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

        match self.congestion {
            Congestion::Cubic => tc.congestion_controller_factory(Arc::new(
                congestion::CubicConfig::default(),
            )),
            Congestion::Bbr => {
                tc.congestion_controller_factory(Arc::new(congestion::BbrConfig::default()))
            }
            Congestion::NewReno => tc.congestion_controller_factory(Arc::new(
                congestion::NewRenoConfig::default(),
            )),
        };

        Ok(tc)
    }

    /// True when nothing here needs a UDP socket built by hand.
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
            stream_receive_window: Some(8 << 20),
            receive_window: Some(64 << 20),
            send_window: Some(32 << 20),
            send_fairness: Some(false),
            initial_mtu: Some(1452),
            mtu_discovery: false,
            congestion: Congestion::Bbr,
            ack_frequency: true,
            segmentation_offload: false,
            socket_send_buffer: Some(4 << 20),
            socket_recv_buffer: Some(4 << 20),
            send_path: SendPath::Copy,
            prefault: false,
        };
        t.to_transport_config().unwrap();
        assert!(!t.socket_buffers_are_default());
    }

    #[test]
    fn oversized_window_is_an_error() {
        let t = TransportTuning {
            stream_receive_window: Some(u64::MAX),
            ..Default::default()
        };
        assert!(t.to_transport_config().is_err());
    }
}
