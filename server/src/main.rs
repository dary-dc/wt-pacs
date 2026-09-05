use clap::Parser;
use exact_server::transport::StreamMode;
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
    #[arg(long, value_enum, default_value_t = StreamMode::PerFrame)]
    stream_mode: StreamMode,
    /// MiB of process-private frame cache. A frame asked twice is held here, and later
    /// asks for it cost no read at all — measured ~19% less server CPU per frame at full
    /// residency (docs/disk-access/SEND-BUDGET.md). `0` disables the cache.
    #[arg(long, default_value_t = 0)]
    frame_cache_mb: usize,
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
    run_server(ServeConfig {
        wt_port: args.port,
        study_path: args.study,
        cert_pem: args.cert_pem,
        key_pem: args.key_pem,
        mode: args.stream_mode,
        frame_cache_bytes: args.frame_cache_mb * 1024 * 1024,
    })
    .await?;
    Ok(())
}
