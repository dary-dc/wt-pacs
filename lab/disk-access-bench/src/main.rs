//! Disk-access campaign harness (lab-only). Decision record: `docs/disk-access/`.
//! Rejected arms (mincore gate, WILLNEED) use `rejected_access` — not product FrameStore.
//!
//! Instrument (post-review):
//! - Co-tenant `yield_now` gap monitor (ns), not sleep heartbeat
//! - Await once per frame + quinn-shaped chunked write_sim
//! - Every arm consumes frame bytes through the same write step
//! - Cold = one pass (no `i % n` revisits)
//! - Temp cold copies cleaned on Drop
//! - Optional: memory-pressure cell, multi-session load

use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
mod rejected_access;

use exact_server::media::frame_store::FrameStore;
use rejected_access::{advise_frame_willneed, frame_pages_resident};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::runtime::Builder;

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq, Eq)]
enum Arm {
    MmapNaive,
    MmapBlockingTouch,
    MmapHybridMincore,
    MmapDedicatedPool,
    /// Fresh `Vec` per ask (allocation tax included).
    PreadBlocking,
    /// Reused buffer across asks — fair product-shaped `pread` (D3).
    PreadBlockingPooled,
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
            Self::PreadBlockingPooled => "pread_blocking_pooled",
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
            Self::PreadBlockingPooled,
            Self::MmapWillneed,
            Self::MmapWillneedNext,
            Self::MmapBlockingAhead2,
        ]
    }

    fn decision() -> &'static [Arm] {
        &[
            Self::MmapNaive,
            Self::MmapBlockingTouch,
            Self::MmapHybridMincore,
            Self::PreadBlocking,
            Self::PreadBlockingPooled,
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

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq, Eq)]
enum AccessMode {
    /// Whole frame (product path). Prefix modes removed with FrameStore prefix APIs (E5).
    Full,
}

impl AccessMode {
    fn as_str(self) -> &'static str {
        "full"
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
    #[arg(long = "study", required = true)]
    studies: Vec<PathBuf>,
    #[arg(long, value_enum)]
    arm: Option<Vec<Arm>>,
    #[arg(long, value_enum)]
    trace: Option<Vec<TraceKind>>,
    #[arg(long = "trace-file")]
    trace_files: Option<Vec<PathBuf>>,
    #[arg(long, value_enum)]
    temp: Option<Vec<Temp>>,
    #[arg(long, value_enum)]
    access: Option<Vec<AccessMode>>,
    /// Quinn-shaped write chunk size (bytes). Repeatable for 256k + 16k cells.
    #[arg(long, default_value = "16384")]
    chunk: Vec<usize>,
    /// Repeats per cell; report median across repeats.
    #[arg(long, default_value_t = 5)]
    repeats: u32,
    #[arg(long, default_value_t = false)]
    decision: bool,
    #[arg(long, default_value_t = false)]
    realistic: bool,
    /// N concurrent "warm" session tasks while one cold worker runs (multi-session cell).
    #[arg(long, default_value_t = 0)]
    sessions: u32,
    /// Asks per background session during multi-session cell.
    #[arg(long, default_value_t = 200)]
    session_asks: u32,
    /// Abort unless this process is in a cgroup with memory limit ≤ this many bytes.
    /// Used by `run_disk_access_mempressure.sh` so a fake tmpfs "cgroup" cannot silently clear the gate.
    #[arg(long)]
    require_cgroup_mem_bytes: Option<u64>,
    #[arg(long)]
    out: Option<PathBuf>,
}

#[derive(Deserialize)]
struct TraceFileJson {
    name: Option<String>,
    steps: Vec<TraceStep>,
}

#[derive(Deserialize)]
struct TraceStep {
    frame: u32,
}

struct ColdCopy {
    path: PathBuf,
}

impl Drop for ColdCopy {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
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

fn make_cold_copy(study: &Path) -> Result<ColdCopy> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.local/measurements");
    std::fs::create_dir_all(&dir)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let dest = dir.join(format!(
        "disk-access-{}-{}-{}.sbnd",
        std::process::id(),
        stamp,
        seq
    ));
    // Stream copy — avoid loading the whole study into the heap (OOM under cgroup limit).
    {
        let mut src = std::fs::File::open(study)?;
        let mut dst = std::fs::File::create(&dest)?;
        std::io::copy(&mut src, &mut dst)?;
        dst.sync_all()?;
    }
    advise_dontneed(&dest)?;
    Ok(ColdCopy { path: dest })
}

fn build_trace(kind: TraceKind, n: u32) -> Vec<u32> {
    match kind {
        TraceKind::Forward => (0..n).collect(),
        TraceKind::Reverse => (0..n).rev().collect(),
        TraceKind::Random => {
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

fn load_trace_file(path: &Path, frame_count: u32) -> Result<(String, Vec<u32>)> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("read trace {}", path.display()))?;
    let parsed: TraceFileJson =
        serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
    let name = parsed.name.unwrap_or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("trace")
            .to_string()
    });
    let mut frames = Vec::with_capacity(parsed.steps.len());
    for (i, step) in parsed.steps.iter().enumerate() {
        if step.frame >= frame_count {
            anyhow::bail!(
                "trace {} step {i}: frame {} >= study frame_count {frame_count}",
                path.display(),
                step.frame
            );
        }
        frames.push(step.frame);
    }
    if frames.is_empty() {
        anyhow::bail!("trace {} has no steps", path.display());
    }
    Ok((name, frames))
}

fn percentile(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn summarize_gaps(gaps: &mut [u64]) -> (u64, u64, u64, u64) {
    let n = gaps.len() as u64;
    if gaps.is_empty() {
        return (0, 0, 0, 0);
    }
    gaps.sort_unstable();
    (
        percentile(gaps, 0.50),
        percentile(gaps, 0.99),
        *gaps.last().unwrap(),
        n,
    )
}

type FaultJob = Box<dyn FnOnce() + Send>;

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

async fn dedicated_fault_touch(
    store: Arc<FrameStore>,
    idx: u32,
    access: AccessMode,
) -> Result<()> {
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    {
        let tx = fault_tx().lock().expect("fault tx");
        tx.send(Box::new(move || {
            let r = touch_for_access(&store, idx, access);
            let _ = done_tx.send(r);
        }))
        .expect("fault queue");
    }
    done_rx.await.context("fault oneshot")??;
    Ok(())
}

fn touch_for_access(store: &FrameStore, idx: u32, _access: AccessMode) -> Result<()> {
    store.touch_frame_pages(idx)
}

fn resident_for_access(store: &FrameStore, idx: u32, _access: AccessMode) -> Result<bool> {
    frame_pages_resident(store, idx)
}

fn access_len(store: &FrameStore, idx: u32, _access: AccessMode) -> Result<usize> {
    let (_, len) = store.frame_range(idx)?;
    Ok(len as usize)
}

/// Models quinn `write_all`: copy flow-control-sized chunks with an await between them.
async fn write_sim(src: &[u8], chunk: usize, sink: &mut Vec<u8>) {
    let chunk = chunk.max(1);
    for c in src.chunks(chunk) {
        sink.clear();
        sink.extend_from_slice(c);
        std::hint::black_box(sink.len());
        tokio::task::yield_now().await;
    }
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
    access: String,
    chunk: usize,
    repeat: u32,
    frames: u32,
    asks: u32,
    first_frame_ns: u64,
    later_p50_ns: u64,
    later_p99_ns: u64,
    later_mean_ns: u64,
    series_wall_ns: u64,
    gap_p50_ns: u64,
    gap_p99_ns: u64,
    gap_max_ns: u64,
    gap_samples: u64,
    bytes_copied: u64,
    hop_p50_ns: u64,
    /// Multi-session: median per-ask latency of background warm sessions during cold work.
    other_later_p50_ns: u64,
    other_later_p99_ns: u64,
    other_asks: u32,
}

fn tsv_header() -> &'static str {
    "arm\tstudy\ttemp\ttrace\taccess\tchunk\trepeat\tframes\tasks\tfirst_frame_ns\tlater_p50_ns\tlater_p99_ns\tlater_mean_ns\tseries_wall_ns\tgap_p50_ns\tgap_p99_ns\tgap_max_ns\tgap_samples\tbytes_copied\thop_p50_ns\tother_later_p50_ns\tother_later_p99_ns\tother_asks"
}

impl RunRow {
    fn to_tsv(&self) -> String {
        format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            self.arm,
            self.study,
            self.temp,
            self.trace,
            self.access,
            self.chunk,
            self.repeat,
            self.frames,
            self.asks,
            self.first_frame_ns,
            self.later_p50_ns,
            self.later_p99_ns,
            self.later_mean_ns,
            self.series_wall_ns,
            self.gap_p50_ns,
            self.gap_p99_ns,
            self.gap_max_ns,
            self.gap_samples,
            self.bytes_copied,
            self.hop_p50_ns,
            self.other_later_p50_ns,
            self.other_later_p99_ns,
            self.other_asks
        )
    }
}

fn run_cell(
    arm: Arm,
    study_src: &Path,
    temp: Temp,
    trace_name: &str,
    trace: &[u32],
    access: AccessMode,
    chunk: usize,
    repeat: u32,
    sessions: u32,
    session_asks: u32,
) -> Result<RunRow> {
    let cold_guard = match temp {
        Temp::Cold => Some(make_cold_copy(study_src)?),
        Temp::Warm => None,
    };
    let path = cold_guard
        .as_ref()
        .map(|c| c.path.clone())
        .unwrap_or_else(|| study_src.to_path_buf());

    let store = Arc::new(FrameStore::open(&path)?);
    let n = store.frame_count();

    if matches!(temp, Temp::Warm) {
        for &idx in trace {
            touch_for_access(&store, idx, access)?;
            let len = access_len(&store, idx, access)?;
            let mut buf = vec![0u8; len];
            store.pread_frame(idx, &mut buf)?;
        }
    }

    let rt = Builder::new_current_thread()
        .enable_all()
        .build()
        .context("tokio rt")?;

    let (
        latencies,
        hops,
        bytes_copied,
        series_wall_ns,
        mut gaps,
        other_lats,
    ) = rt.block_on(async {
        let stop = Arc::new(AtomicBool::new(false));
        let gap_out: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::new()));
        let stop_m = Arc::clone(&stop);
        let gaps_m = Arc::clone(&gap_out);
        let mon = tokio::spawn(async move {
            let mut local = Vec::with_capacity(64_000);
            while !stop_m.load(Ordering::Relaxed) {
                let t = Instant::now();
                tokio::task::yield_now().await;
                local.push(t.elapsed().as_nanos() as u64);
            }
            *gaps_m.lock().unwrap() = local;
        });

        // Background warm sessions (multi-session cell): measure their ask latency while
        // the primary worker runs — the quantity that decides whether hop latency matters.
        let mut bg_handles = Vec::new();
        let other_lats_acc: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::new()));
        if sessions > 0 {
            // Warm a second mapping of the *source* study so background sessions are hot.
            let bg_store = Arc::new(FrameStore::open(study_src)?);
            for i in 0..bg_store.frame_count() {
                let _ = bg_store.touch_frame_pages(i);
            }
            for _ in 0..sessions {
                let s = Arc::clone(&bg_store);
                let acc = Arc::clone(&other_lats_acc);
                let asks = session_asks;
                bg_handles.push(tokio::spawn(async move {
                    let mut sink = Vec::new();
                    let nframes = s.frame_count();
                    for i in 0..asks {
                        let idx = i % nframes;
                        let t0 = Instant::now();
                        // Always-touch path for background: hop off executor then write_sim.
                        let sc = Arc::clone(&s);
                        tokio::task::spawn_blocking(move || sc.touch_frame_pages(idx))
                            .await
                            .expect("join")
                            .expect("touch");
                        let slice = s.frame_slice(idx).expect("slice");
                        write_sim(slice, chunk, &mut sink).await;
                        acc.lock().unwrap().push(t0.elapsed().as_nanos() as u64);
                    }
                }));
            }
        }

        let store_w = Arc::clone(&store);
        let trace_w = trace.to_vec();
        let work = tokio::spawn(async move {
            let mut lats = Vec::with_capacity(trace_w.len());
            let mut hops = Vec::with_capacity(trace_w.len());
            let mut bytes = 0u64;
            let mut sink = Vec::new();
            let mut pread_pool = Vec::new();
            let wall0 = Instant::now();
            for (i, &idx) in trace_w.iter().enumerate() {
                let next = trace_w.get(i + 1).copied();
                let out = serve_frame_async(
                    arm,
                    &store_w,
                    idx,
                    next,
                    access,
                    chunk,
                    &mut sink,
                    &mut pread_pool,
                )
                .await?;
                lats.push(out.latency_ns);
                if out.hop_ns > 0 {
                    hops.push(out.hop_ns);
                }
                bytes += out.bytes_copied;
            }
            Ok::<_, anyhow::Error>((lats, hops, bytes, wall0.elapsed().as_nanos() as u64))
        });

        let result = work.await.context("work join")??;
        for h in bg_handles {
            let _ = h.await;
        }
        stop.store(true, Ordering::Relaxed);
        // Nudge the monitor so it can observe stop.
        tokio::task::yield_now().await;
        let _ = mon.await;
        let gaps = gap_out.lock().unwrap().clone();
        let other = other_lats_acc.lock().unwrap().clone();
        Ok::<_, anyhow::Error>((
            result.0,
            result.1,
            result.2,
            result.3,
            gaps,
            other,
        ))
    })?;

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
    let (gap_p50, gap_p99, gap_max, gap_n) = summarize_gaps(&mut gaps);
    let mut other = other_lats;
    other.sort_unstable();
    let other_asks = other.len() as u32;

    Ok(RunRow {
        arm: arm.as_str().to_string(),
        study: study_src
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("study")
            .to_string(),
        temp: temp.as_str().to_string(),
        trace: trace_name.to_string(),
        access: access.as_str().to_string(),
        chunk,
        repeat,
        frames: n,
        asks: trace.len() as u32,
        first_frame_ns: first,
        later_p50_ns: percentile(&later, 0.50),
        later_p99_ns: percentile(&later, 0.99),
        later_mean_ns: later_mean,
        series_wall_ns,
        gap_p50_ns: gap_p50,
        gap_p99_ns: gap_p99,
        gap_max_ns: gap_max,
        gap_samples: gap_n,
        bytes_copied,
        hop_p50_ns: percentile(&hops_sorted, 0.50),
        other_later_p50_ns: percentile(&other, 0.50),
        other_later_p99_ns: percentile(&other, 0.99),
        other_asks,
    })
}

async fn serve_frame_async(
    arm: Arm,
    store: &Arc<FrameStore>,
    idx: u32,
    next: Option<u32>,
    access: AccessMode,
    chunk: usize,
    sink: &mut Vec<u8>,
    pread_pool: &mut Vec<u8>,
) -> Result<FrameOutcome> {
    match arm {
        Arm::MmapNaive => {
            let t0 = Instant::now();
            let slice = store.frame_slice(idx)?;
            write_sim(slice, chunk, sink).await;
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
            tokio::task::spawn_blocking(move || touch_for_access(&s, idx, access))
                .await
                .context("join")??;
            let hop = th.elapsed().as_nanos() as u64;
            let slice = store.frame_slice(idx)?;
            write_sim(slice, chunk, sink).await;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: 0,
            })
        }
        Arm::MmapHybridMincore => {
            let t0 = Instant::now();
            let mut hop = 0u64;
            if !resident_for_access(store, idx, access).unwrap_or(false) {
                let s = Arc::clone(store);
                let th = Instant::now();
                tokio::task::spawn_blocking(move || touch_for_access(&s, idx, access))
                    .await
                    .context("join")??;
                hop = th.elapsed().as_nanos() as u64;
            }
            let slice = store.frame_slice(idx)?;
            write_sim(slice, chunk, sink).await;
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
            dedicated_fault_touch(s, idx, access).await?;
            let hop = th.elapsed().as_nanos() as u64;
            let slice = store.frame_slice(idx)?;
            write_sim(slice, chunk, sink).await;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: 0,
            })
        }
        Arm::PreadBlocking => {
            let len = access_len(store, idx, access)?;
            let t0 = Instant::now();
            let s = Arc::clone(store);
            let th = Instant::now();
            let buf = tokio::task::spawn_blocking(move || {
                let mut buf = vec![0u8; len];
                s.pread_frame(idx, &mut buf)?;
                Ok::<Vec<u8>, anyhow::Error>(buf)
            })
            .await
            .context("join")??;
            let hop = th.elapsed().as_nanos() as u64;
            write_sim(&buf, chunk, sink).await;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: len as u64,
            })
        }
        Arm::PreadBlockingPooled => {
            // Reuse one buffer across asks — removes per-frame allocation from the comparison.
            let len = access_len(store, idx, access)?;
            let t0 = Instant::now();
            let s = Arc::clone(store);
            let th = Instant::now();
            let mut buf = std::mem::take(pread_pool);
            buf.resize(len, 0);
            let buf = tokio::task::spawn_blocking(move || {
                s.pread_frame(idx, &mut buf)?;
                Ok::<Vec<u8>, anyhow::Error>(buf)
            })
            .await
            .context("join")??;
            let hop = th.elapsed().as_nanos() as u64;
            write_sim(&buf, chunk, sink).await;
            *pread_pool = buf;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: len as u64,
            })
        }
        Arm::MmapWillneed => {
            let t0 = Instant::now();
            advise_frame_willneed(store, idx)?;
            let slice = store.frame_slice(idx)?;
            write_sim(slice, chunk, sink).await;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: 0,
                bytes_copied: 0,
            })
        }
        Arm::MmapWillneedNext => {
            let t0 = Instant::now();
            advise_frame_willneed(store, idx)?;
            if let Some(n) = next {
                let _ = advise_frame_willneed(store, n);
            }
            let slice = store.frame_slice(idx)?;
            write_sim(slice, chunk, sink).await;
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
                touch_for_access(&s, idx, access)?;
                if let Some(n) = next {
                    touch_for_access(&s, n, access)?;
                }
                Ok::<(), anyhow::Error>(())
            })
            .await
            .context("join")??;
            let hop = th.elapsed().as_nanos() as u64;
            let slice = store.frame_slice(idx)?;
            write_sim(slice, chunk, sink).await;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: 0,
            })
        }
    }
}

enum TraceSpec {
    Synthetic(TraceKind),
    File { name: String, frames: Vec<u32> },
}

/// Confirm we are inside a real memory cgroup with a finite limit ≤ `max_bytes`.
/// Rejects plain files on tmpfs that a buggy wrapper might create as "memory.max".
fn assert_cgroup_mem_limit(max_bytes: u64) -> Result<()> {
    let cg = std::fs::read_to_string("/proc/self/cgroup").context("read /proc/self/cgroup")?;
    // cgroup v2: single line `0::/path`
    let v2_path = cg.lines().find_map(|l| l.strip_prefix("0::"));
    if let Some(rel) = v2_path {
        let base = PathBuf::from(format!("/sys/fs/cgroup{rel}"));
        let max_path = base.join("memory.max");
        let cur_path = base.join("memory.current");
        if !cur_path.is_file() {
            anyhow::bail!(
                "cgroup mem assert failed: {} missing (not a real memory cgroup? path={})",
                cur_path.display(),
                base.display()
            );
        }
        let raw = std::fs::read_to_string(&max_path)
            .with_context(|| format!("read {}", max_path.display()))?
            .trim()
            .to_string();
        if raw == "max" {
            anyhow::bail!(
                "cgroup mem assert failed: memory.max is unlimited at {}",
                max_path.display()
            );
        }
        let got: u64 = raw
            .parse()
            .with_context(|| format!("parse memory.max={raw:?}"))?;
        if got > max_bytes {
            anyhow::bail!(
                "cgroup mem assert failed: memory.max={got} > required ≤{max_bytes} ({})",
                max_path.display()
            );
        }
        eprintln!(
            "cgroup mem assert ok: path={} memory.max={} memory.current={}",
            base.display(),
            got,
            std::fs::read_to_string(&cur_path).unwrap_or_default().trim()
        );
        return Ok(());
    }
    // cgroup v1: memory:/path
    let v1_path = cg.lines().find_map(|l| {
        let mut parts = l.split(':');
        let _id = parts.next()?;
        let ctrl = parts.next()?;
        let path = parts.next()?;
        if ctrl.split(',').any(|c| c == "memory") {
            Some(path)
        } else {
            None
        }
    });
    if let Some(rel) = v1_path {
        let base = PathBuf::from(format!("/sys/fs/cgroup/memory{rel}"));
        let lim_path = base.join("memory.limit_in_bytes");
        let raw = std::fs::read_to_string(&lim_path)
            .with_context(|| format!("read {}", lim_path.display()))?
            .trim()
            .to_string();
        let got: u64 = raw
            .parse()
            .with_context(|| format!("parse memory.limit_in_bytes={raw:?}"))?;
        // v1 "unlimited" is a huge number near 2^63
        if got > max_bytes {
            anyhow::bail!(
                "cgroup mem assert failed: memory.limit_in_bytes={got} > required ≤{max_bytes} ({})",
                lim_path.display()
            );
        }
        eprintln!(
            "cgroup mem assert ok: path={} memory.limit_in_bytes={}",
            base.display(),
            got
        );
        return Ok(());
    }
    anyhow::bail!("cgroup mem assert failed: no memory cgroup in /proc/self/cgroup:\n{cg}")
}

fn main() -> Result<()> {
    let args = Args::parse();
    if let Some(limit) = args.require_cgroup_mem_bytes {
        assert_cgroup_mem_limit(limit)?;
    }
    let arms = if let Some(a) = args.arm {
        a
    } else if args.decision || args.realistic {
        Arm::decision().to_vec()
    } else {
        Arm::all().to_vec()
    };
    let accesses = if let Some(a) = args.access {
        a
    } else {
        vec![AccessMode::Full]
    };
    let temps = args.temp.unwrap_or_else(|| Temp::all().to_vec());
    let chunks = if args.chunk.is_empty() {
        vec![16_384]
    } else {
        args.chunk
    };
    let repeats = args.repeats.max(1);

    let mut rows = Vec::new();
    println!("{}", tsv_header());
    for study in &args.studies {
        let study = study.canonicalize().context("study")?;
        let store_probe = FrameStore::open(&study)?;
        let n = store_probe.frame_count();
        drop(store_probe);

        let traces: Vec<TraceSpec> = if let Some(files) = &args.trace_files {
            files
                .iter()
                .map(|p| {
                    let (name, frames) = load_trace_file(p, n)?;
                    Ok(TraceSpec::File { name, frames })
                })
                .collect::<Result<Vec<_>>>()?
        } else {
            args.trace
                .clone()
                .unwrap_or_else(|| TraceKind::all().to_vec())
                .into_iter()
                .map(TraceSpec::Synthetic)
                .collect()
        };

        for &temp in &temps {
            for &access in &accesses {
                for &chunk in &chunks {
                    for spec in &traces {
                        let (tname, tframes): (&str, Vec<u32>) = match spec {
                            TraceSpec::Synthetic(kind) => (kind.as_str(), build_trace(*kind, n)),
                            TraceSpec::File { name, frames } => (name.as_str(), frames.clone()),
                        };
                        for &arm in &arms {
                            for rep in 1..=repeats {
                                let row = run_cell(
                                    arm,
                                    &study,
                                    temp,
                                    tname,
                                    &tframes,
                                    access,
                                    chunk,
                                    rep,
                                    args.sessions,
                                    args.session_asks,
                                )?;
                                println!("{}", row.to_tsv());
                                rows.push(row);
                            }
                        }
                    }
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
