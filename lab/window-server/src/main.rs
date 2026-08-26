//! Lab-only server for window-depth × priority experiment.
//! Not product — exact-server stays FIFO without experiment flags.

mod session;

use anyhow::{Context, Result};
use clap::Parser;
use exact_server::media::frame_store::FrameStore;
use exact_server::transport::tls::load_pem_cert;
use session::{run_session, QueueOrder, QueuePolicy};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;
use wtransport::{Endpoint, Identity, ServerConfig};

#[derive(Parser)]
#[command(name = "window-server")]
struct Args {
    #[arg(long, default_value = "4433")]
    port: u16,
    #[arg(long)]
    study: PathBuf,
    #[arg(long, default_value = "server/dev-cert/cert.pem")]
    cert_pem: PathBuf,
    #[arg(long, default_value = "server/dev-cert/key.pem")]
    key_pem: PathBuf,
    /// fifo | generation
    #[arg(long, default_value = "fifo")]
    order: String,
    /// 0 = uncapped concurrent uni sends; 1 = cap at one in flight.
    #[arg(long, default_value_t = 0)]
    stream_cap: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("window_server=info".parse()?))
        .init();

    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;

    let args = Args::parse();
    let order = match args.order.to_ascii_lowercase().as_str() {
        "generation" | "gen" => QueueOrder::Generation,
        _ => QueueOrder::Fifo,
    };
    let policy = QueuePolicy {
        order,
        stream_cap: args.stream_cap,
    };

    run_lab_server(args, policy).await
}

async fn run_lab_server(args: Args, policy: QueuePolicy) -> Result<()> {
    let cert_pem = std::fs::read_to_string(&args.cert_pem)
        .with_context(|| format!("read {}", args.cert_pem.display()))?;
    let key_pem = std::fs::read_to_string(&args.key_pem)
        .with_context(|| format!("read {}", args.key_pem.display()))?;
    let cert = load_pem_cert(&cert_pem, &key_pem)?;

    let identity = Identity::load_pemfiles(&args.cert_pem, &args.key_pem)
        .await
        .context("load wtransport identity")?;

    let server_config = ServerConfig::builder()
        .with_bind_default(args.port)
        .with_identity(identity)
        .build();

    let endpoint = Endpoint::server(server_config).context("wtransport endpoint")?;
    let store = Arc::new(FrameStore::open(&args.study).context("open study")?);

    let wt_url = format!("https://127.0.0.1:{}/", args.port);
    println!("wt_url={wt_url}");
    println!("cert_sha256={}", cert.sha256_hex());
    println!("study={}", args.study.display());
    println!("frames={}", store.frame_count());
    println!("lab=window-server");
    println!(
        "queue_order={}",
        match policy.order {
            QueueOrder::Fifo => "fifo",
            QueueOrder::Generation => "generation",
        }
    );
    println!("queue_stream_cap={}", policy.stream_cap);
    println!("queue_arm={}", policy.arm_label());
    info!(
        %wt_url,
        arm = %policy.arm_label(),
        "window-server ready (lab only)"
    );

    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store, policy).await {
                warn!(%err, "session ended");
            }
        });
    }
}

async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    store: Arc<FrameStore>,
    policy: QueuePolicy,
) -> Result<()> {
    let session_request = incoming.await.context("incoming session")?;
    let connection = session_request.accept().await.context("accept session")?;
    let (control_send, control_recv) = connection
        .accept_bi()
        .await
        .context("accept control bidi")?;
    run_session(connection, control_send, control_recv, store, policy).await
}
