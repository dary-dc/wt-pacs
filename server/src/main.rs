use clap::Parser;
use exact_server::transport::{Congestion, StreamMode, TransportTuning};
use exact_server::{run_server, ServeConfig};
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
    #[arg(long, value_enum, default_value_t = StreamMode::Shared)]
    stream_mode: StreamMode,
    /// Bind IP. Omit for dual-stack ANY; set (e.g. `127.0.0.1`) on hosts without IPv6.
    #[arg(long)]
    bind: Option<std::net::IpAddr>,
    /// Connection-wide receive window in bytes (quinn default: unlimited).
    #[arg(long)]
    receive_window: Option<u64>,
    /// Cap on buffered unacknowledged send bytes (quinn default 10000000).
    #[arg(long)]
    send_window: Option<u64>,
    #[arg(long, value_enum, default_value_t = Congestion::Cubic)]
    congestion: Congestion,
    /// Fault frame pages in from a blocking thread before writing. On by default.
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    prefault: bool,

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
    /// Per-stream flow-control window in bytes (quinn default 1250000).
    #[cfg(feature = "lab")]
    #[arg(long)]
    stream_receive_window: Option<u64>,
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
    #[arg(long, value_enum, default_value_t = exact_server::transport::SendPath::Chunked)]
    send_path: exact_server::transport::SendPath,
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
    run_server(ServeConfig {
        wt_port: args.port,
        study_path: args.study,
        cert_pem: args.cert_pem,
        key_pem: args.key_pem,
        mode: args.stream_mode,
        #[cfg(feature = "lab")]
        ask_priority: args.ask_priority,
        bind_ip: args.bind,
        tuning: TransportTuning {
            receive_window: args.receive_window,
            send_window: args.send_window,
            congestion: args.congestion,
            #[cfg(feature = "lab")]
            send_fairness: args.send_fairness,
            #[cfg(feature = "lab")]
            segmentation_offload: args.segmentation_offload,
            #[cfg(feature = "lab")]
            stream_receive_window: args.stream_receive_window,
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
            send_path: exact_server::transport::SendPath::Chunked,
            prefault: args.prefault,
        },
    })
    .await?;
    Ok(())
}
