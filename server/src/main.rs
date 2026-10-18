use clap::Parser;
use series_server::{run_server, ServeConfig};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "series-server")]
struct Args {
    #[command(flatten)]
    serve: ServeConfig,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("series_server=info".parse()?))
        .init();

    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls crypto provider already installed"))?;

    let stop = async {
        shutdown_signal().await;
        tracing::info!("shutdown signal received");
    };
    run_server(Args::parse().serve, stop).await?;
    // Lab builds: write the telemetry report before the process goes away. The harvest
    // sends SIGTERM between runs; without this the drain thread dies with its rows.
    #[cfg(feature = "telemetry")]
    series_server::record::flush_on_exit();
    Ok(())
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

#[cfg(test)]
mod tests;
