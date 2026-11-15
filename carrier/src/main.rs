//! The carrier's process: the listeners its configuration names, around one handler.
//! carrier/README.md runs it.
use anyhow::{Context, Result};
use carrier::handoff::Root;
use carrier::tls::{self, AllowList};
use carrier::upload::{Carrier, Limits};
use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

#[derive(Parser)]
struct Config {
    /// Holds `incoming/`, `status/` and `uploads/`; on the receiver's filesystem.
    #[arg(long)]
    root: PathBuf,
    #[arg(long, default_value = "[::]:443")]
    tcp: SocketAddr,
    /// A second listener, HTTP/3 on this UDP address; experimental.
    #[cfg(feature = "quic")]
    #[arg(long)]
    quic: Option<SocketAddr>,
    #[arg(long)]
    cert: PathBuf,
    #[arg(long)]
    key: PathBuf,
    /// `<site> <sha256-hex>` per line, one line per PCS certificate.
    #[arg(long)]
    allow: PathBuf,
    #[arg(long, default_value_t = 8 << 30)]
    max_size: u64,
    #[arg(long, default_value_t = 60)]
    stall_secs: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let config = Config::parse();
    let text = std::fs::read_to_string(&config.allow)
        .with_context(|| format!("{}", config.allow.display()))?;
    let allow =
        Arc::new(AllowList::parse(&text).with_context(|| format!("{}", config.allow.display()))?);
    let tls = tls::server_config(&config.cert, &config.key, allow.clone())?;
    let limits = Limits {
        max_size: config.max_size,
        stall: Duration::from_secs(config.stall_secs),
    };
    let carrier = Arc::new(Carrier::new(Root::open(&config.root)?, limits));
    let listener = tokio::net::TcpListener::bind(config.tcp)
        .await
        .with_context(|| format!("TCP {}", config.tcp))?;
    tracing::info!(addr = %config.tcp, "listening, HTTP/1.1 over TLS on TCP");
    #[cfg(feature = "quic")]
    if let Some(addr) = config.quic {
        let endpoint = carrier::quic::bind(addr, tls.clone())?;
        tracing::warn!(%addr, "listening, HTTP/3 on QUIC: experimental (h3 0.0.8)");
        tokio::spawn(carrier::quic::serve(
            endpoint,
            allow.clone(),
            carrier.clone(),
        ));
    }
    carrier::tcp::serve(listener, tls, allow, carrier).await;
    Ok(())
}
