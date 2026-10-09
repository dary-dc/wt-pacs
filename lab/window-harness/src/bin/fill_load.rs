//! N sessions fill the same series at once; each fill's time, every frame matched byte for byte
//! with the item ingest wrote, and the server's CPU and memory over the fills. lab/server-load.
//!
//! usage: fill_load --url https://127.0.0.1:4433/ --items DIR --ext htj2k --sessions 8
//!                  [--read-bps 2500000] --server-pid PID
use anyhow::{bail, ensure, Context, Result};
use clap::Parser;
use fod::{encode_fod_msg, FodMsg};
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Barrier;
use window_harness::wire::MAX_FRAME_LEN;
use wtransport::{ClientConfig, Endpoint};

#[derive(Parser)]
struct Args {
    #[arg(long)]
    url: String,
    /// `NNN.<ext>` as ingest wrote them: what the store holds, frame for frame.
    #[arg(long)]
    items: PathBuf,
    #[arg(long)]
    ext: String,
    #[arg(long, default_value_t = 1)]
    sessions: usize,
    /// Bytes per second each session reads at; 0 reads as fast as it can.
    #[arg(long, default_value_t = 0)]
    read_bps: u64,
    #[arg(long)]
    server_pid: u32,
    #[arg(long, default_value_t = 300_000)]
    timeout_ms: u64,
    /// Lab only: flip one byte of the reference, so every session must report a mismatch.
    #[arg(long)]
    mutate: bool,
}

struct Fill {
    ms: f64,
    bytes: u64,
    frames: usize,
    exact: usize,
}

/// Seconds on CPU, summed over the process's threads (schedstat: `stat`'s ticks are 10 ms).
fn cpu_s(pid: &str) -> Result<f64> {
    let mut ns = 0u64;
    for task in std::fs::read_dir(format!("/proc/{pid}/task"))? {
        if let Ok(text) = std::fs::read_to_string(task?.path().join("schedstat")) {
            ns += text.split_whitespace().next().context("schedstat")?.parse::<u64>()?;
        }
    }
    Ok(ns as f64 / 1e9)
}

/// (busy, total) ticks over every CPU of the host.
fn host_ticks() -> Result<(u64, u64)> {
    let stat = std::fs::read_to_string("/proc/stat")?;
    let v: Vec<u64> = stat.lines().next().context("/proc/stat")?.split_whitespace().skip(1)
        .map(|f| f.parse().unwrap_or(0)).collect();
    let total: u64 = v.iter().sum();
    Ok((total - v[3] - v[4], total))
}

/// Datagrams the host's UDP sockets dropped for a full receive buffer.
fn rcvbuf_errors() -> Result<u64> {
    let snmp = std::fs::read_to_string("/proc/net/snmp")?;
    let mut udp = snmp.lines().filter(|l| l.starts_with("Udp:"));
    let (head, vals) = (udp.next().context("Udp")?, udp.next().context("Udp")?);
    let at = head.split_whitespace().position(|h| h == "RcvbufErrors").context("RcvbufErrors")?;
    Ok(vals.split_whitespace().nth(at).context("RcvbufErrors")?.parse()?)
}

fn rss_kb(pid: u32) -> u64 {
    std::fs::read_to_string(format!("/proc/{pid}/status")).ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("VmRSS:"))
            .and_then(|l| l.split_whitespace().nth(1)?.parse().ok()))
        .unwrap_or(0)
}

async fn fill(args: &Args, items: &[Vec<u8>], start: &Barrier) -> Result<Fill> {
    let v4 = SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), 0);
    let endpoint = Endpoint::client(
        ClientConfig::builder().with_bind_address(v4).with_no_cert_validation().build(),
    )?;
    let connection = endpoint.connect(&args.url).await.context("connect")?;
    let (mut control, _recv) = connection.open_bi().await?.await?;
    start.wait().await;

    let t0 = Instant::now();
    control.write_all(&encode_fod_msg(&FodMsg::StreamFrames { from: None, to: None })?).await?;
    let mut seen = vec![false; items.len()];
    let (mut frames, mut exact, mut bytes) = (0usize, 0usize, 0u64);
    let deadline = Duration::from_millis(args.timeout_ms);
    while frames < items.len() {
        let mut uni = tokio::time::timeout(deadline, connection.accept_uni()).await
            .context("no media stream")??;
        while frames < items.len() {
            let mut len = [0u8; 4];
            if uni.read_exact(&mut len).await.is_err() {
                break;
            }
            let n = u32::from_be_bytes(len) as usize;
            ensure!(n > 4 && n <= MAX_FRAME_LEN, "invalid frame length {n}");
            let mut payload = vec![0u8; n];
            let mut got = 0;
            while got < n {
                got += uni.read(&mut payload[got..]).await?.context("stream ended mid-envelope")?;
                if args.read_bps > 0 {
                    let due = Duration::from_secs_f64((bytes + got as u64) as f64 / args.read_bps as f64);
                    if let Some(wait) = due.checked_sub(t0.elapsed()) {
                        tokio::time::sleep(wait).await;
                    }
                }
            }
            bytes += 4 + n as u64;
            let (index, body) = frame_envelope::unwrap(&payload).map_err(anyhow::Error::msg)?;
            let i = index as usize;
            ensure!(i < items.len() && !seen[i], "frame {index} unexpected or repeated");
            seen[i] = true;
            frames += 1;
            exact += (body == items[i].as_slice()) as usize;
        }
    }
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    connection.close(0u32.into(), b"done");
    Ok(Fill { ms, bytes, frames, exact })
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Arc::new(Args::parse());
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;
    let mut items = Vec::new();
    while let Ok(b) = std::fs::read(args.items.join(format!("{:03}.{}", items.len(), args.ext))) {
        items.push(b);
    }
    ensure!(!items.is_empty(), "no {} items in {}", args.ext, args.items.display());
    if args.mutate {
        items[0][0] ^= 1;
    }
    let items = Arc::new(items);

    let start = Arc::new(Barrier::new(args.sessions + 1));
    let tasks: Vec<_> = (0..args.sessions)
        .map(|_| {
            let (args, items, start) = (args.clone(), items.clone(), start.clone());
            tokio::spawn(async move { fill(&args, &items, &start).await })
        })
        .collect();
    // A session that fails to connect never reaches the barrier.
    tokio::time::timeout(Duration::from_secs(60), start.wait()).await
        .context("a session did not connect within 60 s")?;

    let pid = args.server_pid.to_string();
    let (server0, client0, host0, t0) = (cpu_s(&pid)?, cpu_s("self")?, host_ticks()?, Instant::now());
    let (rss0, drops0) = (rss_kb(args.server_pid), rcvbuf_errors()?);
    let done = Arc::new(AtomicBool::new(false));
    let sampler = {
        let done = done.clone();
        let server_pid = args.server_pid;
        tokio::spawn(async move {
            let mut peak = 0;
            while !done.load(Ordering::Relaxed) {
                peak = peak.max(rss_kb(server_pid));
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            peak
        })
    };
    let mut fills = Vec::new();
    for t in tasks {
        fills.push(t.await??);
    }
    let wall = t0.elapsed().as_secs_f64();
    done.store(true, Ordering::Relaxed);
    let rss_peak = sampler.await?;
    let (host1, server1, client1) = (host_ticks()?, cpu_s(&pid)?, cpu_s("self")?);
    let drops = rcvbuf_errors()? - drops0;

    let frames: usize = fills.iter().map(|f| f.frames).sum();
    let exact: usize = fills.iter().map(|f| f.exact).sum();
    if fills.iter().any(|f| f.frames != items.len()) {
        bail!("a session ended short");
    }
    let ms: Vec<String> = fills.iter().map(|f| format!("{:.1}", f.ms)).collect();
    println!(
        "{{\"sessions\":{},\"read_bps\":{},\"fill_ms\":[{}],\"bytes\":{},\"frames\":{},\"exact\":{},\
         \"wall_s\":{:.3},\"server_cpu_s\":{:.2},\"client_cpu_s\":{:.2},\"host_busy\":{:.3},\
         \"server_rss_kb_before\":{},\"server_rss_kb_peak\":{},\"rcvbuf_drops\":{}}}",
        args.sessions,
        args.read_bps,
        ms.join(","),
        fills.iter().map(|f| f.bytes).sum::<u64>(),
        frames,
        exact,
        wall,
        server1 - server0,
        client1 - client0,
        (host1.0 - host0.0) as f64 / (host1.1 - host0.1).max(1) as f64,
        rss0,
        rss_peak,
        drops,
    );
    Ok(())
}
