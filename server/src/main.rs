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
    /// Fault frame pages in from a blocking thread before writing. On by default.
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    prefault: bool,
    /// Lab builds: rebuild the full telemetry JSON, exact, from a `.rows` file and exit.
    #[cfg(feature = "telemetry")]
    #[arg(long, value_name = "ROWS")]
    telemetry_report: Option<PathBuf>,
    /// Lab builds: where `--telemetry-report` writes (default: `<rows>.exact.json`).
    #[cfg(feature = "telemetry")]
    #[arg(long, value_name = "JSON")]
    telemetry_report_out: Option<PathBuf>,

    /// Per-frame only: set QUIC stream priority by ask order. L1 arm Q.
    #[cfg(feature = "lab")]
    #[arg(long, default_value_t = false)]
    ask_priority: bool,
    /// Round-robin between same-priority streams (quinn default true).
    #[cfg(feature = "lab")]
    #[arg(long)]
    send_fairness: Option<bool>,
    /// UDP generic segmentation offload (on by default, as in quinn).
    #[cfg(feature = "lab")]
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    segmentation_offload: bool,
    /// Starting MTU before DPLMTUD raises it (quinn default 1200).
    #[cfg(feature = "lab")]
    #[arg(long)]
    initial_mtu: Option<u16>,
    /// Path MTU discovery (RFC 8899). On by default, as in quinn.
    #[cfg(feature = "lab")]
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    mtu_discovery: bool,
    /// QUIC ACK-frequency extension (off by default, as in quinn).
    #[cfg(feature = "lab")]
    #[arg(long, default_value_t = false, action = clap::ArgAction::Set)]
    ack_frequency: bool,
    /// SO_SNDBUF in bytes. Unset leaves the OS default.
    #[cfg(feature = "lab")]
    #[arg(long)]
    socket_send_buffer: Option<usize>,
    /// SO_RCVBUF in bytes. Unset leaves the OS default.
    #[cfg(feature = "lab")]
    #[arg(long)]
    socket_recv_buffer: Option<usize>,
    /// How frame bytes reach the send buffer. See `docs/quic-transport-optimization.md`.
    #[cfg(feature = "lab")]
    #[arg(long, value_enum, default_value_t = exact_server::SendPath::Chunked)]
    send_path: exact_server::SendPath,
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
        #[cfg(feature = "lab")]
        ask_priority: args.ask_priority,
        tuning: TransportTuning {
            receive_window: args.receive_window,
            stream_receive_window: args.stream_receive_window_bytes,
            send_window: args.send_window_bytes,
            max_idle_timeout_ms: args.max_idle_timeout_ms,
            congestion: args.congestion,
            #[cfg(feature = "lab")]
            send_fairness: args.send_fairness,
            #[cfg(feature = "lab")]
            segmentation_offload: args.segmentation_offload,
            #[cfg(feature = "lab")]
            initial_mtu: args.initial_mtu,
            #[cfg(feature = "lab")]
            mtu_discovery: args.mtu_discovery,
            #[cfg(feature = "lab")]
            ack_frequency: args.ack_frequency,
            #[cfg(feature = "lab")]
            socket_send_buffer: args.socket_send_buffer,
            #[cfg(feature = "lab")]
            socket_recv_buffer: args.socket_recv_buffer,
            #[cfg(feature = "lab")]
            send_path: args.send_path,
            #[cfg(not(feature = "lab"))]
            send_path: exact_server::SendPath::Chunked,
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
