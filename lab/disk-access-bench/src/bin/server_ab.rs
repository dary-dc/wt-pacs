//! Product-server A/B client. `docs/disk-access/READ-PATH-DESIGN.md` §15.4.

use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use fod::{encode_fod_msg, FodMsg};
use frame_envelope::unwrap;
use std::time::{Duration, Instant};
use wtransport::config::IpBindConfig;
use wtransport::stream::{RecvStream, SendStream};
use wtransport::{ClientConfig, Connection, Endpoint};

#[derive(Clone, Copy, ValueEnum)]
enum Mode {
    #[value(name = "on-demand")]
    OnDemand,
    Fill,
}

#[derive(Parser)]
struct Args {
    #[arg(long)]
    url: String,
    #[arg(long)]
    server_pid: u32,
    #[arg(long, value_enum)]
    mode: Mode,
    #[arg(long, default_value_t = 1)]
    depth: u32,
    #[arg(long, default_value_t = 256)]
    asks: usize,
    #[arg(long, default_value_t = 1)]
    sessions: usize,
    #[arg(long, default_value_t = 1)]
    frames: u32,
    #[arg(long, default_value = "")]
    label: String,
    #[arg(long, default_value = "")]
    arm: String,
    #[arg(long, default_value = "cold")]
    temp: String,
    #[arg(long)]
    no_header: bool,
}

fn main() -> Result<()> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let args = Args::parse();
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run(args))
}

async fn run(args: Args) -> Result<()> {
    let endpoint = client_endpoint()?;
    let cpu0 = proc_cpu(args.server_pid)?;
    let wall = Instant::now();
    let mut conns = Vec::with_capacity(args.sessions.max(1));
    for _ in 0..args.sessions.max(1) {
        conns.push(connect(&endpoint, &args.url).await?);
    }
    let mut set = tokio::task::JoinSet::new();
    for conn in conns {
        let (mode, depth, asks, frames) = (args.mode, args.depth, args.asks, args.frames.max(1));
        set.spawn(async move { session(conn, mode, depth, asks, frames).await });
    }
    let mut lats = Vec::new();
    while let Some(joined) = set.join_next().await {
        lats.extend(joined.context("session join")??);
    }
    drop(endpoint);
    let wall_ns = wall.elapsed().as_nanos() as u64;
    let cpu_ticks = proc_cpu(args.server_pid)?.saturating_sub(cpu0);
    let n = lats.len().max(1) as u64;
    let cpu_ns_per_ask = ticks_to_ns(cpu_ticks) / n;
    let asks_per_s = n as f64 * 1e9 / wall_ns.max(1) as f64;
    lats.sort_unstable();
    if !args.no_header {
        println!(
            "label\tarm\ttemp\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\t\
             asks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct"
        );
    }
    println!(
        "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{:.0}\t{}\t{}\t-",
        args.label,
        args.arm,
        args.temp,
        match args.mode {
            Mode::OnDemand => "on-demand",
            Mode::Fill => "fill",
        },
        args.depth,
        lats.len(),
        pct(&lats, 0.50),
        pct(&lats, 0.90),
        pct(&lats, 0.99),
        wall_ns,
        asks_per_s,
        cpu_ns_per_ask,
        proc_rss_kib(args.server_pid)?,
    );
    Ok(())
}

fn client_endpoint() -> Result<Endpoint<wtransport::endpoint::endpoint_side::Client>> {
    let dual = ClientConfig::builder()
        .with_bind_default()
        .with_no_cert_validation()
        .build();
    match Endpoint::client(dual) {
        Ok(ep) => Ok(ep),
        Err(_) => {
            let v4 = ClientConfig::builder()
                .with_bind_config(IpBindConfig::InAddrAnyV4)
                .with_no_cert_validation()
                .build();
            Endpoint::client(v4).context("wtransport client (IPv4)")
        }
    }
}

async fn connect(
    endpoint: &Endpoint<wtransport::endpoint::endpoint_side::Client>,
    url: &str,
) -> Result<Connection> {
    let mut last = None;
    for _ in 0..50 {
        match endpoint.connect(url).await {
            Ok(c) => return Ok(c),
            Err(err) => {
                last = Some(err);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
    Err(last.context("connect")?.into())
}

async fn session(
    connection: Connection,
    mode: Mode,
    depth: u32,
    asks: usize,
    frames: u32,
) -> Result<Vec<u64>> {
    let (mut control, _recv) = connection
        .open_bi()
        .await
        .context("open bi")?
        .await
        .context("bi ready")?;
    let mut media = connection.accept_uni().await.context("accept media uni")?;
    match mode {
        Mode::OnDemand => on_demand(&mut control, &mut media, depth.max(1), asks, frames).await,
        Mode::Fill => fill(&mut control, &mut media, asks).await,
    }
}

async fn on_demand(
    control: &mut SendStream,
    media: &mut RecvStream,
    depth: u32,
    asks: usize,
    frames: u32,
) -> Result<Vec<u64>> {
    let mut sent = Vec::with_capacity(asks);
    let mut lats = Vec::with_capacity(asks);
    let mut next_send = 0usize;
    let mut next_recv = 0usize;
    while next_recv < asks {
        while next_send < asks && (next_send - next_recv) < depth as usize {
            let frame = (next_send as u32) % frames;
            control
                .write_all(&encode_fod_msg(&FodMsg::RequestFrame { frame })?)
                .await?;
            sent.push(Instant::now());
            next_send += 1;
        }
        read_envelope(media).await?;
        lats.push(sent[next_recv].elapsed().as_nanos() as u64);
        next_recv += 1;
    }
    Ok(lats)
}

async fn fill(control: &mut SendStream, media: &mut RecvStream, asks: usize) -> Result<Vec<u64>> {
    let mut lats = Vec::with_capacity(asks);
    let mut prev = Instant::now();
    control
        .write_all(&encode_fod_msg(&FodMsg::StreamFrames {
            from: None,
            to: None,
        })?)
        .await?;
    for _ in 0..asks {
        read_envelope(media).await?;
        let now = Instant::now();
        lats.push(now.duration_since(prev).as_nanos() as u64);
        prev = now;
    }
    Ok(lats)
}

async fn read_envelope(recv: &mut RecvStream) -> Result<(u32, Vec<u8>)> {
    let mut head = [0u8; 4];
    read_exact(recv, &mut head).await?;
    let mut body = vec![0u8; u32::from_be_bytes(head) as usize];
    read_exact(recv, &mut body).await?;
    let (idx, data) = unwrap(&body).map_err(|e| anyhow::anyhow!(e))?;
    Ok((idx, data.to_vec()))
}

async fn read_exact(recv: &mut RecvStream, out: &mut [u8]) -> Result<()> {
    let mut filled = 0;
    while filled < out.len() {
        match recv.read(&mut out[filled..]).await? {
            Some(n) => filled += n,
            None => anyhow::bail!("stream ended before {} bytes", out.len()),
        }
    }
    Ok(())
}

fn pct(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    sorted[(((sorted.len() - 1) as f64) * p).round() as usize]
}

fn proc_cpu(pid: u32) -> Result<u128> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).context("read stat")?;
    let rest = text.rsplit_once(')').context("stat comm")?.1;
    let f: Vec<&str> = rest.split_whitespace().collect();
    let utime: u64 = f.get(11).context("utime")?.parse()?;
    let stime: u64 = f.get(12).context("stime")?.parse()?;
    Ok(u128::from(utime) + u128::from(stime))
}

fn ticks_to_ns(ticks: u128) -> u64 {
    let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) }.max(1) as u128;
    (ticks.saturating_mul(1_000_000_000) / hz) as u64
}

fn proc_rss_kib(pid: u32) -> Result<u64> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/statm")).context("read statm")?;
    let pages: u64 = text
        .split_whitespace()
        .nth(1)
        .context("rss pages")?
        .parse()?;
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) }.max(1) as u64;
    Ok(pages * page / 1024)
}
