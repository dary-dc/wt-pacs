//! Levers a deployment never pulls, compiled only under `lab-levers`. server/README.md §Lab only

use crate::media::frame_store::FrameStore;
use crate::transport::server::ServeConfig;
use tracing::warn;
use wtransport::endpoint::IncomingSession;
use wtransport::Connection;

#[derive(clap::Args, Clone, Debug, PartialEq)]
pub struct LabLevers {
    /// Lab only: serve every frame as a miss, for measuring a series nobody has read. docs/adr/disk-access.md
    #[arg(long, default_value_t = false)]
    pub force_pool_reads: bool,
    /// Lab only: take each CONNECT and never answer it. docs/ARCHITECTURE.md §A dial that never settles
    #[arg(long, default_value_t = false)]
    pub hold_sessions: bool,
    /// Lab only: each session sends this many media bytes, then nothing, with no FIN. docs/ARCHITECTURE.md
    #[arg(long, value_name = "BYTES")]
    pub stall_after_bytes: Option<u64>,
    /// Lab only: `false` sends each datagram alone, so netem on the sending host drops datagrams,
    /// not whole GSO batches (docs/rig-limits.md §3).
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    pub segmentation_offload: bool,
    /// Lab only: before each frame, the send window is the congestion window plus two of the series' largest frames.
    /// docs/transport/link-conditions.md §ASKAHEAD
    #[arg(long, default_value_t = false)]
    pub send_window_follows_cwnd: bool,
}

impl Default for LabLevers {
    fn default() -> Self {
        Self {
            force_pool_reads: false,
            hold_sessions: false,
            stall_after_bytes: None,
            segmentation_offload: true,
            send_window_follows_cwnd: false,
        }
    }
}

impl LabLevers {
    pub(super) fn forcing_misses(&self, mut store: FrameStore) -> FrameStore {
        if self.force_pool_reads {
            store.force_pool_reads();
        }
        store
    }

    /// Warns when the send window follows cwnd, so a lab flag is never mistaken for a deployment.
    pub(super) fn session_levers(&self, store: &FrameStore) -> SessionLevers {
        let cwnd_ahead = self.send_window_follows_cwnd.then(|| {
            let largest = (0..store.frame_count()).map(|i| store.frame_span(i).len).max().unwrap_or(0);
            2 * u64::from(largest)
        });
        if let Some(bytes) = cwnd_ahead {
            warn!(bytes, "--send-window-follows-cwnd: the send window is cwnd + this; a lab flag, not a deployment one");
        }
        SessionLevers { stall_left: self.stall_after_bytes, cwnd_ahead }
    }
}

/// What each session carries of the levers: its own copy, so one session's budget is its own.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct SessionLevers {
    /// Envelope bytes left before the session stalls.
    stall_left: Option<u64>,
    /// The send window is set to cwnd + this before each frame.
    cwnd_ahead: Option<u64>,
}

impl SessionLevers {
    /// Before a frame of `whole` envelope bytes: the bytes of it to send before stalling, if it
    /// is the one that crosses the budget.
    pub(crate) fn before_frame(&mut self, connection: &Connection, whole: u64) -> Option<usize> {
        if let Some(ahead) = self.cwnd_ahead {
            let quic = connection.quic_connection();
            quic.set_send_window(quic.stats().path.cwnd + ahead);
        }
        let left = self.stall_left.as_mut()?;
        if whole > *left {
            return Some(*left as usize);
        }
        *left -= whole;
        None
    }
}

/// Warns for each lever that is on, so a lab flag is never mistaken for a deployment.
pub(super) fn apply(mut config: ServeConfig) -> ServeConfig {
    let lab = &config.lab;
    if lab.force_pool_reads {
        warn!("--force-pool-reads: every read reports a miss; this is a lab flag, not a deployment one");
    }
    if lab.hold_sessions {
        warn!("--hold-sessions: no session is answered; this is a lab flag, not a deployment one");
    }
    if let Some(bytes) = lab.stall_after_bytes {
        warn!(bytes, "--stall-after-bytes: every session stalls; this is a lab flag, not a deployment one");
    }
    config.tuning.segmentation_offload = lab.segmentation_offload;
    config
}

pub(super) async fn hold_session(incoming: IncomingSession) {
    if let Ok(_unanswered) = incoming.await {
        std::future::pending::<()>().await;
    }
}
