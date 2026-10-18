//! The start-up banner: `key=value` lines on stdout that the harnesses and `lab/` scripts read.

use crate::media::frame_store::FrameStore;
use crate::media::read_path::ring_probe;
use crate::transport::server::ServeConfig;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use tracing::{info, warn};

pub(super) fn print(config: &ServeConfig, store: &FrameStore, bound: &str, cert_sha256: &str) {
    let host = url_host(config.bind, config.wt_port);
    let wt_url = format!("https://{host}/");
    println!("wt_url={wt_url}");
    if config.websocket {
        println!("ws_url=wss://{host}/");
    }
    println!("cert_sha256={cert_sha256}");
    println!("series={}", config.series_path.display());
    println!("frames={}", store.frame_count());
    println!("read_fast_path={}", read_fast_path(store));
    println!("read_ring={}", ring_probe(store));
    println!("stream_mode={}", config.mode);
    println!("bind={bound}");
    println!("transport={}", config.tuning.describe());
    #[cfg(feature = "telemetry")]
    println!("telemetry=compile-time");
    #[cfg(not(feature = "telemetry"))]
    println!("telemetry=absent");
    info!(
        %wt_url,
        series = %config.series_path.display(),
        stream_mode = %config.mode,
        "series-server ready (Media-complete)"
    );
}

/// What a client on this host dials: the `--bind` address when it names one, else loopback.
fn url_host(bind: Option<IpAddr>, port: u16) -> SocketAddr {
    let ip = bind.filter(|ip| !ip.is_unspecified()).unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
    SocketAddr::new(ip, port)
}

/// Warns where the fast path is absent: the fallback is correct and slower, `docs/adr/disk-access.md`.
fn read_fast_path(store: &FrameStore) -> &'static str {
    if store.nowait_supported() {
        return "preadv2";
    }
    warn!(
        "RWF_NOWAIT is refused here (overlayfs or tmpfs?); every frame costs a blocking-pool \
         round trip. See docs/adr/disk-access.md"
    );
    "pooled_pread"
}

#[cfg(test)]
mod tests;
