//! Disk-access campaign harness — see `docs/disk-access-campaign.md`.
//!
//! One TSV row per (arm × study × temperature × trace). Stall uses a current_thread
//! tokio runtime so sync faults on the executor freeze the heartbeat.

use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use exact_server::media::frame_store::{touch_pages, FrameStore};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tokio::runtime::Builder;

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq, Eq)]
enum Arm {
    MmapNaive,
    MmapBlockingTouch,
    /// `mincore`: skip pool hop when pages are already resident; else blocking touch.
    MmapHybridMincore,
    /// Prefault on a dedicated single OS thread (Mimir-style isolation), not Tokio's pool.
    MmapDedicatedPool,
    PreadBlocking,
    MmapWillneed,
    MmapWillneedNext,
    MmapBlockingAhead2,
}

impl Arm {
    fn as_str(self) -> &'static str {
        match self {
            Self::MmapNaive => "mmap_naive",
            Self::MmapBlockingTouch => "mmap_blocking_touch",
            Self::MmapHybridMincore => "mmap_hybrid_mincore",
            Self::MmapDedicatedPool => "mmap_dedicated_pool",
            Self::PreadBlocking => "pread_blocking",
            Self::MmapWillneed => "mmap_willneed",
            Self::MmapWillneedNext => "mmap_willneed_next",
            Self::MmapBlockingAhead2 => "mmap_blocking_ahead_2",
        }
    }

    fn all() -> &'static [Arm] {
        &[
            Self::MmapNaive,
            Self::MmapBlockingTouch,
            Self::MmapHybridMincore,
            Self::MmapDedicatedPool,
            Self::PreadBlocking,
            Self::MmapWillneed,
            Self::MmapWillneedNext,
            Self::MmapBlockingAhead2,
        ]
    }

    /// Decision-relevant subset for the follow-up campaign.
    fn decision() -> &'static [Arm] {
        &[
            Self::MmapNaive,
            Self::MmapBlockingTouch,
            Self::MmapHybridMincore,
            Self::MmapDedicatedPool,
            Self::PreadBlocking,
        ]
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum TraceKind {
    Forward,
    Reverse,
    Random,
}

impl TraceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Forward => "forward",
            Self::Reverse => "reverse",
            Self::Random => "random",
        }
    }

    fn all() -> &'static [TraceKind] {
        &[Self::Forward, Self::Reverse, Self::Random]
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum Temp {
    Cold,
    Warm,
}

impl Temp {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cold => "cold",
            Self::Warm => "warm",
        }
    }

    fn all() -> &'static [Temp] {
        &[Self::Cold, Self::Warm]
    }
}

#[derive(Parser)]
#[command(name = "disk-access-bench")]
struct Args {
    /// Study SBND paths (repeatable).
    #[arg(long = "study", required = true)]
    studies: Vec<PathBuf>,
    #[arg(long, value_enum)]
    arm: Option<Vec<Arm>>,
    #[arg(long, value_enum)]
    trace: Option<Vec<TraceKind>>,
    #[arg(long, value_enum)]
    temp: Option<Vec<Temp>>,
    #[arg(long, default_value_t = 500)]
    heartbeat_us: u64,
    /// Use the decision-relevant arm subset (naive / L3 / hybrid / dedicated / pread).
    #[arg(long, default_value_t = false)]
    decision: bool,
    /// TSV output path (default stdout only).
    #[arg(long)]
    out: Option<PathBuf>,
}

#[derive(Default)]
struct RusageDelta {
    user_us: u64,
    sys_us: u64,
}

fn rusage_now() -> libc::rusage {
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    unsafe {
        libc::getrusage(libc::RUSAGE_SELF, &mut ru);
    }
    ru
}

fn timeval_us(tv: libc::timeval) -> i64 {
    tv.tv_sec as i64 * 1_000_000 + tv.tv_usec as i64
}

fn rusage_delta(before: &libc::rusage, after: &libc::rusage) -> RusageDelta {
    RusageDelta {
        user_us: (timeval_us(after.ru_utime) - timeval_us(before.ru_utime)).max(0) as u64,
        sys_us: (timeval_us(after.ru_stime) - timeval_us(before.ru_stime)).max(0) as u64,
    }
}

fn rss_bytes() -> u64 {
    let Ok(s) = std::fs::read_to_string("/proc/self/status") else {
        return 0;
    };
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb: u64 = rest
                .split_whitespace()
                .next()
                .and_then(|x| x.parse().ok())
                .unwrap_or(0);
            return kb * 1024;
        }
    }
    0
}

fn advise_dontneed(path: &Path) -> Result<()> {
    use std::os::unix::io::AsRawFd;
    let f = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| format!("open {}", path.display()))?;
    f.sync_all().context("fsync")?;
    let rc = unsafe { libc::posix_fadvise(f.as_raw_fd(), 0, 0, libc::POSIX_FADV_DONTNEED) };
    if rc != 0 {
        anyhow::bail!("posix_fadvise(DONTNEED) errno={rc}");
    }
    Ok(())
}

fn make_cold_copy(study: &Path) -> Result<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.local/measurements");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(format!(
        "disk-access-{}-{}.sbnd",
        std::process::id(),
        Instant::now().elapsed().as_nanos()
    ));
    let data = std::fs::read(study)?;
    std::fs::write(&dest, &data)?;
    advise_dontneed(&dest)?;
    Ok(dest)
}

fn build_trace(kind: TraceKind, n: u32) -> Vec<u32> {
    match kind {
        TraceKind::Forward => (0..n).collect(),
        TraceKind::Reverse => (0..n).rev().collect(),
        TraceKind::Random => {
            // Deterministic LCG shuffle of 0..n
            let mut v: Vec<u32> = (0..n).collect();
            let mut state: u64 = 0xC0FFEE ^ u64::from(n);
            for i in (1..v.len()).rev() {
                state = state
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1);
                let j = (state >> 33) as usize % (i + 1);
                v.swap(i, j);
            }
            v
        }
    }
}

fn percentile(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

type FaultJob = Box<dyn FnOnce() + Send>;

/// Single dedicated OS thread for mmap prefaults (isolates faults from Tokio's blocking pool).
fn fault_tx() -> &'static Mutex<mpsc::Sender<FaultJob>> {
    static TX: OnceLock<Mutex<mpsc::Sender<FaultJob>>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<FaultJob>();
        thread::Builder::new()
            .name("mmap-fault".into())
            .spawn(move || {
                while let Ok(job) = rx.recv() {
                    job();
                }
            })
            .expect("spawn mmap-fault thread");
        Mutex::new(tx)
    })
}

async fn dedicated_fault_touch(store: Arc<FrameStore>, idx: u32) -> Result<()> {
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    {
        let tx = fault_tx().lock().expect("fault tx");
        tx.send(Box::new(move || {
            let r = store.touch_frame_pages(idx);
            let _ = done_tx.send(r);
        }))
        .expect("fault queue");
    }
    done_rx.await.context("fault oneshot")??;
    Ok(())
}

struct FrameOutcome {
    latency_ns: u64,
    hop_ns: u64,
    bytes_copied: u64,
}

struct RunRow {
    arm: String,
    study: String,
    temp: String,
    trace: String,
    frames: u32,
    first_frame_ns: u64,
    later_p50_ns: u64,
    later_p99_ns: u64,
    later_mean_ns: u64,
    series_wall_ns: u64,
    stall_mean_ns: u64,
    stall_max_ns: u64,
    stall_samples: u64,
    bytes_copied: u64,
    cpu_user_us: u64,
    cpu_sys_us: u64,
    rss_delta_bytes: i64,
    hop_p50_ns: u64,
}

fn tsv_header() -> &'static str {
    "arm\tstudy\ttemp\ttrace\tframes\tfirst_frame_ns\tlater_p50_ns\tlater_p99_ns\tlater_mean_ns\tseries_wall_ns\tstall_mean_ns\tstall_max_ns\tstall_samples\tbytes_copied\tcpu_user_us\tcpu_sys_us\trss_delta_bytes\thop_p50_ns"
}

impl RunRow {
    fn to_tsv(&self) -> String {
        format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            self.arm,
            self.study,
            self.temp,
            self.trace,
            self.frames,
            self.first_frame_ns,
            self.later_p50_ns,
            self.later_p99_ns,
            self.later_mean_ns,
            self.series_wall_ns,
            self.stall_mean_ns,
            self.stall_max_ns,
            self.stall_samples,
            self.bytes_copied,
            self.cpu_user_us,
            self.cpu_sys_us,
            self.rss_delta_bytes,
            self.hop_p50_ns
        )
    }
}

fn run_cell(
    arm: Arm,
    study_src: &Path,
    temp: Temp,
    trace_kind: TraceKind,
    heartbeat_us: u64,
) -> Result<RunRow> {
    let (path, cleanup) = match temp {
        Temp::Cold => {
            let p = make_cold_copy(study_src)?;
            (p, true)
        }
        Temp::Warm => (study_src.to_path_buf(), false),
    };

    let store = Arc::new(FrameStore::open(&path)?);
    let n = store.frame_count();
    let trace = build_trace(trace_kind, n);

    if matches!(temp, Temp::Warm) {
        for i in 0..n {
            // Warm both mmap pages and, for pread fairness, page cache via touch.
            let _ = store.touch_frame_pages(i);
            let (_, len) = store.frame_range(i)?;
            let mut buf = vec![0u8; len as usize];
            let _ = store.pread_frame(i, &mut buf);
        }
    }

    let rss_before = rss_bytes();
    let ru_before = rusage_now();

    let stop = Arc::new(AtomicBool::new(false));
    let max_delay = Arc::new(AtomicU64::new(0));
    let sum_delay = Arc::new(AtomicU64::new(0));
    let samples = Arc::new(AtomicU64::new(0));
    let period = Duration::from_micros(heartbeat_us);

    let rt = Builder::new_current_thread()
        .enable_all()
        .build()
        .context("tokio rt")?;

    let (latencies, hops, bytes_copied, series_wall_ns) = rt.block_on(async {
        let stop_h = Arc::clone(&stop);
        let max_h = Arc::clone(&max_delay);
        let sum_h = Arc::clone(&sum_delay);
        let n_h = Arc::clone(&samples);
        let hb = tokio::spawn(async move {
            let mut expected = Instant::now() + period;
            while !stop_h.load(Ordering::Relaxed) {
                tokio::time::sleep(period).await;
                let now = Instant::now();
                let delay = now.saturating_duration_since(expected).as_nanos() as u64;
                expected = now + period;
                max_h.fetch_max(delay, Ordering::Relaxed);
                sum_h.fetch_add(delay, Ordering::Relaxed);
                n_h.fetch_add(1, Ordering::Relaxed);
            }
        });

        let store_w = Arc::clone(&store);
        let trace_w = trace.clone();
        let work = tokio::spawn(async move {
            let mut lats = Vec::with_capacity(trace_w.len());
            let mut hops = Vec::with_capacity(trace_w.len());
            let mut bytes = 0u64;
            let wall0 = Instant::now();
            for (i, &idx) in trace_w.iter().enumerate() {
                let next = trace_w.get(i + 1).copied();
                // Inside runtime: use spawn_blocking paths.
                let out = serve_frame_async(arm, &store_w, idx, next).await?;
                lats.push(out.latency_ns);
                if out.hop_ns > 0 {
                    hops.push(out.hop_ns);
                }
                bytes += out.bytes_copied;
            }
            Ok::<_, anyhow::Error>((lats, hops, bytes, wall0.elapsed().as_nanos() as u64))
        });

        let result = work.await.context("work join")??;
        stop.store(true, Ordering::Relaxed);
        let _ = hb.await;
        Ok::<_, anyhow::Error>(result)
    })?;

    let ru_after = rusage_now();
    let rss_after = rss_bytes();
    let cpu = rusage_delta(&ru_before, &ru_after);
    let stall_n = samples.load(Ordering::Relaxed).max(1);
    let stall_sum = sum_delay.load(Ordering::Relaxed);
    let stall_max = max_delay.load(Ordering::Relaxed);

    let first = latencies.first().copied().unwrap_or(0);
    let mut later: Vec<u64> = latencies.iter().skip(1).copied().collect();
    later.sort_unstable();
    let later_mean = if later.is_empty() {
        0
    } else {
        later.iter().sum::<u64>() / later.len() as u64
    };
    let mut hops_sorted = hops;
    hops_sorted.sort_unstable();

    if cleanup {
        let _ = std::fs::remove_file(&path);
    }

    Ok(RunRow {
        arm: arm.as_str().to_string(),
        study: study_src
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("study")
            .to_string(),
        temp: temp.as_str().to_string(),
        trace: trace_kind.as_str().to_string(),
        frames: n,
        first_frame_ns: first,
        later_p50_ns: percentile(&later, 0.50),
        later_p99_ns: percentile(&later, 0.99),
        later_mean_ns: later_mean,
        series_wall_ns,
        stall_mean_ns: stall_sum / stall_n,
        stall_max_ns: stall_max,
        stall_samples: samples.load(Ordering::Relaxed),
        bytes_copied,
        cpu_user_us: cpu.user_us,
        cpu_sys_us: cpu.sys_us,
        rss_delta_bytes: rss_after as i64 - rss_before as i64,
        hop_p50_ns: percentile(&hops_sorted, 0.50),
    })
}

async fn serve_frame_async(
    arm: Arm,
    store: &Arc<FrameStore>,
    idx: u32,
    next: Option<u32>,
) -> Result<FrameOutcome> {
    match arm {
        Arm::MmapNaive => {
            let t0 = Instant::now();
            let slice = store.frame_slice(idx)?;
            touch_pages(slice);
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: 0,
                bytes_copied: 0,
            })
        }
        Arm::MmapBlockingTouch => {
            let t0 = Instant::now();
            let s = Arc::clone(store);
            let th = Instant::now();
            tokio::task::spawn_blocking(move || s.touch_frame_pages(idx))
                .await
                .context("join")??;
            let hop = th.elapsed().as_nanos() as u64;
            let slice = store.frame_slice(idx)?;
            std::hint::black_box(slice.len());
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: 0,
            })
        }
        Arm::MmapHybridMincore => {
            let t0 = Instant::now();
            let mut hop = 0u64;
            if !store.frame_pages_resident(idx).unwrap_or(false) {
                let s = Arc::clone(store);
                let th = Instant::now();
                tokio::task::spawn_blocking(move || s.touch_frame_pages(idx))
                    .await
                    .context("join")??;
                hop = th.elapsed().as_nanos() as u64;
            }
            let slice = store.frame_slice(idx)?;
            std::hint::black_box(slice.len());
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: 0,
            })
        }
        Arm::MmapDedicatedPool => {
            let t0 = Instant::now();
            let s = Arc::clone(store);
            let th = Instant::now();
            dedicated_fault_touch(s, idx).await?;
            let hop = th.elapsed().as_nanos() as u64;
            let slice = store.frame_slice(idx)?;
            std::hint::black_box(slice.len());
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: 0,
            })
        }
        Arm::PreadBlocking => {
            let (_, len) = store.frame_range(idx)?;
            let t0 = Instant::now();
            let s = Arc::clone(store);
            let th = Instant::now();
            let copied = tokio::task::spawn_blocking(move || {
                let mut buf = vec![0u8; len as usize];
                s.pread_frame(idx, &mut buf)?;
                std::hint::black_box(&buf);
                Ok::<u64, anyhow::Error>(len as u64)
            })
            .await
            .context("join")??;
            let hop = th.elapsed().as_nanos() as u64;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: copied,
            })
        }
        Arm::MmapWillneed => {
            let t0 = Instant::now();
            store.advise_frame_willneed(idx)?;
            let slice = store.frame_slice(idx)?;
            touch_pages(slice);
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: 0,
                bytes_copied: 0,
            })
        }
        Arm::MmapWillneedNext => {
            let t0 = Instant::now();
            store.advise_frame_willneed(idx)?;
            if let Some(n) = next {
                let _ = store.advise_frame_willneed(n);
            }
            let slice = store.frame_slice(idx)?;
            touch_pages(slice);
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: 0,
                bytes_copied: 0,
            })
        }
        Arm::MmapBlockingAhead2 => {
            let t0 = Instant::now();
            let s = Arc::clone(store);
            let th = Instant::now();
            tokio::task::spawn_blocking(move || {
                s.touch_frame_pages(idx)?;
                if let Some(n) = next {
                    s.touch_frame_pages(n)?;
                }
                Ok::<(), anyhow::Error>(())
            })
            .await
            .context("join")??;
            let hop = th.elapsed().as_nanos() as u64;
            let slice = store.frame_slice(idx)?;
            std::hint::black_box(slice.len());
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: 0,
            })
        }
    }
}

fn main() -> Result<()> {
    let args = Args::parse();
    let arms = if let Some(a) = args.arm {
        a
    } else if args.decision {
        Arm::decision().to_vec()
    } else {
        Arm::all().to_vec()
    };
    let traces = args
        .trace
        .unwrap_or_else(|| TraceKind::all().to_vec());
    let temps = args.temp.unwrap_or_else(|| Temp::all().to_vec());

    let mut rows = Vec::new();
    println!("{}", tsv_header());
    for study in &args.studies {
        let study = study.canonicalize().context("study")?;
        for &temp in &temps {
            for &trace in &traces {
                for &arm in &arms {
                    let row = run_cell(arm, &study, temp, trace, args.heartbeat_us)?;
                    println!("{}", row.to_tsv());
                    rows.push(row);
                }
            }
        }
    }

    if let Some(out) = args.out {
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut body = String::from(tsv_header());
        body.push('\n');
        for r in &rows {
            body.push_str(&r.to_tsv());
            body.push('\n');
        }
        std::fs::write(&out, body)?;
        eprintln!("wrote {}", out.display());
    }
    Ok(())
}
