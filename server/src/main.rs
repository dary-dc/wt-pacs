use clap::Parser;
use exact_server::{run_server, ServeConfig, StreamMode};
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
    /// How frames reach the client: one shared uni stream or one per frame.
    #[arg(long, value_enum, default_value_t = StreamMode::PerFrame)]
    stream_mode: StreamMode,
    /// Bind address for the QUIC endpoint. Default: dual-stack `[::]`, falling back to
    /// `0.0.0.0` when the host has no IPv6.
    #[arg(long)]
    bind: Option<IpAddr>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("exact_server=info".parse()?))
        .init();

    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;

    let args = Args::parse();
    let server = run_server(ServeConfig {
        wt_port: args.port,
        study_path: args.study,
        cert_pem: args.cert_pem,
        key_pem: args.key_pem,
        mode: args.stream_mode,
        bind: args.bind,
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
