//! What one frame costs when it is the first thing a session asks for, in four session states
//! and under two levers. S7 says it is slow start and not the link — `lab/page-open/README.md`
//! counts the same thing for a page. `docs/transport/transport-conclusions.md` holds the verdict.
//!
//! Run it through `lab/scripts/link_impair.py`, which the `lossy` and `rebound` states drive
//! over its control port. On loopback every state reads the same and decides nothing.
//!
//! usage: first_ask --url https://127.0.0.1:5555/ --state filled --target 9 --rounds 5
use anyhow::{bail, Context, Result};
use clap::{Parser, ValueEnum};
use fod::{encode_fod_msg, FodMsg};
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::time::{Duration, Instant};
use window_harness::frames::Frames;
use wtransport::{ClientConfig, Endpoint};

#[derive(Clone, Copy, PartialEq, Eq, ValueEnum)]
enum State {
    /// A session that has sent nothing: the controller is at its initial window.
    Fresh,
    /// A fill first, so the ask inherits a window the fill grew.
    Filled,
    /// A fill through a blackout, so the ask inherits a window the loss collapsed.
    Lossy,
    /// A fill, then the relay changes its source port: a new path resets the controller.
    Rebound,
    /// The warm-up rides in the session URL instead, so the bytes the viewer needs anyway are
    /// already moving when the control stream opens. Needs the server's `--open-ask`.
    OpenPush,
}

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "https://127.0.0.1:5555/")]
    url: String,
    #[arg(long, value_enum, default_value_t = State::Fresh)]
    state: State,
    /// Frames the fill takes before the ask. Ignored by `fresh`.
    #[arg(long, default_value_t = 8)]
    warm: u32,
    /// The frame to ask for. Must be one the warm-up did not already deliver.
    #[arg(long, default_value_t = 9)]
    target: u32,
    /// The relay's control port. `lossy` and `rebound` need it.
    #[arg(long, default_value_t = 5556)]
    control_port: u16,
    /// Blackout length for `lossy`, in ms.
    #[arg(long, default_value_t = 300)]
    blackout_ms: u64,
    /// A second blackout this long after the first, whatever the fill is doing by then. 0: one
    /// blackout only. S33: the first one's round-trip sample is what makes the second expensive.
    #[arg(long, default_value_t = 0)]
    blackout_again_after_ms: u64,
    #[arg(long, default_value_t = 5)]
    rounds: u32,
    #[arg(long, default_value_t = 30_000)]
    timeout_ms: u64,
}

fn poke(port: u16, cmd: &str) -> Result<()> {
    UdpSocket::bind("127.0.0.1:0")
        .context("control socket")?
        .send_to(cmd.as_bytes(), ("127.0.0.1", port))
        .context("poke the relay")?;
    Ok(())
}

/// (the ask, the warm-up that preceded it, the frame's size)
async fn one_round(args: &Args) -> Result<(f64, f64, usize)> {
    let v4 = SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), 0);
    let endpoint = Endpoint::client(
        ClientConfig::builder().with_bind_address(v4).with_no_cert_validation().build(),
    )
    .context("wtransport client")?;
    let url = match args.state {
        State::OpenPush => format!("{}?ask=fill:0-{}", args.url, args.warm - 1),
        _ => args.url.clone(),
    };
    let connection = endpoint.connect(&url).await.context("connect")?;
    let mut frames = Frames { connection: connection.clone(), current: None };
    let (mut control, _recv) =
        connection.open_bi().await.context("open bi")?.await.context("bi ready")?;

    if args.state != State::Fresh && args.target < args.warm {
        bail!("--target {} is inside the warm-up 0..={}", args.target, args.warm - 1);
    }
    let mut fill_ms = f64::NAN;
    let filling = Instant::now();
    if args.state == State::OpenPush {
        for _ in 0..args.warm {
            frames.next(args.timeout_ms).await.context("pushed frame")?;
        }
    } else if args.state != State::Fresh {
        control
            // `from..=to` is inclusive, so this is exactly `warm` frames and the ask is the next one.
            .write_all(&encode_fod_msg(&FodMsg::StreamFrames {
                from: Some(0),
                to: Some(args.warm - 1),
            })?)
            .await
            .context("stream_frames")?;
        if args.state == State::Lossy {
            let blackout = format!("blackout {}", args.blackout_ms);
            poke(args.control_port, &blackout)?;
            if args.blackout_again_after_ms > 0 {
                let (port, after) = (args.control_port, args.blackout_again_after_ms);
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(after)).await;
                    let _ = poke(port, &blackout);
                });
            }
        }
        for _ in 0..args.warm {
            frames.next(args.timeout_ms).await.context("warm frame")?;
        }
        fill_ms = filling.elapsed().as_secs_f64() * 1000.0;
        if args.state == State::Rebound {
            poke(args.control_port, "rebind")?;
            // The rebind is only a new path once a packet has travelled over it.
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    let asked = Instant::now();
    control
        .write_all(&encode_fod_msg(&FodMsg::RequestFrame { frame: args.target })?)
        .await
        .context("request_frame")?;
    let (index, bytes) = frames.next(args.timeout_ms).await.context("the ask")?;
    let ms = asked.elapsed().as_secs_f64() * 1000.0;
    if index != args.target {
        bail!("asked for {} and got {index}", args.target);
    }
    connection.close(0u32.into(), b"done");
    Ok((ms, fill_ms, bytes))
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;

    let mut ms = Vec::new();
    let mut fills = Vec::new();
    let mut bytes = 0;
    for _ in 0..args.rounds {
        let (v, f, b) = one_round(&args).await?;
        ms.push(v);
        if !f.is_nan() {
            fills.push(f);
        }
        bytes = b;
    }
    println!(
        "state={} bytes={} rounds={} ask_to_last_byte_ms median={:.1} min={:.1} max={:.1} \
         fill_ms median={:.1}",
        state_name(args.state),
        bytes,
        ms.len(),
        median(&mut ms),
        ms[0],
        ms[ms.len() - 1],
        if fills.is_empty() { f64::NAN } else { median(&mut fills) },
    );
    Ok(())
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).expect("no NaN"));
    v[v.len() / 2]
}

fn state_name(s: State) -> &'static str {
    match s {
        State::Fresh => "fresh",
        State::Filled => "filled",
        State::Lossy => "lossy",
        State::Rebound => "rebound",
        State::OpenPush => "open-push",
    }
}
