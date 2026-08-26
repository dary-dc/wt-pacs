use clap::Parser;
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
    /// Send all frames on one shared uni stream (length-prefixed) instead of one per frame.
    #[arg(long, default_value_t = false)]
    shared_stream: bool,
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
        shared_stream: args.shared_stream,
    })
    .await?;
    Ok(())
}
