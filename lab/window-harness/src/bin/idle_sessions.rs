//! Open N sessions, hold them idle, then prove each still works. What an idle held session
//! costs is measured from outside by `lab/scripts/idle_session_cost.sh`; this only creates the
//! condition and reports which sessions survived. docs/transport/adr-idle-sessions.md.
//!
//! usage: idle_sessions --url https://127.0.0.1:4433 --sessions 50 --hold-secs 60 [--keep-alive-secs 3]
use anyhow::{Context, Result};
use clap::Parser;
use std::time::Duration;
use wtransport::{ClientConfig, Endpoint};

#[derive(Parser)]
struct Args {
    #[arg(long)]
    url: String,
    #[arg(long, default_value_t = 1)]
    sessions: usize,
    #[arg(long, default_value_t = 30)]
    hold_secs: u64,
    /// Omit for no keep-alive at all, which is the browser's position today.
    #[arg(long)]
    keep_alive_secs: Option<u64>,
    /// Written when every session is open and idle, so the sampler knows when to start.
    #[arg(long)]
    ready_file: Option<String>,
}

fn client_config(args: &Args, bind: Option<std::net::SocketAddr>) -> ClientConfig {
    let builder = match bind {
        None => ClientConfig::builder().with_bind_default(),
        Some(addr) => ClientConfig::builder().with_bind_address(addr),
    }
    .with_no_cert_validation();
    match args.keep_alive_secs {
        Some(s) => builder
            .keep_alive_interval(Some(Duration::from_secs(s)))
            .build(),
        None => builder.build(),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;

    // A host with no dual-stack refuses the default bind; the harness client falls back the same way.
    let endpoint = match Endpoint::client(client_config(&args, None)) {
        Ok(ep) => ep,
        Err(_) => {
            let v4 = std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 0);
            Endpoint::client(client_config(&args, Some(v4))).context("wtransport client (IPv4)")?
        }
    };

    let mut sessions = Vec::with_capacity(args.sessions);
    for i in 0..args.sessions {
        let connection = endpoint
            .connect(args.url.clone())
            .await
            .with_context(|| format!("connect session {i}"))?;
        // The product opens its control stream when it opens the session, and then says nothing.
        let bi = connection.open_bi().await.context("open bi")?.await.context("bi ready")?;
        sessions.push((connection, bi));
    }
    println!("opened {} session(s)", sessions.len());

    if let Some(path) = args.ready_file.as_ref() {
        std::fs::write(path, format!("{}\n", sessions.len())).context("ready file")?;
    }

    tokio::time::sleep(Duration::from_secs(args.hold_secs)).await;

    // A session is alive if it can still be used, not if the handle still exists.
    let mut alive = 0usize;
    let mut first_error = None;
    let ask = fod::encode_fod_msg(&fod::FodMsg::RequestFrame { frame: 0 })?;
    for (_connection, (send, _recv)) in sessions.iter_mut() {
        match send.write_all(&ask).await {
            Ok(()) => alive += 1,
            Err(err) => {
                if first_error.is_none() {
                    first_error = Some(format!("{err}"));
                }
            }
        }
    }
    println!(
        "after {} s idle: {}/{} still usable{}",
        args.hold_secs,
        alive,
        args.sessions,
        first_error.map(|e| format!(" (first failure: {e})")).unwrap_or_default()
    );
    if alive != args.sessions {
        std::process::exit(1);
    }
    Ok(())
}
