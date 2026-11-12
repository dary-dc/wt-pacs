//! Levers a deployment never pulls, compiled only under `lab-levers`. server/README.md §Lab only

use crate::media::frame_store::FrameStore;
use crate::transport::server::ServeConfig;
use tracing::warn;
use wtransport::endpoint::IncomingSession;

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
    /// Lab only: row 259's arm T1, one `WILLNEED` per tile name past the slots. docs/adr/disk-access.md §9
    #[arg(long, default_value_t = false)]
    pub advise_tile_names: bool,
}

impl Default for LabLevers {
    fn default() -> Self {
        Self {
            force_pool_reads: false,
            hold_sessions: false,
            stall_after_bytes: None,
            segmentation_offload: true,
            advise_tile_names: false,
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
    if lab.advise_tile_names {
        warn!("--advise-tile-names: tile names past the slots are advised; this is a lab flag, not a deployment one");
    }
    config.tuning.segmentation_offload = lab.segmentation_offload;
    config
}

pub(super) async fn hold_session(incoming: IncomingSession) {
    if let Ok(_unanswered) = incoming.await {
        std::future::pending::<()>().await;
    }
}
