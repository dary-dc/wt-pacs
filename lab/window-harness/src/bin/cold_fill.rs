//! A cold fill of the whole series, timed from the dial: the native client's `--fill` over `wt-pacs/1`
//! against a WebTransport session that asks the same fill with `?ask=` in its URL. Every frame is matched
//! byte for byte with the bundle's entry. `docs/native/README.md` §8.5.
//!
//! usage: cold_fill --arm raw|webtransport --url https://127.0.0.1:5555/ --cert-sha256 HEX --bundle PATH
use anyhow::{bail, ensure, Context, Result};
use clap::{Parser, ValueEnum};
use frame_envelope::MAX_FRAME_LEN;
use native_client::transport::{dial, Event, Windows};
use std::net::{Ipv4Addr, SocketAddr};
use std::os::unix::fs::FileExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use wtransport::config::QuicTransportConfig;
use wtransport::quinn::VarInt;
use wtransport::tls::client::{build_default_tls_config, NoServerVerification};
use wtransport::{ClientConfig, Endpoint};

#[derive(Clone, Copy, ValueEnum)]
enum Arm {
    Raw,
    Webtransport,
}

#[derive(Parser)]
struct Args {
    #[arg(long, value_enum)]
    arm: Arm,
    #[arg(long)]
    url: String,
    #[arg(long)]
    cert_sha256: String,
    #[arg(long)]
    bundle: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let bundle = std::fs::File::open(&args.bundle).with_context(|| format!("open {}", args.bundle.display()))?;
    let layout = series_bundle::read_layout(&bundle)?;
    let want: Vec<Vec<u8>> = layout.index.iter()
        .map(|&(at, len)| {
            let mut b = vec![0; len as usize];
            bundle.read_exact_at(&mut b, at).map(|_| b)
        })
        .collect::<std::io::Result<_>>()?;
    let windows = Windows::default();
    let last = want.len() as u32 - 1;

    let t0 = Instant::now();
    let arrivals = match args.arm {
        Arm::Raw => raw(&args, &windows, last).await?,
        Arm::Webtransport => webtransport(&args, &windows, last).await?,
    };
    let identical = arrivals.iter().filter(|(i, body, _)| want.get(*i as usize) == Some(body)).count();
    ensure!(arrivals.len() == want.len(), "{} frames of {}", arrivals.len(), want.len());
    let ms = |at: Instant| (at - t0).as_secs_f64() * 1e3;
    let first = arrivals.iter().map(|a| a.2).min().context("no frame")?;
    let done = arrivals.iter().map(|a| a.2).max().context("no frame")?;
    println!(
        "{{\"arm\":\"{}\",\"stream_window\":{},\"connection_window\":{},\"frames\":{},\"identical\":{},\
         \"first_ms\":{:.3},\"last_ms\":{:.3}}}",
        args.arm.to_possible_value().unwrap().get_name(),
        windows.stream,
        windows.connection,
        arrivals.len(),
        identical,
        ms(first),
        ms(done),
    );
    if identical != want.len() {
        bail!("{} frames not identical to the bundle", want.len() - identical);
    }
    Ok(())
}

type Arrivals = Vec<(u32, Vec<u8>, Instant)>;

async fn raw(args: &Args, windows: &Windows, last: u32) -> Result<Arrivals> {
    let hash = (0..32)
        .map(|i| args.cert_sha256.get(2 * i..2 * i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .collect::<Option<Vec<u8>>>()
        .and_then(|h| h.try_into().ok())
        .context("--cert-sha256 is not 64 hex digits")?;
    let mut session = dial(&args.url, hash, windows).await?;
    session.fill(0, last).await?;
    let mut out = Vec::new();
    while out.len() <= last as usize {
        match session.next().await.context("the session ended with frames owed")?? {
            Event::Frame { index, body, at } => out.push((index, body.to_vec(), at)),
            Event::Refused { frame, reason } => bail!("frame {frame} refused: {reason}"),
        }
    }
    session.close();
    Ok(out)
}

/// The fill rides the session's CONNECT, so nothing is written on the control stream.
async fn webtransport(args: &Args, windows: &Windows, last: u32) -> Result<Arrivals> {
    let tls = build_default_tls_config(Arc::new(rustls::RootCertStore::empty()), Some(Arc::new(NoServerVerification::new())));
    let mut transport = QuicTransportConfig::default();
    transport.stream_receive_window(VarInt::from_u64(windows.stream)?);
    transport.receive_window(VarInt::from_u64(windows.connection)?);
    let v4 = SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), 0);
    let endpoint = Endpoint::client(
        ClientConfig::builder().with_bind_address(v4).with_custom_tls_and_transport(tls, transport).build(),
    )?;
    let connection = endpoint.connect(format!("{}?ask=fill:0-{last}", args.url)).await.context("connect")?;
    let mut out = Vec::new();
    while out.len() <= last as usize {
        let mut uni = connection.accept_uni().await?;
        while out.len() <= last as usize {
            let mut len = [0u8; 4];
            if uni.read_exact(&mut len).await.is_err() {
                break;
            }
            let n = u32::from_be_bytes(len) as usize;
            ensure!(n > 4 && n <= MAX_FRAME_LEN, "invalid frame length {n}");
            let mut payload = vec![0u8; n];
            uni.read_exact(&mut payload).await.context("stream ended mid-envelope")?;
            let at = Instant::now();
            let (index, body) = frame_envelope::unwrap(&payload).map_err(anyhow::Error::msg)?;
            out.push((index, body.to_vec(), at));
        }
    }
    connection.close(0u32.into(), b"done");
    Ok(out)
}
