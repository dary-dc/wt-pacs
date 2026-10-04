//! How long an ask waits when it arrives during a running fill, and what the fill pays for it.
//!
//! The lane's premise was that the two share the connection. They do not: the planner drops the
//! fill the moment any ask is in hand (`server/src/transport/planner.rs`), so the ask does not
//! overtake the fill, it replaces it. This measures what that costs. docs/WIRE.md
//!
//! usage: ask_during_fill --url https://127.0.0.1:4433 --frames 200 --at-pct 50 --rounds 5
use anyhow::{Context, Result};
use clap::Parser;
use fod::{encode_fod_msg, FodMsg};
use std::time::{Duration, Instant};
use wtransport::{ClientConfig, Endpoint};

#[derive(Parser)]
struct Args {
    #[arg(long)]
    url: String,
    #[arg(long, default_value_t = 200)]
    frames: u32,
    /// Where in the fill the ask lands, as a percentage of the study.
    #[arg(long, default_value_t = 50)]
    at_pct: u32,
    #[arg(long, default_value_t = 5)]
    rounds: u32,
    /// Frame to ask for: one the fill has not reached. Default: the last frame.
    #[arg(long)]
    target: Option<u32>,
}

struct Round {
    ask_to_last_byte_ms: f64,
    fill_frames_before: u32,
    fill_frames_after: u32,
    frames_between: u32,
}

async fn one_round(endpoint: &Endpoint<wtransport::endpoint::endpoint_side::Client>, args: &Args) -> Result<Round> {
    let connection = endpoint.connect(args.url.clone()).await.context("connect")?;
    let mut bi = connection.open_bi().await.context("open bi")?.await.context("bi ready")?;

    let switch_at = (args.frames * args.at_pct / 100).max(1);
    let target = args.target.unwrap_or(args.frames - 1);

    bi.0.write_all(&encode_fod_msg(&FodMsg::StreamFrames { from: None, to: None })?)
        .await
        .context("stream_frames")?;

    let mut before = 0u32;
    let mut after = 0u32;
    let mut between = 0u32;
    let mut asked: Option<Instant> = None;
    let mut ask_ms = f64::NAN;

    loop {
        let mut uni = match tokio::time::timeout(Duration::from_secs(20), connection.accept_uni()).await {
            Ok(Ok(u)) => u,
            _ => break,
        };
        // One uni carries one or more `[4B BE len][4B BE index][payload]` envelopes.
        loop {
            let mut len = [0u8; 4];
            if uni.read_exact(&mut len).await.is_err() {
                break;
            }
            let n = u32::from_be_bytes(len) as usize;
            let mut body = vec![0u8; n];
            if uni.read_exact(&mut body).await.is_err() {
                break;
            }
            let idx = u32::from_be_bytes([body[0], body[1], body[2], body[3]]);

            if let Some(t) = asked {
                if idx == target {
                    ask_ms = t.elapsed().as_secs_f64() * 1000.0;
                    asked = None;
                } else {
                    between += 1;
                    after += 1;
                }
            } else if ask_ms.is_nan() {
                before += 1;
            } else {
                after += 1;
            }

            if before == switch_at && asked.is_none() && ask_ms.is_nan() {
                bi.0.write_all(&encode_fod_msg(&FodMsg::RequestFrame { frame: target })?)
                    .await
                    .context("request_frame")?;
                asked = Some(Instant::now());
            }
        }
        if !ask_ms.is_nan() {
            // Give the server a moment to prove whether the fill resumes on its own.
            tokio::time::sleep(Duration::from_millis(300)).await;
            if tokio::time::timeout(Duration::from_millis(200), connection.accept_uni()).await.is_err() {
                break;
            }
            after += 1;
        }
    }
    connection.close(0u32.into(), b"done");
    Ok(Round { ask_to_last_byte_ms: ask_ms, fill_frames_before: before, fill_frames_after: after, frames_between: between })
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;
    // A host with no dual-stack refuses the default bind; every other driver here falls back the same way.
    let endpoint = match Endpoint::client(
        ClientConfig::builder().with_bind_default().with_no_cert_validation().build(),
    ) {
        Ok(ep) => ep,
        Err(_) => {
            let v4 = std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 0);
            Endpoint::client(
                ClientConfig::builder().with_bind_address(v4).with_no_cert_validation().build(),
            )
            .context("wtransport client (IPv4)")?
        }
    };

    let mut rows = Vec::new();
    for _ in 0..args.rounds {
        rows.push(one_round(&endpoint, &args).await?);
    }
    let mut ms: Vec<f64> = rows.iter().map(|r| r.ask_to_last_byte_ms).filter(|v| !v.is_nan()).collect();
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = if ms.is_empty() { f64::NAN } else { ms[ms.len() / 2] };
    println!(
        "at_pct={} target={} rounds={} ask_to_last_byte_ms median={:.2} min={:.2} max={:.2} \
         fill_before_median={} fill_after_median={} frames_between_median={}",
        args.at_pct,
        args.target.unwrap_or(args.frames - 1),
        rows.len(),
        med,
        ms.first().copied().unwrap_or(f64::NAN),
        ms.last().copied().unwrap_or(f64::NAN),
        median_u32(rows.iter().map(|r| r.fill_frames_before)),
        median_u32(rows.iter().map(|r| r.fill_frames_after)),
        median_u32(rows.iter().map(|r| r.frames_between)),
    );
    Ok(())
}

fn median_u32(it: impl Iterator<Item = u32>) -> u32 {
    let mut v: Vec<u32> = it.collect();
    v.sort_unstable();
    v.get(v.len() / 2).copied().unwrap_or(0)
}
