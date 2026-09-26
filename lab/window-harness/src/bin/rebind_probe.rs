//! Does a session survive a 4-tuple change? `docs/ARCHITECTURE.md` step 1.
//!
//! Takes `--warm` frames through `lab/scripts/link_impair.py`, tells the relay to change
//! its upstream source port, then asks for one more frame and reports what happened.

use anyhow::{bail, Context, Result};
use clap::Parser;
use fod::{encode_fod_msg, FodMsg};
use frame_envelope::unwrap;
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use wtransport::stream::{RecvStream, SendStream};
use wtransport::{ClientConfig, Connection, Endpoint};

/// Matches the server's envelope guard.
const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

#[derive(Parser)]
#[command(name = "rebind-probe")]
struct Args {
    #[arg(long, default_value = "https://127.0.0.1:5555/")]
    url: String,
    #[arg(long, default_value_t = 5556)]
    control_port: u16,
    /// Frames to take before the rebind. The study must hold at least one more.
    #[arg(long, default_value_t = 10)]
    warm: u32,
    #[arg(long, default_value_t = 20_000)]
    timeout_ms: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    // The relay is on 127.0.0.1 and this host has no IPv6, so bind IPv4 rather than dual-stack.
    let config = ClientConfig::builder()
        .with_bind_address(SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), 0))
        .with_no_cert_validation()
        .build();
    let endpoint = Endpoint::client(config).context("wtransport client")?;
    let connection = endpoint.connect(&args.url).await.context("connect")?;

    let (tx, mut rx) = mpsc::unbounded_channel();
    let reader = connection.clone();
    tokio::spawn(async move { read_unis(reader, tx).await });

    let (mut control, _recv) = connection
        .open_bi()
        .await
        .context("open bi")?
        .await
        .context("open bi ready")?;

    for frame in 0..args.warm {
        write_msg(&mut control, &FodMsg::RequestFrame { frame })
            .await
            .context("warm ask")?;
    }
    for _ in 0..args.warm {
        match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(_)) => {}
            _ => bail!("VOID: warm-up did not deliver {} frames", args.warm),
        }
    }

    UdpSocket::bind("127.0.0.1:0")
        .context("control socket")?
        .send_to(b"rebind", ("127.0.0.1", args.control_port))
        .context("ask the relay to rebind")?;

    let started = Instant::now();
    let ask = write_msg(&mut control, &FodMsg::RequestFrame { frame: args.warm }).await;
    let (verdict, detail) = match ask {
        Err(err) => ("write-failed".to_string(), format!("{err:#}")),
        Ok(()) => {
            tokio::select! {
                got = rx.recv() => match got {
                    Some(index) => ("survived".to_string(), format!("frame {index}")),
                    None => ("reader-gone".to_string(), String::new()),
                },
                err = connection.closed() => ("closed".to_string(), format!("{err}")),
                _ = tokio::time::sleep(Duration::from_millis(args.timeout_ms)) => {
                    ("timeout".to_string(), format!("{} ms", args.timeout_ms))
                }
            }
        }
    };

    println!(
        "{}",
        serde_json::json!({
            "verdict": verdict,
            "detail": detail,
            "warm": args.warm,
            "elapsed_ms": started.elapsed().as_millis() as u64,
        })
    );
    Ok(())
}

async fn read_unis(connection: Connection, tx: mpsc::UnboundedSender<u32>) {
    while let Ok(mut recv) = connection.accept_uni().await {
        let tx = tx.clone();
        tokio::spawn(async move {
            while let Ok(payload) = read_framed(&mut recv).await {
                match unwrap(&payload) {
                    Ok((index, _)) => {
                        if tx.send(index).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }
}

async fn write_msg(send: &mut SendStream, msg: &FodMsg) -> Result<()> {
    send.write_all(&encode_fod_msg(msg)?)
        .await
        .context("write FoD")?;
    Ok(())
}

async fn read_framed(recv: &mut RecvStream) -> Result<Vec<u8>> {
    let mut len = [0u8; 4];
    read_exact(recv, &mut len).await?;
    let n = u32::from_be_bytes(len) as usize;
    if n == 0 || n > MAX_FRAME_LEN {
        bail!("invalid frame length {n}");
    }
    let mut payload = vec![0u8; n];
    read_exact(recv, &mut payload).await?;
    Ok(payload)
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
