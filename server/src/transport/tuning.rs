//! QUIC transport knobs. Cubic with nothing else set is quinn's stock configuration byte for byte.

use crate::transport::loss_bound::LossBoundConfig;
use crate::transport::restart::SlowStartRestartConfig;
use anyhow::{anyhow, Result};
use std::sync::Arc;
use std::time::Duration;
use wtransport::quinn::congestion::{BbrConfig, ControllerFactory, CubicConfig};
use wtransport::quinn::{IdleTimeout, TransportConfig};

/// Congestion controller. quinn's BBR is a port of quiche's BBRv1, not BBRv3.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, clap::ValueEnum)]
pub enum Congestion {
    Cubic,
    Bbr,
    /// Cubic that restarts slow start after a silence instead of halving. `restart.rs`.
    #[default]
    CubicRestart,
    /// BBR under BBRv3's loss bound. `loss_bound.rs`.
    BbrBound,
}

impl Congestion {
    fn factory(self, initial_window: Option<u64>) -> Arc<dyn ControllerFactory + Send + Sync> {
        match self {
            Self::Cubic => {
                let mut c = CubicConfig::default();
                if let Some(v) = initial_window {
                    c.initial_window(v);
                }
                Arc::new(c)
            }
            Self::Bbr => {
                let mut c = BbrConfig::default();
                if let Some(v) = initial_window {
                    c.initial_window(v);
                }
                Arc::new(c)
            }
            Self::CubicRestart => Arc::new(SlowStartRestartConfig::new(initial_window)),
            Self::BbrBound => Arc::new(LossBoundConfig::new(initial_window)),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cubic => "cubic",
            Self::Bbr => "bbr",
            Self::CubicRestart => "cubic-restart",
            Self::BbrBound => "bbr-bound",
        }
    }
}

#[derive(Clone, Debug)]
pub struct TransportTuning {
    /// Cap on buffered unacknowledged send bytes.
    pub send_window: Option<u64>,
    pub max_idle_timeout_ms: Option<u64>,
    /// Server-sent keep-alive. One side is enough to hold a session open, and a browser client
    /// has no such knob, so this is the only lever that reaches one. docs/adr/transport-idle-sessions.md.
    pub keep_alive_interval_ms: Option<u64>,
    pub congestion: Congestion,
    /// Bytes the controller may send before the first ACK. quinn default: 12 000.
    pub initial_window: Option<u64>,
    /// The RTT assumed before the first sample, which sets the first probe timeout.
    /// quinn default: 333 ms.
    pub initial_rtt_ms: Option<u64>,
    /// Lab only: off sends each datagram alone, so netem on the sending host drops datagrams,
    /// not whole GSO batches (docs/rig-limits.md §3).
    pub segmentation_offload: bool,
}

impl Default for TransportTuning {
    fn default() -> Self {
        Self {
            send_window: None,
            max_idle_timeout_ms: None,
            keep_alive_interval_ms: None,
            congestion: Congestion::default(),
            initial_window: None,
            initial_rtt_ms: None,
            segmentation_offload: true,
        }
    }
}

impl TransportTuning {
    pub fn to_transport_config(&self) -> Result<TransportConfig> {
        let mut tc = TransportConfig::default();

        if let Some(v) = self.send_window {
            tc.send_window(v);
        }
        if let Some(ms) = self.max_idle_timeout_ms {
            let idle = IdleTimeout::try_from(Duration::from_millis(ms))
                .map_err(|_| anyhow!("max_idle_timeout_ms {ms} out of range"))?;
            tc.max_idle_timeout(Some(idle));
        }
        if let Some(ms) = self.keep_alive_interval_ms {
            tc.keep_alive_interval(Some(Duration::from_millis(ms)));
        }
        if let Some(ms) = self.initial_rtt_ms {
            tc.initial_rtt(Duration::from_millis(ms));
        }
        tc.enable_segmentation_offload(self.segmentation_offload);

        tc.congestion_controller_factory(self.congestion.factory(self.initial_window));
        Ok(tc)
    }

    pub fn describe(&self) -> String {
        let mut parts = Vec::new();
        if let Some(v) = self.send_window {
            parts.push(format!("send_window={v}"));
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
        if let Some(v) = self.initial_rtt_ms {
            parts.push(format!("initial_rtt_ms={v}"));
        }
        if !matches!(self.congestion, Congestion::Cubic) {
            parts.push(format!("congestion={}", self.congestion.as_str()));
        }
        if !self.segmentation_offload {
            parts.push("segmentation_offload=false".to_string());
        }
        if parts.is_empty() {
            return "default".to_string();
        }
        parts.join(",")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// quinn's stock stack: the knob under test is then the only departure from it.
    fn stock() -> TransportTuning {
        TransportTuning { congestion: Congestion::Cubic, ..TransportTuning::default() }
    }

    #[test]
    fn default_tuning_builds() {
        TransportTuning::default().to_transport_config().expect("builds");
    }

    #[test]
    fn every_knob_builds() {
        let t = TransportTuning {
            send_window: Some(32 << 20),
            max_idle_timeout_ms: Some(60_000),
            keep_alive_interval_ms: Some(20_000),
            congestion: Congestion::Bbr,
            initial_window: Some(32 * 1200),
            initial_rtt_ms: Some(100),
            segmentation_offload: false,
        };
        t.to_transport_config().expect("builds");
    }

    /// Every departure from quinn's stock stack is named in the banner, so a measured row cannot
    /// be mislabelled, and the stock stack names none. docs/transport/transport-conclusions.md §3.
    #[test]
    fn each_knob_set_is_named_in_the_banner() {
        assert_eq!(stock().describe(), "default");
        for (t, want) in [
            (TransportTuning { send_window: Some(1 << 20), ..stock() }, "send_window=1048576"),
            (TransportTuning { max_idle_timeout_ms: Some(60_000), ..stock() }, "max_idle_timeout_ms=60000"),
            (TransportTuning { keep_alive_interval_ms: Some(20_000), ..stock() }, "keep_alive_interval_ms=20000"),
            (TransportTuning { initial_window: Some(38_400), ..stock() }, "initial_window=38400"),
            (TransportTuning { initial_rtt_ms: Some(100), ..stock() }, "initial_rtt_ms=100"),
            (TransportTuning { segmentation_offload: false, ..stock() }, "segmentation_offload=false"),
        ] {
            assert!(t.describe().contains(want), "{} lacks {want}", t.describe());
            t.to_transport_config().expect("builds");
        }
    }

    /// An idle timeout quinn cannot encode stops the server at start rather than being dropped.
    #[test]
    fn an_idle_timeout_out_of_range_is_refused() {
        let t = TransportTuning { max_idle_timeout_ms: Some(u64::MAX), ..stock() };
        assert!(t.to_transport_config().is_err());
    }

    /// The default controller is the restart after a silence, which quinn's stock stack lacks, and
    /// a run must say it carries it.
    #[test]
    fn the_default_controller_is_cubic_restart() {
        let t = TransportTuning::default();
        assert_eq!(t.congestion, Congestion::CubicRestart);
        assert!(t.describe().contains("congestion=cubic-restart"));
    }

    /// The loss bound is opt-in under its own name, a run on it says so, and the name builds it.
    #[test]
    fn the_loss_bound_is_named_and_builds() {
        let t = TransportTuning { congestion: Congestion::BbrBound, initial_window: Some(38_400), ..stock() };
        assert!(t.describe().contains("congestion=bbr-bound"));
        t.to_transport_config().expect("builds");
        let built = Congestion::BbrBound.factory(None).build(std::time::Instant::now(), 1200);
        assert!(built.into_any().downcast::<crate::transport::loss_bound::LossBound>().is_ok());
    }
}
