//! The start-up banner: `key=value` lines on stdout that the harnesses and `lab/` scripts read.

use crate::media::frame_store::FrameStore;
use crate::media::read_path::ring_probe;
use crate::transport::server::{ServeConfig, Series};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::Path;
use tracing::{info, warn};

/// Under `--root` a series' lines are not printed: no series is open until a session names one.
pub(super) fn print(config: &ServeConfig, series: &Series, bound: &str, cert_sha256: &str) {
    let host = url_host(config.bind, config.wt_port);
    let wt_url = format!("https://{host}/");
    println!("wt_url={wt_url}");
    if config.websocket {
        println!("ws_url=wss://{host}/");
    }
    println!("cert_sha256={cert_sha256}");
    let serving = match series {
        Series::One(store) => {
            let path = config.series_path.as_deref().unwrap_or(Path::new("")).display();
            println!("series={path}");
            println!("frames={}", store.frame_count());
            println!("read_fast_path={}", read_fast_path(store));
            println!("read_ring={}", ring_probe(store));
            path.to_string()
        }
        Series::Tree(tree) => {
            println!("root={}", tree.root().display());
            tree.root().display().to_string()
        }
    };
    println!("stream_mode={}", config.mode);
    println!("bind={bound}");
    println!("transport={}", config.tuning.describe());
    #[cfg(feature = "telemetry")]
    println!("telemetry=compile-time");
    #[cfg(not(feature = "telemetry"))]
    println!("telemetry=absent");
    info!(
        %wt_url,
        series = %serving,
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
mod tests {
    use super::*;

    /// The banner's URLs name the address `--bind` gives when it is a specific one, in URL form for
    /// IPv6, and loopback when `--bind` is absent or a wildcard.
    #[test]
    fn the_url_names_a_specific_bind_address_and_loopback_otherwise() {
        let host = |bind: Option<&str>| url_host(bind.map(|ip| ip.parse().unwrap()), 4433).to_string();
        assert_eq!(host(Some("10.77.0.2")), "10.77.0.2:4433");
        assert_eq!(host(Some("::1")), "[::1]:4433");
        assert_eq!(host(Some("127.0.0.1")), "127.0.0.1:4433");
        assert_eq!(host(None), "127.0.0.1:4433");
        assert_eq!(host(Some("0.0.0.0")), "127.0.0.1:4433");
        assert_eq!(host(Some("::")), "127.0.0.1:4433");
    }
}
