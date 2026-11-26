//! Product-server A/B client. `docs/adr/disk-access.md`.

use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use fod::{encode_fod_msg, FodMsg};
use frame_envelope::unwrap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use wtransport::config::IpBindConfig;
use wtransport::stream::{RecvStream, SendStream};
use wtransport::{ClientConfig, Connection, Endpoint, VarInt};
use xxhash_rust::xxh3::xxh3_64;

#[derive(Clone, Copy, ValueEnum)]
enum Mode {
    #[value(name = "on-demand")]
    OnDemand,
    Fill,
    /// Each session in turn asks `asks` tiles at `depth`, then streams `--fill` frames from frame
    /// 0, and stays open asking nothing: what the server keeps for sessions that have read.
    Idle,
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
    /// Session k starts `k × asks × step` frames past the first, so no two sessions ask one frame.
    #[arg(long)]
    disjoint: bool,
    /// On demand, asks go out in bursts of this many, the next once the last of this one is in;
    /// p50_ns to p99_ns are then each burst's wall, its first ask sent to its last frame received.
    #[arg(long)]
    burst: Option<usize>,
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
    /// Frames each `--mode idle` session streams after its tiles.
    #[arg(long, default_value_t = 32)]
    fill: usize,
    /// How long `--mode idle` holds every session open before it reads the server's RSS.
    #[arg(long, default_value_t = 1000)]
    hold_ms: u64,
    /// Runs each session's asks this many times over its one connection, a row a pass. A pass after
    /// the first starts on a line (or the end) of stdin, so the caller can read the server between them.
    #[arg(long, default_value_t = 1)]
    passes: usize,
    /// A fill's pause after each frame it receives, in µs: a lever to keep the server below saturation.
    #[arg(long, default_value_t = 0)]
    gap_us: u64,
}

static DUMP: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

/// XXH3-64 per frame index, from the files the bundle was packed from.
fn coded_digests(dir: &std::path::Path) -> Result<Vec<u64>> {
    let mut paths: Vec<_> = std::fs::read_dir(dir)?.map(|e| e.map(|e| e.path())).collect::<Result<_, _>>()?;
    let index = |p: &std::path::Path| p.file_stem().and_then(|s| s.to_str()).and_then(|s| s.parse::<u32>().ok());
    paths.retain(|p| index(p).is_some() && p.extension().is_some_and(|e| e == "htj2k" || e == "av1"));
    paths.sort_by_key(|p| index(p));
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
    if let Mode::Idle = args.mode {
        return idle(&args, &digests).await;
    }
    let mut endpoints = vec![client_endpoint(None)?];
    let peak = Arc::new(AtomicU64::new(0));
    let sampler = args.server_pid.map(|pid| tokio::spawn(sample_rss(pid, Arc::clone(&peak))));
    let mut mark = Mark::now(args.server_pid, &peak)?;
    let mut opening = tokio::task::JoinSet::new();
    for i in 0..args.sessions.max(1) {
        if i > 0 && !args.one_socket {
            endpoints.push(client_endpoint(None)?);
        }
        opening.spawn(Session::open(connect(endpoints.last().expect("one endpoint"), &args.url).await?, i));
    }
    let mut sessions = Vec::with_capacity(opening.len());
    while let Some(opened) = opening.join_next().await {
        sessions.push(opened.context("session join")??);
    }
    let args = Arc::new(args);
    for pass in 0..args.passes.max(1) {
        if pass > 0 {
            tokio::task::spawn_blocking(|| std::io::stdin().read_line(&mut String::new())).await??;
            mark = Mark::now(args.server_pid, &peak)?;
        }
        let mut set = tokio::task::JoinSet::new();
        for mut session in sessions.drain(..) {
            let (args, digests) = (Arc::clone(&args), digests.clone());
            set.spawn(async move { session.ask(&args, &digests).await.map(|lats| (session, lats)) });
        }
        let (mut lats, mut asked) = (Vec::new(), 0);
        while let Some(joined) = set.join_next().await {
            let (session, (l, n)) = joined.context("session join")??;
            sessions.push(session);
            lats.extend(l);
            asked += n;
        }
        print_row(&args, pass == 0, &mark, &peak, lats, asked)?;
    }
    if let Some(sampler) = sampler {
        sampler.abort();
    }
    drop(sessions);
    // Closed, not dropped: the server writes each `session reads` line now, not at its idle timeout.
    for endpoint in &endpoints {
        endpoint.close(VarInt::from_u32(0), b"");
        endpoint.wait_idle().await;
    }
    Ok(())
}

/// Where a pass starts: the clock, and the server's CPU and RSS.
struct Mark {
    wall: Instant,
    server: Option<(u32, u128, u64)>,
}

impl Mark {
    fn now(server_pid: Option<u32>, peak: &AtomicU64) -> Result<Self> {
        let server = match server_pid {
            Some(pid) => Some((pid, proc_cpu(pid)?, proc_rss_kib(pid)?)),
            None => None,
        };
        peak.store(server.map_or(0, |(_, _, rss0)| rss0), Ordering::Relaxed);
        Ok(Self { wall: Instant::now(), server })
    }
}

fn print_row(args: &Args, header: bool, mark: &Mark, peak: &AtomicU64, mut lats: Vec<u64>, asked: usize) -> Result<()> {
    let wall_ns = mark.wall.elapsed().as_nanos() as u64;
    let n = asked.max(1) as u64;
    let (cpu_ns_per_ask, rss_kib) = match mark.server {
        Some((pid, cpu0, rss0)) => (
            (proc_cpu(pid)?.saturating_sub(cpu0) / u128::from(n)).to_string(),
            peak.load(Ordering::Relaxed).saturating_sub(rss0).to_string(),
        ),
        None => ("-".to_string(), "-".to_string()),
    };
    let asks_per_s = n as f64 * 1e9 / wall_ns.max(1) as f64;
    lats.sort_unstable();
    if header && !args.no_header {
        println!(
            "label\tvariant\ttemp\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\t\
             asks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct\tnamed"
        );
    }
    println!(
        "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{:.0}\t{}\t{}\t-\t-",
        args.label,
        args.variant,
        args.temp,
        args.mode.to_possible_value().expect("no mode is skipped").get_name(),
        args.depth,
        asked,
        pct(&lats, 0.50),
        pct(&lats, 0.90),
        pct(&lats, 0.99),
        wall_ns,
        asks_per_s,
        cpu_ns_per_ask,
        rss_kib,
    );
    Ok(())
}

/// One row: CPU per frame over the sessions' reads, then the server's RSS once all are idle,
/// and how many were still open when it was read.
async fn idle(args: &Args, digests: &Option<Arc<Vec<u64>>>) -> Result<()> {
    let pid = args.server_pid.context("--mode idle reads the server's RSS: give --server-pid")?;
    let (cpu0, rss0) = (proc_cpu(pid)?, proc_rss_kib(pid)?);
    let peak = Arc::new(AtomicU64::new(rss0));
    let sampler = tokio::spawn(sample_rss(pid, Arc::clone(&peak)));
    let frames = args.frames.max(1);
    let mut held = Vec::with_capacity(args.sessions);
    let mut served = 0;
    for _ in 0..args.sessions.max(1) {
        let endpoint = client_endpoint(Some(Duration::from_secs(3)))?;
        let connection = connect(&endpoint, &args.url).await?;
        let (mut control, recv) = connection.open_bi().await.context("open bi")?.await.context("bi ready")?;
        let mut media = connection.accept_uni().await.context("accept media uni")?;
        let (depth, step, start) = (args.depth.max(1), args.step.max(1), args.start.unwrap_or(0));
        served += on_demand(&mut control, &mut media, depth, args.asks, frames, step, start, None, digests).await?.len();
        let gap = Duration::from_micros(args.gap_us);
        served += fill(&mut control, &mut media, args.fill.min(frames as usize), Some(0), gap, digests).await?.len();
        held.push((endpoint, connection, control, recv, media));
    }
    let cpu_ns_per_frame = proc_cpu(pid)?.saturating_sub(cpu0) / served.max(1) as u128;
    tokio::time::sleep(Duration::from_millis(args.hold_ms)).await;
    let rss_idle = proc_rss_kib(pid)?;
    sampler.abort();
    let open = held.iter().filter(|(_, c, ..)| c.quic_connection().close_reason().is_none()).count();
    if !args.no_header {
        println!("label\tvariant\topen\tframes\tcpu_ns_per_frame\trss_start_kib\trss_peak_kib\trss_idle_kib");
    }
    println!(
        "{}\t{}\t{open}\t{served}\t{cpu_ns_per_frame}\t{rss0}\t{}\t{rss_idle}",
        args.label,
        args.variant,
        peak.load(Ordering::Relaxed),
    );
    Ok(())
}

/// `keep_alive` holds a session open past the idle timeout while it asks nothing.
fn client_endpoint(
    keep_alive: Option<Duration>,
) -> Result<Endpoint<wtransport::endpoint::endpoint_side::Client>> {
    let dual = ClientConfig::builder()
        .with_bind_default()
        .with_no_cert_validation()
        .keep_alive_interval(keep_alive)
        .build();
    match Endpoint::client(dual) {
        Ok(ep) => Ok(ep),
        Err(_) => {
            let v4 = ClientConfig::builder()
                .with_bind_config(IpBindConfig::InAddrAnyV4)
                .with_no_cert_validation()
                .keep_alive_interval(keep_alive)
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

struct Session {
    _connection: Connection,
    control: SendStream,
    _reply: RecvStream,
    media: RecvStream,
    k: usize,
}

impl Session {
    async fn open(connection: Connection, k: usize) -> Result<Self> {
        let (control, reply) = connection
            .open_bi()
            .await
            .context("open bi")?
            .await
            .context("bi ready")?;
        let media = connection.accept_uni().await.context("accept media uni")?;
        Ok(Self { _connection: connection, control, _reply: reply, media, k })
    }

    /// Each value timed, and the asks it covers.
    async fn ask(&mut self, args: &Args, digests: &Option<Arc<Vec<u64>>>) -> Result<(Vec<u64>, usize)> {
        let (control, media, frames, step) = (&mut self.control, &mut self.media, args.frames.max(1), args.step.max(1));
        let start = match args.disjoint {
            true => Some(args.start.unwrap_or(0) + (self.k * args.asks) as u32 * step),
            false => args.start,
        };
        match args.mode {
            Mode::OnDemand => {
                let (depth, start) = (args.depth.max(1), start.unwrap_or(0));
                let lats = on_demand(control, media, depth, args.asks, frames, step, start, args.burst, digests).await?;
                Ok((lats, args.asks))
            }
            Mode::Fill => {
                let gap = Duration::from_micros(args.gap_us);
                let lats = fill(control, media, args.asks.min(frames as usize), start, gap, digests).await?;
                let asked = lats.len();
                Ok((lats, asked))
            }
            Mode::Idle => unreachable!("`idle` opens its own sessions"),
        }
    }
}

async fn on_demand(
    control: &mut SendStream,
    media: &mut RecvStream,
    depth: u32,
    asks: usize,
    frames: u32,
    step: u32,
    start: u32,
    burst: Option<usize>,
    digests: &Option<Arc<Vec<u64>>>,
) -> Result<Vec<u64>> {
    let plan = |i: usize| start.wrapping_add((i as u32).wrapping_mul(step)) % frames;
    let mut sent = Vec::with_capacity(asks);
    let mut lats = Vec::with_capacity(asks);
    let mut walls = Vec::new();
    let size = burst.unwrap_or(asks).max(1);
    let mut next_send = 0usize;
    let mut next_recv = 0usize;
    while next_recv < asks {
        let burst_end = (next_recv / size + 1) * size;
        while next_send < asks.min(burst_end) && (next_send - next_recv) < depth as usize {
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
        if burst.is_some() && (next_recv % size == 0 || next_recv == asks) {
            walls.push(sent[(next_recv - 1) / size * size].elapsed().as_nanos() as u64);
        }
    }
    Ok(if burst.is_some() { walls } else { lats })
}

async fn fill(
    control: &mut SendStream,
    media: &mut RecvStream,
    asks: usize,
    start: Option<u32>,
    gap: Duration,
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
        if !gap.is_zero() {
            tokio::time::sleep(gap).await;
        }
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
