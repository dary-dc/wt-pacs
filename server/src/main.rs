use clap::Parser;
use exact_server::{run_server, ServeConfig};
use exact_server::transport::{Congestion, SendPath, StreamMode, TransportTuning};
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
    /// Bind IP. Omit for dual-stack ANY; set (e.g. `127.0.0.1`) on hosts without IPv6.
    #[arg(long)]
    bind: Option<std::net::IpAddr>,

    // ---- QUIC transport knobs. Unset = quinn's own default. ----
    /// Per-stream flow-control window in bytes (quinn default 1250000).
    #[arg(long)]
    stream_receive_window: Option<u64>,
    /// Connection-wide receive window in bytes (quinn default: unlimited).
    #[arg(long)]
    receive_window: Option<u64>,
    /// Cap on buffered unacknowledged send bytes (quinn default 10000000).
    #[arg(long)]
    send_window: Option<u64>,
    /// Round-robin between same-priority streams (quinn default true).
    #[arg(long)]
    send_fairness: Option<bool>,
    /// Starting MTU before DPLMTUD raises it (quinn default 1200).
    #[arg(long)]
    initial_mtu: Option<u16>,
    /// Path MTU discovery (RFC 8899). On by default, as in quinn.
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    mtu_discovery: bool,
    #[arg(long, value_enum, default_value_t = Congestion::Cubic)]
    congestion: Congestion,
    /// QUIC ACK-frequency extension (off by default, as in quinn).
    #[arg(long, default_value_t = false, action = clap::ArgAction::Set)]
    ack_frequency: bool,
    /// UDP generic segmentation offload (on by default, as in quinn).
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    segmentation_offload: bool,
    /// SO_SNDBUF in bytes. Unset leaves the OS default.
    #[arg(long)]
    socket_send_buffer: Option<usize>,
    /// SO_RCVBUF in bytes. Unset leaves the OS default.
    #[arg(long)]
    socket_recv_buffer: Option<usize>,
    /// How frame bytes reach the send buffer. See `docs/quic-transport-optimization.md`.
    #[arg(long, value_enum, default_value_t = SendPath::Chunked)]
    send_path: SendPath,
}

/// Install the rustls provider selected at compile time (`crypto-ring` by default,
/// `crypto-aws-lc-rs` for AWS-LC's vectorised AES-GCM). Exactly one is ever enabled.
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
        bind_ip: args.bind,
        tuning: TransportTuning {
            stream_receive_window: args.stream_receive_window,
            receive_window: args.receive_window,
            send_window: args.send_window,
            send_fairness: args.send_fairness,
            initial_mtu: args.initial_mtu,
            mtu_discovery: args.mtu_discovery,
            congestion: args.congestion,
            ack_frequency: args.ack_frequency,
            segmentation_offload: args.segmentation_offload,
            socket_send_buffer: args.socket_send_buffer,
            socket_recv_buffer: args.socket_recv_buffer,
            send_path: args.send_path,
        },
    })
    .await?;
    Ok(())
}
