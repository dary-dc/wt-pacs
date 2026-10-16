//! Product-server A/B client. `docs/adr/disk-access.md`.

use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use fod::{encode_fod_msg, FodMsg};
use frame_envelope::unwrap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use wtransport::config::IpBindConfig;
use wtransport::stream::{RecvStream, SendStream};
use wtransport::endpoint::endpoint_side::Client;
use wtransport::{ClientConfig, Connection, Endpoint, VarInt};
use xxhash_rust::xxh3::xxh3_64;

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
    /// For the CPU and RSS columns. A remote server has no local pid; they print `-`.
    #[arg(long)]
    server_pid: Option<u32>,
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
    /// Frames between consecutive asks. `step * frame_bytes` must clear the kernel's
    /// read-ahead or a cold cell is a hit cell wearing a cold label — §14.4.
    #[arg(long, default_value_t = 1)]
    step: u32,
    /// First frame asked; a fill then streams `asks` frames from it. A series past RAM is cold only
    /// where no earlier run has read it. Unset: frame 0, and a fill streams the whole series.
    #[arg(long)]
    start: Option<u32>,
    /// Session `i` in its cycle `c` starts at `start + (c * sessions + i) * spread`: disjoint
    /// ranges, each cold where no earlier run has read it.
    #[arg(long, default_value_t = 0)]
    spread: u32,
    /// Connections each session opens in turn, one after the other ends.
    #[arg(long, default_value_t = 1)]
    cycles: usize,
    /// On-demand: close the connection once this many frames are in, with the rest still asked.
    #[arg(long)]
    close_after: Option<usize>,
    /// One more session, asking one frame at a time from FIRST through FIRST + COUNT - 1 and
    /// round again while the others run; its ask latency is the gap a stalled server worker leaves.
    #[arg(long, value_name = "FIRST:COUNT", value_parser = parse_range)]
    cotenant: Option<(u32, u32)>,
    #[arg(long, default_value = "")]
    label: String,
    #[arg(long, default_value = "")]
    variant: String,
    #[arg(long, default_value = "cold")]
    temp: String,
    #[arg(long)]
    no_header: bool,
    /// Open every session from one client socket, as before 2026-09-10. One source port means
    /// one 4-tuple, which a server of `SO_REUSEPORT` endpoints hashes onto one thread.
    #[arg(long)]
    one_socket: bool,
    /// The coded frames the series was packed from (`NNN.htj2k` or `NNN.av1`, in index order): every frame received
    /// is checked against its file's XXH3-64, and a mismatch fails the run.
    #[arg(long)]
    coded: Option<std::path::PathBuf>,
    /// Writes each frame received as `NNN.bin` here, for a decode against ingest's digests.
    #[arg(long)]
    dump: Option<std::path::PathBuf>,
}

static DUMP: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

fn parse_range(s: &str) -> Result<(u32, u32), String> {
    let (first, count) = s.split_once(':').ok_or("FIRST:COUNT")?;
    let count: u32 = count.parse().map_err(|e| format!("{e}"))?;
    if count == 0 {
        return Err("COUNT is 0".into());
    }
    Ok((first.parse().map_err(|e| format!("{e}"))?, count))
}

/// XXH3-64 per frame index, from the files the bundle was packed from.
fn coded_digests(dir: &std::path::Path) -> Result<Vec<u64>> {
    let mut paths: Vec<_> = std::fs::read_dir(dir)?.map(|e| e.map(|e| e.path())).collect::<Result<_, _>>()?;
    paths.retain(|p| {
        p.file_stem().and_then(|s| s.to_str()).is_some_and(|s| s.parse::<u32>().is_ok())
            && p.extension().is_some_and(|e| e == "htj2k" || e == "av1")
    });
    paths.sort();
    paths.iter().map(|p| Ok(xxh3_64(&std::fs::read(p)?))).collect()
}

fn check(digests: &Option<Arc<Vec<u64>>>, idx: u32, data: &[u8]) -> Result<()> {
    if let Some(dir) = DUMP.get() {
        std::fs::write(dir.join(format!("{idx:03}.bin")), data)?;
    }
    if let Some(d) = digests {
        let want = *d.get(idx as usize).context("frame index past the coded files")?;
        anyhow::ensure!(xxh3_64(data) == want, "frame {idx}: XXH3-64 differs from its coded bytes");
    }
    Ok(())
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
    if let Some(dir) = &args.dump {
        std::fs::create_dir_all(dir)?;
        let _ = DUMP.set(dir.clone());
    }
    let digests = args.coded.as_deref().map(coded_digests).transpose()?.map(Arc::new);
    let cot_endpoint = client_endpoint()?;
    let cot_streams = match args.cotenant {
        Some(_) => Some(open(connect(&cot_endpoint, &args.url).await?).await?),
        None => None,
    };
    let server = match args.server_pid {
        Some(pid) => Some((pid, proc_cpu(pid)?, proc_rss_kib(pid)?)),
        None => None,
    };
    let peak = Arc::new(AtomicU64::new(server.map_or(0, |(_, _, rss0)| rss0)));
    let sampler = server.map(|(pid, ..)| tokio::spawn(sample_rss(pid, Arc::clone(&peak))));
    let wall = Instant::now();
    let sessions = args.sessions.max(1);
    let mut endpoint = Arc::new(client_endpoint()?);
    let mut conns = Vec::with_capacity(sessions);
    for i in 0..sessions {
        if i > 0 && !args.one_socket {
            endpoint = Arc::new(client_endpoint()?);
        }
        conns.push((Arc::clone(&endpoint), connect(&endpoint, &args.url).await?));
    }
    let stop = Arc::new(AtomicBool::new(false));
    let cot_task = cot_streams.zip(args.cotenant).map(|(streams, range)| {
        let (stop, digests) = (Arc::clone(&stop), digests.clone());
        tokio::spawn(async move { cotenant(streams, range, &digests, &stop).await })
    });
    let mut set = tokio::task::JoinSet::new();
    for (i, (endpoint, mut conn)) in conns.into_iter().enumerate() {
        let (mode, depth, asks, frames) = (args.mode, args.depth, args.asks, args.frames.max(1));
        let (step, digests, url) = (args.step.max(1), digests.clone(), args.url.clone());
        let (cycles, spread, close_after, start) = (args.cycles.max(1), args.spread, args.close_after, args.start);
        set.spawn(async move {
            let mut lats = Vec::new();
            for c in 0..cycles {
                if c > 0 {
                    conn = connect(&endpoint, &url).await?;
                }
                let start = start.map(|s| s + spread * (c * sessions + i) as u32);
                let plan = Plan { mode, depth, asks, frames, step, start, close_after };
                lats.extend(session(&conn, plan, &digests).await?);
                if close_after.is_some() {
                    conn.close(VarInt::from_u32(0), b"");
                }
            }
            anyhow::Ok(lats)
        });
    }
    let mut lats = Vec::new();
    while let Some(joined) = set.join_next().await {
        lats.extend(joined.context("session join")??);
    }
    let wall_ns = wall.elapsed().as_nanos() as u64;
    let n = lats.len().max(1) as u64;
    let (cpu_ns_per_ask, rss_kib) = match server {
        Some((pid, cpu0, rss0)) => (
            (proc_cpu(pid)?.saturating_sub(cpu0) / u128::from(n)).to_string(),
            peak.load(Ordering::Relaxed).saturating_sub(rss0).to_string(),
        ),
        None => ("-".to_string(), "-".to_string()),
    };
    stop.store(true, Ordering::Relaxed);
    let cot_columns = match cot_task {
        Some(task) => {
            let mut c = task.await.context("co-tenant join")??;
            c.sort_unstable();
            let max = c.last().copied().unwrap_or(0);
            format!("\t{}\t{}\t{}\t{max}", c.len(), pct(&c, 0.50), pct(&c, 0.99))
        }
        None => String::new(),
    };
    if let Some(sampler) = sampler {
        sampler.abort();
    }
    let asks_per_s = n as f64 * 1e9 / wall_ns.max(1) as f64;
    lats.sort_unstable();
    if !args.no_header {
        println!(
            "label\tvariant\ttemp\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\t\
             asks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct\tnamed{}",
            if args.cotenant.is_some() { "\tcot_asks\tcot_p50_ns\tcot_p99_ns\tcot_max_ns" } else { "" }
        );
    }
    println!(
        "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{:.0}\t{}\t{}\t-\t-{}",
        args.label,
        args.variant,
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
        rss_kib,
        cot_columns,
    );
    Ok(())
}

fn client_endpoint() -> Result<Endpoint<Client>> {
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

async fn connect(endpoint: &Endpoint<Client>, url: &str) -> Result<Connection> {
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

#[derive(Clone, Copy)]
struct Plan {
    mode: Mode,
    depth: u32,
    asks: usize,
    frames: u32,
    step: u32,
    start: Option<u32>,
    close_after: Option<usize>,
}

async fn open(connection: Connection) -> Result<(SendStream, RecvStream)> {
    let (control, _recv) = connection
        .open_bi()
        .await
        .context("open bi")?
        .await
        .context("bi ready")?;
    let media = connection.accept_uni().await.context("accept media uni")?;
    Ok((control, media))
}

async fn session(connection: &Connection, p: Plan, digests: &Option<Arc<Vec<u64>>>) -> Result<Vec<u64>> {
    let (mut control, mut media) = open(connection.clone()).await?;
    match p.mode {
        Mode::OnDemand => {
            let asks = p.close_after.map_or(p.asks, |n| n.min(p.asks));
            let plan = Plan { depth: p.depth.max(1), start: Some(p.start.unwrap_or(0)), ..p };
            on_demand(&mut control, &mut media, plan, asks, digests).await
        }
        Mode::Fill => fill(&mut control, &mut media, p.asks.min(p.frames as usize), p.start, digests).await,
    }
}

/// Asks `p.asks` frames, `p.depth` at a time, and returns once `received` of them are in.
async fn on_demand(
    control: &mut SendStream,
    media: &mut RecvStream,
    p: Plan,
    received: usize,
    digests: &Option<Arc<Vec<u64>>>,
) -> Result<Vec<u64>> {
    let (asks, depth, start) = (p.asks, p.depth, p.start.unwrap_or(0));
    let plan = |i: usize| start.wrapping_add((i as u32).wrapping_mul(p.step)) % p.frames;
    let mut sent = Vec::with_capacity(asks);
    let mut lats = Vec::with_capacity(asks);
    let mut next_send = 0usize;
    let mut next_recv = 0usize;
    while next_recv < received {
        while next_send < asks && (next_send - next_recv) < depth as usize {
            control
                .write_all(&encode_fod_msg(&FodMsg::RequestFrame {
                    frame: plan(next_send),
                })?)
                .await?;
            sent.push(Instant::now());
            next_send += 1;
        }
        // Pairing envelope n with ask n is the whole timing model; check it rather than assume.
        let (idx, data) = read_envelope(media).await?;
        check(digests, idx, &data)?;
        anyhow::ensure!(
            idx == plan(next_recv),
            "envelope {idx} answered ask {} ({})",
            next_recv,
            plan(next_recv)
        );
        lats.push(sent[next_recv].elapsed().as_nanos() as u64);
        next_recv += 1;
    }
    Ok(lats)
}

async fn fill(
    control: &mut SendStream,
    media: &mut RecvStream,
    asks: usize,
    start: Option<u32>,
    digests: &Option<Arc<Vec<u64>>>,
) -> Result<Vec<u64>> {
    let mut lats = Vec::with_capacity(asks);
    let (from, to) = match start {
        Some(from) => (Some(from), Some(from + asks as u32 - 1)),
        None => (None, None),
    };
    control
        .write_all(&encode_fod_msg(&FodMsg::StreamFrames { from, to })?)
        .await?;
    let mut prev = Instant::now();
    for _ in 0..asks {
        let (idx, data) = read_envelope(media).await?;
        check(digests, idx, &data)?;
        let now = Instant::now();
        lats.push(now.duration_since(prev).as_nanos() as u64);
        prev = now;
    }
    Ok(lats)
}

/// One frame at a time until `stop`, so every ask meets the server alone.
async fn cotenant(
    (mut control, mut media): (SendStream, RecvStream),
    (first, count): (u32, u32),
    digests: &Option<Arc<Vec<u64>>>,
    stop: &AtomicBool,
) -> Result<Vec<u64>> {
    let mut lats = Vec::new();
    for i in 0.. {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let frame = first + i % count;
        let sent = Instant::now();
        control
            .write_all(&encode_fod_msg(&FodMsg::RequestFrame { frame })?)
            .await?;
        let (idx, data) = read_envelope(&mut media).await?;
        lats.push(sent.elapsed().as_nanos() as u64);
        check(digests, idx, &data)?;
        anyhow::ensure!(idx == frame, "co-tenant: envelope {idx} answered ask {frame}");
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

/// Nanoseconds on cpu, summed over the server's threads. `stat`'s utime/stime are clock
/// ticks — 10 ms here, which a 256-ask cell cannot resolve.
fn proc_cpu(pid: u32) -> Result<u128> {
    let mut total = 0u128;
    for task in std::fs::read_dir(format!("/proc/{pid}/task")).context("read task dir")? {
        let path = task?.path().join("schedstat");
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        total += text
            .split_whitespace()
            .next()
            .context("schedstat")?
            .parse::<u128>()?;
    }
    Ok(total)
}

async fn sample_rss(pid: u32, peak: Arc<AtomicU64>) {
    loop {
        if let Ok(kib) = proc_rss_kib(pid) {
            peak.fetch_max(kib, Ordering::Relaxed);
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
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
