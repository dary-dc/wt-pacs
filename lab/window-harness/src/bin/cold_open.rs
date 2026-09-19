//! What a cold open costs, phase by phase, and what one ask on a fresh session costs after it.
//!
//! The counts this checks are `docs/proposal-session-open.md` (four round trips to first byte)
//! and S7 (a 250 KB ask is slow-start-bound, ~5 flights). Run it through
//! `lab/scripts/link_impair.py` — on loopback every phase reads ~0 and decides nothing.
//!
//! usage: cold_open --url https://127.0.0.1:5555/ --rounds 5 --rtt-ms 80
use anyhow::{bail, Context, Result};
use clap::Parser;
use fod::{encode_fod_msg, FodMsg};
use frame_envelope::unwrap;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Instant;
use wtransport::stream::RecvStream;
use wtransport::{ClientConfig, Endpoint};

const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "https://127.0.0.1:5555/")]
    url: String,
    #[arg(long, default_value_t = 5)]
    rounds: u32,
    #[arg(long, default_value_t = 0)]
    frame: u32,
    /// The link's round trip, for reading each phase in round trips rather than milliseconds.
    #[arg(long, default_value_t = 0.0)]
    rtt_ms: f64,
}

struct Round {
    session_ms: f64,
    control_ms: f64,
    first_byte_ms: f64,
    ask_to_last_byte_ms: f64,
    bytes: usize,
}

async fn one_round(args: &Args) -> Result<Round> {
    // A fresh endpoint per round: a cold open is a new socket and a new 4-tuple, not a reused one.
    let v4 = SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), 0);
    let endpoint = Endpoint::client(
        ClientConfig::builder().with_bind_address(v4).with_no_cert_validation().build(),
    )
    .context("wtransport client")?;

    let t0 = Instant::now();
    let connection = endpoint.connect(&args.url).await.context("connect")?;
    let session_ms = ms(t0);

    let (mut control, _recv) =
        connection.open_bi().await.context("open bi")?.await.context("bi ready")?;
    let control_ms = ms(t0);

    let asked = Instant::now();
    control
        .write_all(&encode_fod_msg(&FodMsg::RequestFrame { frame: args.frame })?)
        .await
        .context("request_frame")?;

    let mut uni = connection.accept_uni().await.context("accept uni")?;
    let mut len = [0u8; 4];
    read_exact(&mut uni, &mut len).await?;
    let first_byte_ms = ms(t0);
    let n = u32::from_be_bytes(len) as usize;
    if n == 0 || n > MAX_FRAME_LEN {
        bail!("invalid frame length {n}");
    }
    let mut payload = vec![0u8; n];
    read_exact(&mut uni, &mut payload).await?;
    let ask_to_last_byte_ms = ms(asked);
    let bytes = unwrap(&payload).map(|(_, body)| body.len()).unwrap_or(0);

    connection.close(0u32.into(), b"done");
    Ok(Round { session_ms, control_ms, first_byte_ms, ask_to_last_byte_ms, bytes })
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;

    let mut rows = Vec::new();
    for _ in 0..args.rounds {
        rows.push(one_round(&args).await?);
    }

    let phase = |name: &str, v: Vec<f64>| {
        let m = median(v);
        if args.rtt_ms > 0.0 {
            format!("{name}={m:.1}ms/{:.2}rt ", m / args.rtt_ms)
        } else {
            format!("{name}={m:.1}ms ")
        }
    };
    println!(
        "rounds={} rtt_ms={} bytes={} {}{}{}{}",
        rows.len(),
        args.rtt_ms,
        rows[0].bytes,
        phase("session", rows.iter().map(|r| r.session_ms).collect()),
        phase("control", rows.iter().map(|r| r.control_ms).collect()),
        phase("first_byte", rows.iter().map(|r| r.first_byte_ms).collect()),
        phase("ask_to_last_byte", rows.iter().map(|r| r.ask_to_last_byte_ms).collect()),
    );
    Ok(())
}

fn ms(from: Instant) -> f64 {
    from.elapsed().as_secs_f64() * 1000.0
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).expect("no NaN phase"));
    v[v.len() / 2]
}

async fn read_exact(recv: &mut RecvStream, buf: &mut [u8]) -> Result<()> {
    let mut filled = 0;
    while filled < buf.len() {
        let n = recv.read(&mut buf[filled..]).await?.unwrap_or(0);
        if n == 0 {
            bail!("stream ended early");
        }
        filled += n;
    }
    Ok(())
}
