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
    /// Lab only: `cubic-restart` that skips the cut on a loss that met no queue. lab/cc-classify.
    #[cfg(feature = "lab-classify")]
    CubicClassify,
}

impl Congestion {
    fn factory(self, initial_window: Option<u64>) -> Arc<dyn ControllerFactory + Send + Sync> {
        let (mut cubic, mut bbr) = (CubicConfig::default(), BbrConfig::default());
        if let Some(v) = initial_window {
            cubic.initial_window(v);
            bbr.initial_window(v);
        }
        let (cubic, bbr) = (Arc::new(cubic), Arc::new(bbr));
        match self {
            Self::Cubic => cubic,
            Self::Bbr => bbr,
            Self::CubicRestart => Arc::new(SlowStartRestartConfig::new(cubic)),
            Self::BbrBound => Arc::new(LossBoundConfig::new(bbr)),
            #[cfg(feature = "lab-classify")]
            Self::CubicClassify => Arc::new(cc_classify::LossClassifyConfig::new(Arc::new(SlowStartRestartConfig::new(cubic)))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cubic => "cubic",
            Self::Bbr => "bbr",
            Self::CubicRestart => "cubic-restart",
            Self::BbrBound => "bbr-bound",
            #[cfg(feature = "lab-classify")]
            Self::CubicClassify => "cubic-classify",
        }
    }
}

#[derive(Clone, Debug, PartialEq, clap::Args)]
pub struct TransportTuning {
    /// QUIC send window per connection in bytes: unacknowledged data held, so N sessions × this
    /// bounds memory under slow clients.
    #[arg(long = "send-window-bytes")]
    pub send_window: Option<u64>,
    /// QUIC idle timeout.
    #[arg(long)]
    pub max_idle_timeout_ms: Option<u64>,
    /// Server-sent keep-alive, off by default; below both peers' idle timeouts to work. A browser
    /// has no such knob, so this is the only lever. docs/adr/transport-idle-sessions.md.
    #[arg(long)]
    pub keep_alive_interval_ms: Option<u64>,
    #[arg(long, value_enum, default_value_t)]
    pub congestion: Congestion,
    /// Bytes the controller may send before the first ACK; quinn's own is 12 000. 38 400 is proposed,
    /// opt-in: docs/transport/link-conditions.md §Re-measured, proposed, the window behind deep buffers.
    #[arg(long = "initial-window-bytes")]
    pub initial_window: Option<u64>,
    /// The RTT assumed before the first sample, which sets the first probe timeout.
    /// quinn default: 333 ms.
    #[arg(long)]
    pub initial_rtt_ms: Option<u64>,
    /// Lab only: answer a client's repeated Initial with the unacknowledged handshake flight,
    /// once a connection. docs/transport/transport-conclusions.md §3, Answering a repeated Initial.
    #[arg(long)]
    pub reply_repeated_initial: bool,
    /// Lab only: set by `--segmentation-offload`, a flag of the `lab-levers` build.
    #[arg(skip = true)]
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
            reply_repeated_initial: false,
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
        tc.reply_repeated_initial(self.reply_repeated_initial);
        tc.enable_segmentation_offload(self.segmentation_offload);

        let factory = self.congestion.factory(self.initial_window);
        #[cfg(feature = "telemetry")]
        let factory = crate::record::cc_trace::traced(factory);
        tc.congestion_controller_factory(factory);
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
        if self.reply_repeated_initial {
            parts.push("reply_repeated_initial".to_string());
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
mod tests;
