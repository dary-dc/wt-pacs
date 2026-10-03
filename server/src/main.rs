use clap::Parser;
use exact_server::{run_server, Congestion, ServeConfig, StreamMode, TransportTuning};
use std::net::IpAddr;
use std::path::PathBuf;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "exact-server")]
struct Args {
    #[arg(long, default_value = "4433")]
    port: u16,
    #[arg(long)]
    study: PathBuf,
    #[arg(long, default_value = "server/dev-cert/cert.pem")]
    cert_pem: PathBuf,
    #[arg(long, default_value = "server/dev-cert/key.pem")]
    key_pem: PathBuf,
    /// How frames reach the client: `shared` or `per-frame`.
    #[arg(long, default_value = "shared")]
    stream_mode: StreamMode,
    /// Bind address for the QUIC endpoint. Default: dual-stack `[::]`, falling back to
    /// `0.0.0.0` when the host has no IPv6.
    #[arg(long)]
    bind: Option<IpAddr>,
    /// QUIC send window per connection in bytes (unacknowledged data held). Default: library
    /// default, 10 MB. Bounds memory under slow clients: N sessions × this value.
    #[arg(long)]
    send_window_bytes: Option<u64>,
    /// QUIC idle timeout in milliseconds. Default: library default, 30 000.
    #[arg(long)]
    max_idle_timeout_ms: Option<u64>,
    /// Server-sent keep-alive in milliseconds. Off by default; must be below both peers' idle
    /// timeouts to work. docs/adr/transport-idle-sessions.md.
    #[arg(long)]
    keep_alive_interval_ms: Option<u64>,
    #[arg(long, value_enum, default_value_t)]
    congestion: Congestion,
    /// Controller knobs, quinn's default unless set: docs/transport/transport-conclusions.md §3.
    #[arg(long)]
    initial_window_bytes: Option<u64>,
    #[arg(long)]
    initial_rtt_ms: Option<u64>,
    /// Lab only: `false` sends each datagram alone, so netem here drops datagrams, not GSO
    /// batches.
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    segmentation_offload: bool,
    /// Lab only: serve every frame as a miss, for measuring a study nobody has read.
    #[arg(long, default_value_t = false)]
    force_pool_reads: bool,
    /// Honour `?ask=frame:N` / `?ask=fill:A-B` in the session URL; `--open-ask false` turns it off.
    #[arg(long, default_value_t = true, num_args = 0..=1, default_missing_value = "true", action = clap::ArgAction::Set)]
    open_ask: bool,
    #[arg(long, default_value_t = false, help = "Lab only: take each CONNECT and never answer it")]
    hold_sessions: bool,
    /// Lab only: each session sends this many media bytes, then nothing, with no FIN.
    #[arg(long, value_name = "BYTES")]
    stall_after_bytes: Option<u64>,
    /// Also serve the same envelopes over a WebSocket, TCP on `--port`. docs/ARCHITECTURE.md
    #[arg(long, default_value_t = false)]
    websocket: bool,
}

fn install_crypto_provider() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls crypto provider already installed"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("exact_server=info".parse()?))
        .init();

    install_crypto_provider()?;

    let args = Args::parse();
    let server = run_server(ServeConfig {
        wt_port: args.port,
        study_path: args.study,
        cert_pem: args.cert_pem,
        key_pem: args.key_pem,
        mode: args.stream_mode,
        bind: args.bind,
        tuning: TransportTuning {
            send_window: args.send_window_bytes,
            max_idle_timeout_ms: args.max_idle_timeout_ms,
            keep_alive_interval_ms: args.keep_alive_interval_ms,
            congestion: args.congestion,
            initial_window: args.initial_window_bytes,
            initial_rtt_ms: args.initial_rtt_ms,
            segmentation_offload: args.segmentation_offload,
        },
        force_pool_reads: args.force_pool_reads,
        open_ask: args.open_ask,
        hold_sessions: args.hold_sessions,
        stall_after_bytes: args.stall_after_bytes,
        websocket: args.websocket,
    });

    tokio::select! {
        result = server => result,
        () = shutdown_signal() => {
            tracing::info!("shutdown signal received");
            // Lab builds: write the telemetry report before the process goes away. The harvest
            // sends SIGTERM between runs; without this the drain thread dies with its rows.
            #[cfg(feature = "telemetry")]
            exact_server::record::flush_on_exit();
            Ok(())
        }
    }
}

/// Resolves on SIGINT or SIGTERM.
async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = match signal(SignalKind::terminate()) {
        Ok(stream) => stream,
        Err(err) => {
            tracing::warn!(%err, "SIGTERM handler unavailable; SIGINT only");
            let _ = tokio::signal::ctrl_c().await;
            return;
        }
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(flags: &[&str]) -> Args {
        Args::try_parse_from([&["exact-server", "--study", "s.sbnd"], flags].concat()).expect("parses")
    }

    /// The restart after a silence is the default controller: it won every dropped blink and tied
    /// everywhere else. docs/transport/transport-conclusions.md §3.
    #[test]
    fn the_default_controller_is_cubic_restart() {
        assert_eq!(parse(&[]).congestion, Congestion::CubicRestart);
        assert_eq!(parse(&["--congestion", "cubic"]).congestion, Congestion::Cubic);
    }

    /// The opening ask is on unless turned off, and the bare flag the lab scripts pass still parses.
    #[test]
    fn the_opening_ask_is_on_by_default_with_a_way_off() {
        assert!(parse(&[]).open_ask);
        assert!(parse(&["--open-ask"]).open_ask);
        assert!(!parse(&["--open-ask", "false"]).open_ask);
    }
}
