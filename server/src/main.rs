use clap::Parser;
use exact_server::{run_server, ServeConfig, StreamMode};
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
    })
    .await?;
    Ok(())
}
