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
    #[cfg_attr(
        feature = "telemetry",
        arg(long, required_unless_present = "telemetry_report")
    )]
    #[cfg_attr(not(feature = "telemetry"), arg(long, required = true))]
    study: Option<PathBuf>,
    #[arg(long, default_value = "server/dev-cert/cert.pem")]
    cert_pem: PathBuf,
    #[arg(long, default_value = "server/dev-cert/key.pem")]
    key_pem: PathBuf,
    /// How frames reach the client: one shared uni stream or one per frame.
    #[arg(long, value_enum, default_value_t = StreamMode::Shared)]
    stream_mode: StreamMode,
    /// Bind address for the QUIC endpoint. Default: dual-stack `[::]`, falling back to
    /// `0.0.0.0` when the host has no IPv6.
    #[arg(long)]
    bind: Option<IpAddr>,
    /// Connection-wide receive window in bytes (quinn default: unlimited).
    #[arg(long)]
    receive_window: Option<u64>,
    /// QUIC send window per connection in bytes (unacknowledged data held). Default: library
    /// default, 10 MB. Bounds memory under slow clients: N sessions × this value.
    /// `--send-window` is the name lab scripts already pass.
    #[arg(long, visible_alias = "send-window")]
    send_window_bytes: Option<u64>,
    /// QUIC per-stream receive window in bytes. Default: library default, 1.25 MB.
    #[arg(long, visible_alias = "stream-receive-window")]
    stream_receive_window_bytes: Option<u64>,
    /// QUIC idle timeout in milliseconds. Default: library default, 30 000.
    #[arg(long)]
    max_idle_timeout_ms: Option<u64>,
    #[arg(long, value_enum, default_value_t = Congestion::Cubic)]
    congestion: Congestion,
    /// Unused on this build: page-touch is a mapping path. Kept so lab flags still parse.
    #[arg(long, default_value_t = false, action = clap::ArgAction::Set)]
    prefault: bool,
    /// Rebuild the full telemetry JSON, exact, from a `.rows` file and exit.
    #[cfg(feature = "telemetry")]
    #[arg(long, value_name = "ROWS")]
    telemetry_report: Option<PathBuf>,
    /// Where `--telemetry-report` writes (default: `<rows>.exact.json`).
    #[cfg(feature = "telemetry")]
    #[arg(long, value_name = "JSON")]
    telemetry_report_out: Option<PathBuf>,
}

/// Install the rustls provider selected at compile time (`crypto-ring` by default).
fn install_crypto_provider() -> anyhow::Result<()> {
    #[cfg(feature = "crypto-aws-lc-rs")]
    let provider = rustls::crypto::aws_lc_rs::default_provider();
    #[cfg(not(feature = "crypto-aws-lc-rs"))]
    let provider = rustls::crypto::ring::default_provider();

    provider
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

    #[cfg(feature = "telemetry")]
    if let Some(rows) = &args.telemetry_report {
        let out = args
            .telemetry_report_out
            .clone()
            .unwrap_or_else(|| rows.with_extension("exact.json"));
        exact_server::record::write_report_from_rows(rows, &out)?;
        println!("telemetry_report={}", out.display());
        return Ok(());
    }

    let study_path = args
        .study
        .ok_or_else(|| anyhow::anyhow!("--study is required"))?;
    let server = run_server(ServeConfig {
        wt_port: args.port,
        study_path,
        cert_pem: args.cert_pem,
        key_pem: args.key_pem,
        mode: args.stream_mode,
        bind: args.bind,
        tuning: TransportTuning {
            receive_window: args.receive_window,
            stream_receive_window: args.stream_receive_window_bytes,
            send_window: args.send_window_bytes,
            max_idle_timeout_ms: args.max_idle_timeout_ms,
            congestion: args.congestion,
            prefault: args.prefault,
        },
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
