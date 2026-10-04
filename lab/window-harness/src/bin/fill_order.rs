//! S21: a fill asked coarse to fine — every 8th frame, then every 4th … — against the sequential
//! order, each frame asked exactly once. What it moves is time-to-scrubbable, not total fill time;
//! `--force-pool-reads` on the server says what the permuted order costs the read path.
//! `docs/transport/transport-conclusions.md` §3, the fill's order.
//!
//! usage: fill_order --url https://127.0.0.1:5555/ --frames 200 --depth 4 --order coarse
use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use fod::{encode_fod_msg, FodMsg};
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Instant;
use window_harness::frames::Frames;
use wtransport::{ClientConfig, Endpoint};

#[derive(Clone, Copy, PartialEq, Eq, ValueEnum)]
enum Order {
    Sequential,
    Coarse,
}

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "https://127.0.0.1:5555/")]
    url: String,
    #[arg(long, default_value_t = 200)]
    frames: u32,
    /// Outstanding asks. The order only matters at a depth the link can keep busy.
    #[arg(long, default_value_t = 4)]
    depth: u32,
    #[arg(long, value_enum, default_value_t = Order::Sequential)]
    order: Order,
    /// The coarse pass, and the milestone: every `stride`-th frame in hand.
    #[arg(long, default_value_t = 8)]
    stride: u32,
    #[arg(long, default_value_t = 3)]
    rounds: u32,
    #[arg(long, default_value_t = 120_000)]
    timeout_ms: u64,
}

/// Every index once: the coarse pass first, then each halving, skipping what is already asked.
fn plan(args: &Args) -> Vec<u32> {
    if args.order == Order::Sequential {
        return (0..args.frames).collect();
    }
    let mut asked = vec![false; args.frames as usize];
    let mut out = Vec::with_capacity(args.frames as usize);
    let mut step = args.stride.max(1);
    loop {
        for i in (0..args.frames).step_by(step as usize) {
            if !asked[i as usize] {
                asked[i as usize] = true;
                out.push(i);
            }
        }
        if step == 1 {
            break;
        }
        step /= 2;
    }
    out
}

/// (whole fill, every `stride`-th frame in hand)
async fn one_round(args: &Args, plan: &[u32]) -> Result<(f64, f64)> {
    let v4 = SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), 0);
    let endpoint = Endpoint::client(
        ClientConfig::builder().with_bind_address(v4).with_no_cert_validation().build(),
    )
    .context("wtransport client")?;
    let connection = endpoint.connect(&args.url).await.context("connect")?;
    let (mut control, _recv) =
        connection.open_bi().await.context("open bi")?.await.context("bi ready")?;
    let mut frames = Frames { connection: connection.clone(), current: None };

    let t0 = Instant::now();
    let mut next = 0usize;
    let mut sent = 0usize;
    let mut coarse_left = plan.iter().filter(|i| *i % args.stride == 0).count();
    let mut coarse_ms = f64::NAN;
    while sent < plan.len() && sent < args.depth as usize {
        control
            .write_all(&encode_fod_msg(&FodMsg::RequestFrame { frame: plan[sent] })?)
            .await
            .context("request_frame")?;
        sent += 1;
    }
    while next < plan.len() {
        let (index, _) = frames.next(args.timeout_ms).await.context("frame")?;
        next += 1;
        if index % args.stride == 0 {
            coarse_left -= 1;
            if coarse_left == 0 {
                coarse_ms = t0.elapsed().as_secs_f64() * 1000.0;
            }
        }
        if sent < plan.len() {
            control
                .write_all(&encode_fod_msg(&FodMsg::RequestFrame { frame: plan[sent] })?)
                .await
                .context("request_frame")?;
            sent += 1;
        }
    }
    let total = t0.elapsed().as_secs_f64() * 1000.0;
    connection.close(0u32.into(), b"done");
    Ok((total, coarse_ms))
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;
    let plan = plan(&args);
    assert_eq!(plan.len(), args.frames as usize, "every frame exactly once");

    let mut totals = Vec::new();
    let mut coarse = Vec::new();
    for _ in 0..args.rounds {
        let (t, c) = one_round(&args, &plan).await?;
        totals.push(t);
        coarse.push(c);
    }
    println!(
        "order={} frames={} depth={} stride={} rounds={} fill_ms={:.0} every_{}th_ms={:.0}",
        match args.order {
            Order::Sequential => "sequential",
            Order::Coarse => "coarse",
        },
        args.frames,
        args.depth,
        args.stride,
        args.rounds,
        median(&mut totals),
        args.stride,
        median(&mut coarse),
    );
    Ok(())
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).expect("no NaN"));
    v[v.len() / 2]
}
