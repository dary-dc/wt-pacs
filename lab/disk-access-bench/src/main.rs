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
mod candidate_access;
mod rejected_access;
mod uring_access;

use candidate_access::{populate_read, unmap_pages};
use exact_server::media::frame_store::{host_page_size, FrameStore};
use rejected_access::{advise_frame_willneed, frame_pages_resident, touch_frame_pages};
use serde::Deserialize;
use std::fs::File;
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
    /// Touch on the current worker via `block_in_place` — no pool round trip, co-tenants
    /// still evacuated by the runtime. Multi-thread runtime only.
    MmapTouchInPlace,
    /// `madvise(POPULATE_READ)` on the pool instead of a byte-per-page loop.
    MmapPopulateRead,
    /// `preadv2(RWF_NOWAIT)` on the executor; pool `pread` only on the miss. Pooled buffer.
    PreadNowait,
    /// Same, streamed through one small reusable window instead of a whole-frame buffer:
    /// bounds both the executor's uninterrupted copy and per-session memory.
    PreadNowaitChunked,
    /// Control for the pipelined io_uring arms: the *next* window's pool read is issued
    /// before the current window is written, so the hop overlaps the wire instead of
    /// preceding it. Isolates "pipelining" from "io_uring".
    PreadPipelinedPool,
    /// io_uring, unregistered, one window per submit — the strawman.
    UringNaive,
    /// Registered file + registered buffers, every window of the frame in one
    /// `io_uring_enter`. Exploits the only batch this workload has.
    UringTuned,
    /// Registered, double-buffered: window n+1 is submitted before window n is written.
    UringPipelined,
    /// The synthesis: `RWF_NOWAIT` inline for the page-cache hit (no ring work at all on
    /// the common path), io_uring for the shortfall instead of `spawn_blocking`.
    UringNowaitHybrid,
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
            Self::MmapTouchInPlace => "mmap_touch_in_place",
            Self::MmapPopulateRead => "mmap_populate_read",
            Self::PreadNowait => "pread_nowait",
            Self::PreadNowaitChunked => "pread_nowait_chunked",
            Self::PreadPipelinedPool => "pread_pipelined_pool",
            Self::UringNaive => "uring_naive",
            Self::UringTuned => "uring_tuned",
            Self::UringPipelined => "uring_pipelined",
            Self::UringNowaitHybrid => "uring_nowait_hybrid",
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
            Self::MmapTouchInPlace,
            Self::MmapPopulateRead,
            Self::PreadNowait,
            Self::PreadNowaitChunked,
            Self::PreadPipelinedPool,
            Self::UringNaive,
            Self::UringTuned,
            Self::UringPipelined,
            Self::UringNowaitHybrid,
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

    /// Arms that need `block_in_place` — abort early on a current-thread runtime rather
    /// than panicking mid-cell.
    fn needs_multi_thread(self) -> bool {
        matches!(self, Self::MmapTouchInPlace)
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

#[derive(Clone, Copy, Debug, ValueEnum, PartialEq, Eq)]
enum RuntimeKind {
    /// One executor thread — worst case, and what the archived campaign used.
    Current,
    /// Product shape: `#[tokio::main]` multi-thread, work stealing across workers.
    Multi,
}

impl RuntimeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::Multi => "multi",
        }
    }
}

/// Which arm the background sessions run in the multi-session cell.
#[derive(Clone, Copy, Debug, ValueEnum, PartialEq, Eq)]
enum BgArm {
    /// Archived C2 shape: neighbours always use always-touch.
    AlwaysTouch,
    /// Fair all-sessions cell (`later.md`): every session runs the arm under test.
    Same,
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
    /// Executor shape. `multi` matches the product's `#[tokio::main]`.
    #[arg(long, value_enum, default_value_t = RuntimeKind::Current)]
    runtime: RuntimeKind,
    /// Worker threads for `--runtime multi` (default: host CPUs).
    #[arg(long)]
    workers: Option<usize>,
    /// Arm used by background sessions in the multi-session cell.
    #[arg(long, value_enum, default_value_t = BgArm::AlwaysTouch)]
    bg_arm: BgArm,
    /// Co-tenant `yield_now` gap monitors. One (default) matches the archived instrument;
    /// raising it toward `--workers` models a runtime with no idle worker to steal into,
    /// at the cost of pinning every core to a spin loop.
    #[arg(long, default_value_t = 1)]
    monitors: usize,
    /// Read window for `pread-nowait-chunked` (bytes). One `preadv2` per window, so a
    /// small window bounds executor occupancy and session memory but costs more syscalls.
    #[arg(long, default_value_t = 65536)]
    read_chunk: usize,
    /// Start a kernel submission thread for the io_uring arms. Submits then cost no
    /// syscall at all, at the price of a core spinning — check `cpu_us`, not just latency.
    #[arg(long, default_value_t = false)]
    uring_sqpoll: bool,
    /// Abort unless this process is in a cgroup with memory limit ≤ this many bytes.
    /// Used by `run_disk_access_mempressure.sh` so a fake tmpfs "cgroup" cannot silently clear the gate.
    #[arg(long)]
    require_cgroup_mem_bytes: Option<u64>,
    #[arg(long)]
    out: Option<PathBuf>,
    /// Report the instrument's own resolution and overhead, then exit. Every latency column
    /// is nanoseconds; this says how many of those nanoseconds the instrument invented.
    #[arg(long, default_value_t = false)]
    selftest: bool,
    /// Append one row per ask (`arm temp trace repeat ordinal latency_ns hop_ns`).
    ///
    /// A cell's `later_p99` is the 316th of 319 samples — nearly a single observation. Raw
    /// samples let percentiles pool across repeats, which shrinks the error bar on a tail
    /// far more than any change of unit could.
    #[arg(long)]
    samples: Option<PathBuf>,
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

/// Fraction of the study's **frame data** pages resident in this guest's page cache.
///
/// Opening a `FrameStore` parses the header and index, and that read drags readahead into
/// the first frames — so a cold cell has to be verified (and re-evicted) *after* the open,
/// not just after `fadvise`. Header/index pages are excluded: they are pinned by the parse
/// and are not what the arms are timed on.
///
/// Guest-cold is the level the decision needs (does a major fault land on the executor).
/// It says nothing about the hypervisor's own cache, so absolute fault service time still
/// varies run to run — read cold cells for shape (`gap_max`, hop count), not absolutes.
fn data_residency(store: &FrameStore) -> Result<f64> {
    let (resident, total) = page_residency(data_span(store)?)?;
    Ok(if total == 0 {
        0.0
    } else {
        resident as f64 / total as f64
    })
}

/// The study's frame-data region as one contiguous slice of the mmap.
fn data_span(store: &FrameStore) -> Result<&[u8]> {
    let n = store.frame_count();
    if n == 0 {
        return Ok(&[]);
    }
    let first = store.frame_slice(0)?;
    let last = store.frame_slice(n - 1)?;
    let start = first.as_ptr() as usize;
    let end = last.as_ptr() as usize + last.len();
    // SAFETY: [start, end) is one contiguous live subrange of the study mmap; frames are
    // laid out in index order by the SBND writer.
    Ok(unsafe { std::slice::from_raw_parts(start as *const u8, end - start) })
}

fn page_residency(bytes: &[u8]) -> Result<(u64, u64)> {
    if bytes.is_empty() {
        return Ok((0, 0));
    }
    let page = host_page_size();
    let addr = bytes.as_ptr() as usize;
    let start = addr & !(page - 1);
    let len = (addr + bytes.len() - start).div_ceil(page) * page;
    let n = len / page;
    let mut vec = vec![0u8; n];
    // SAFETY: page-aligned subrange of the live study mmap held by the caller's store.
    let rc = unsafe { libc::mincore(start as *mut libc::c_void, len, vec.as_mut_ptr()) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error()).context("mincore residency probe");
    }
    Ok((vec.iter().filter(|b| *b & 1 != 0).count() as u64, n as u64))
}

fn build_trace(kind: TraceKind, n: u32) -> Vec<u32> {
    match kind {
        TraceKind::Forward => (0..n).collect(),
        TraceKind::Reverse => (0..n).rev().collect(),
        TraceKind::Random => {
            let mut v: Vec<u32> = (0..n).collect();
            let mut state: u64 = 0xC0FFEE ^ u64::from(n);
            for i in (1..v.len()).rev() {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                let j = (state >> 33) as usize % (i + 1);
                v.swap(i, j);
            }
            v
        }
    }
}

fn load_trace_file(path: &Path, frame_count: u32) -> Result<(String, Vec<u32>)> {
    let raw =
        std::fs::read_to_string(path).with_context(|| format!("read trace {}", path.display()))?;
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

/// OS threads currently in this process (`/proc/self/status`), 0 if unreadable.
fn process_threads() -> u32 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find_map(|l| l.strip_prefix("Threads:")?.trim().parse::<u32>().ok())
        })
        .unwrap_or(0)
}

/// Process CPU (user + system) so far, in **nanoseconds**.
///
/// `CLOCK_PROCESS_CPUTIME_ID`, not `getrusage`: the latter reports a `timeval`, so it
/// quantises to a microsecond before the kernel's own accounting granularity is even
/// reached. Both are far coarser than the wall clock — see `--selftest`.
fn process_cpu_ns() -> u64 {
    let mut ts: libc::timespec = unsafe { std::mem::zeroed() };
    // SAFETY: `ts` is a live, correctly sized `timespec`.
    if unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut ts) } != 0 {
        return 0;
    }
    ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64
}

/// What the instrument can and cannot see.
///
/// Printed rather than assumed: several columns here are hundreds of nanoseconds, and a
/// number is only worth its last digit if the clock that produced it can resolve one.
fn selftest() {
    const N: usize = 200_000;

    let mut res: libc::timespec = unsafe { std::mem::zeroed() };
    // SAFETY: live `timespec`.
    unsafe { libc::clock_getres(libc::CLOCK_MONOTONIC, &mut res) };
    println!("clock_getres(CLOCK_MONOTONIC)      = {} ns", res.tv_nsec);
    // SAFETY: live `timespec`.
    unsafe { libc::clock_getres(libc::CLOCK_PROCESS_CPUTIME_ID, &mut res) };
    println!("clock_getres(PROCESS_CPUTIME)      = {} ns", res.tv_nsec);

    // Cost of one `Instant::now()` + `elapsed()` pair — the price of every sample.
    let mut pairs = Vec::with_capacity(N);
    for _ in 0..N {
        let t = Instant::now();
        pairs.push(t.elapsed().as_nanos() as u64);
    }
    pairs.sort_unstable();
    let smallest_step = pairs.iter().copied().find(|&v| v > 0).unwrap_or(0);
    println!(
        "Instant::now()+elapsed() overhead  = p50 {} ns · p99 {} ns · min {} ns",
        percentile(&pairs, 0.50),
        percentile(&pairs, 0.99),
        pairs[0]
    );
    println!("smallest non-zero delta observed   = {smallest_step} ns");

    // Monotonic step: consecutive readings, which is the true resolution in practice.
    let mut steps = Vec::with_capacity(N);
    let mut last = Instant::now();
    for _ in 0..N {
        let now = Instant::now();
        steps.push(now.duration_since(last).as_nanos() as u64);
        last = now;
    }
    steps.sort_unstable();
    println!(
        "back-to-back Instant::now() step    = p50 {} ns · p99 {} ns",
        percentile(&steps, 0.50),
        percentile(&steps, 0.99)
    );

    // The gap monitor with nothing to be blocked by: its own floor. Any reported
    // `gap_p50` at or below this is measuring the monitor, not the arm.
    for (label, workers) in [("current", 0usize), ("multi(4)", 4usize)] {
        let rt = if workers == 0 {
            Builder::new_current_thread().enable_all().build().unwrap()
        } else {
            Builder::new_multi_thread()
                .worker_threads(workers)
                .enable_all()
                .build()
                .unwrap()
        };
        let mut gaps = rt.block_on(async {
            let mut g = Vec::with_capacity(N);
            for _ in 0..N {
                let t = Instant::now();
                tokio::task::yield_now().await;
                g.push(t.elapsed().as_nanos() as u64);
            }
            g
        });
        gaps.sort_unstable();
        println!(
            "idle yield_now gap floor [{label:8}]  = p50 {} ns · p99 {} ns · max {} ns",
            percentile(&gaps, 0.50),
            percentile(&gaps, 0.99),
            gaps.last().copied().unwrap_or(0)
        );
    }

    // CPU-clock granularity: how long until the process CPU clock ticks at all.
    let c0 = process_cpu_ns();
    let mut ticks = Vec::new();
    let mut prev = c0;
    let t_end = Instant::now();
    while t_end.elapsed().as_millis() < 50 && ticks.len() < 10_000 {
        let c = process_cpu_ns();
        if c != prev {
            ticks.push(c - prev);
            prev = c;
        }
    }
    ticks.sort_unstable();
    if ticks.is_empty() {
        println!("process CPU clock step             = did not tick in 50 ms");
    } else {
        println!(
            "process CPU clock step             = p50 {} ns · min {} ns ({} ticks)",
            percentile(&ticks, 0.50),
            ticks[0],
            ticks.len()
        );
    }
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

async fn dedicated_fault_touch(store: Arc<FrameStore>, idx: u32, access: AccessMode) -> Result<()> {
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
    touch_frame_pages(store, idx)
}

fn resident_for_access(store: &FrameStore, idx: u32, _access: AccessMode) -> Result<bool> {
    frame_pages_resident(store, idx)
}

fn access_len(store: &FrameStore, idx: u32, _access: AccessMode) -> Result<usize> {
    let (_, len) = store.frame_range(idx)?;
    Ok(len as usize)
}

/// Hand one window buffer to the blocking pool and get it back with the bytes in it.
fn spawn_window_read(
    store: &Arc<FrameStore>,
    slot: &mut Vec<u8>,
    offset: u64,
    window: usize,
    len: usize,
) -> tokio::task::JoinHandle<Result<Vec<u8>>> {
    let mut buf = std::mem::take(slot);
    buf.resize(window, 0);
    let store = Arc::clone(store);
    tokio::task::spawn_blocking(move || {
        store.read_at_blocking(&mut buf[..len], offset)?;
        Ok(buf)
    })
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

/// Per-worker scratch that must survive across frames: reusing it is the difference
/// between measuring an arm and measuring an allocator (and, for io_uring, between
/// measuring reads and measuring `register_buffers`).
struct ArmState {
    sink: Vec<u8>,
    pread_pool: Vec<u8>,
    /// Two buffers for the pipelined pool arm.
    pipe: [Vec<u8>; 2],
    uring: Option<uring_access::UringReader>,
    read_chunk: usize,
    uring_sqpoll: bool,
}

impl ArmState {
    fn new(cfg: &CellCfg) -> Self {
        Self {
            sink: Vec::new(),
            pread_pool: Vec::new(),
            pipe: [Vec::new(), Vec::new()],
            uring: None,
            read_chunk: cfg.read_chunk,
            uring_sqpoll: cfg.uring_sqpoll,
        }
    }
}

/// What an arm needs to serve one frame. Every *shipped* read path — mmap slice, pool
/// `pread`, `RWF_NOWAIT` — goes through the product `FrameStore`, so the lab times shipped
/// code. `file` is a second fd on the same inode (same page cache, same results) for the
/// io_uring arms, which have no product counterpart to borrow one from.
#[derive(Clone)]
struct ServeCtx {
    store: Arc<FrameStore>,
    file: Arc<File>,
}

impl ServeCtx {
    fn open(path: &Path) -> Result<Self> {
        Ok(Self {
            store: Arc::new(FrameStore::open(path)?),
            file: Arc::new(
                File::open(path)
                    .with_context(|| format!("open {} for io_uring", path.display()))?,
            ),
        })
    }
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
    /// Peak OS threads in the process during the cell.
    ///
    /// io_uring spawns io-wq workers per ring and SQPOLL a submitter thread; a per-session
    /// ring therefore has a per-session thread cost that latency does not show.
    threads_max: u32,
    /// Process CPU (user+sys) burned during the timed series, ns.
    ///
    /// io_uring moves work into kernel threads and SQPOLL burns a core outright, so latency
    /// alone cannot rank these arms. Run with `--monitors 0` to read this: the gap monitor
    /// is a spin loop, so otherwise a slower arm is charged more monitor CPU.
    cpu_ns: u64,
    /// Executor shape this cell ran on — `current` (archived) or `multi` (product).
    runtime: String,
    /// Asks that paid a pool round trip. `pread_nowait` reports its page-cache miss count.
    hop_count: u32,
    /// Per-ask `(latency_ns, hop_ns)`, not written to the summary TSV.
    ///
    /// A cell's `later_p99` is the 316th of 319 samples — one observation with a tail's
    /// worth of leverage. `--samples` writes these so a percentile can pool across repeats
    /// and carry a confidence interval instead of a bare number.
    samples: Vec<(u64, u64)>,
}

fn tsv_header() -> &'static str {
    "arm\tstudy\ttemp\ttrace\taccess\tchunk\trepeat\tframes\tasks\tfirst_frame_ns\tlater_p50_ns\tlater_p99_ns\tlater_mean_ns\tseries_wall_ns\tgap_p50_ns\tgap_p99_ns\tgap_max_ns\tgap_samples\tbytes_copied\thop_p50_ns\tother_later_p50_ns\tother_later_p99_ns\tother_asks\tcpu_ns\tthreads_max\truntime\thop_count"
}

impl RunRow {
    fn to_tsv(&self) -> String {
        format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
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
            self.other_asks,
            self.cpu_ns,
            self.threads_max,
            self.runtime,
            self.hop_count
        )
    }
}

/// Everything about a cell that is not the arm under test.
#[derive(Clone, Copy)]
struct CellCfg {
    access: AccessMode,
    chunk: usize,
    sessions: u32,
    session_asks: u32,
    runtime: RuntimeKind,
    workers: usize,
    bg_arm: BgArm,
    monitors: usize,
    read_chunk: usize,
    uring_sqpoll: bool,
}

fn build_runtime(cfg: &CellCfg) -> Result<tokio::runtime::Runtime> {
    match cfg.runtime {
        RuntimeKind::Current => Builder::new_current_thread()
            .enable_all()
            .build()
            .context("tokio current-thread rt"),
        RuntimeKind::Multi => Builder::new_multi_thread()
            .worker_threads(cfg.workers)
            .enable_all()
            .build()
            .context("tokio multi-thread rt"),
    }
}

fn run_cell(
    arm: Arm,
    study_src: &Path,
    temp: Temp,
    trace_name: &str,
    trace: &[u32],
    repeat: u32,
    cfg: CellCfg,
) -> Result<RunRow> {
    let access = cfg.access;
    let chunk = cfg.chunk;
    let cold_guard = match temp {
        Temp::Cold => Some(make_cold_copy(study_src)?),
        Temp::Warm => None,
    };
    let path = cold_guard
        .as_ref()
        .map(|c| c.path.clone())
        .unwrap_or_else(|| study_src.to_path_buf());

    let ctx = ServeCtx::open(&path)?;
    let store = Arc::clone(&ctx.store);
    let n = store.frame_count();

    if matches!(temp, Temp::Cold) {
        // Parsing the header reads ahead into the first frames, and `fadvise` will not
        // evict page-cache pages that are still mapped. Unmap the data region first, then
        // evict, then prove it worked.
        unmap_pages(data_span(&store)?)?;
        advise_dontneed(&path)?;
        let resident = data_residency(&store)?;
        if resident > 0.001 {
            anyhow::bail!(
                "cold cell not cold: {:.2}% of frame data still resident in {}",
                resident * 100.0,
                path.display()
            );
        }
    }

    if matches!(temp, Temp::Warm) {
        for &idx in trace {
            touch_for_access(&store, idx, access)?;
            let len = access_len(&store, idx, access)?;
            let mut buf = vec![0u8; len];
            let (offset, _) = store.frame_range(idx)?;
            store.read_at_blocking(&mut buf, offset)?;
        }
    }

    // A silent EOPNOTSUPP would make the nowait arms look like a hop-free win while they
    // were really doing nothing. `FrameStore` probed at open; refuse to report the arm here.
    if matches!(arm, Arm::PreadNowait | Arm::PreadNowaitChunked) && !store.nowait_supported() {
        anyhow::bail!(
            "RWF_NOWAIT unsupported on {} (overlayfs and tmpfs refuse it) — the nowait arms \
             degrade to whole-frame pooled `pread` there, and reporting them as a separate \
             arm would be misleading",
            path.display()
        );
    }

    let rt = build_runtime(&cfg)?;
    let cpu0 = process_cpu_ns();

    let (latencies, hops, bytes_copied, series_wall_ns, mut gaps, other_lats, samples) = rt
        .block_on(async {
            let stop = Arc::new(AtomicBool::new(false));
            let gap_out: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::new()));
            let monitors = cfg.monitors;
            let mut mons = Vec::with_capacity(monitors);
            for _ in 0..monitors {
                let stop_m = Arc::clone(&stop);
                let gaps_m = Arc::clone(&gap_out);
                mons.push(tokio::spawn(async move {
                    let mut local = Vec::with_capacity(64_000);
                    while !stop_m.load(Ordering::Relaxed) {
                        let t = Instant::now();
                        tokio::task::yield_now().await;
                        local.push(t.elapsed().as_nanos() as u64);
                    }
                    gaps_m.lock().unwrap().extend(local);
                }));
            }

            // Background warm sessions (multi-session cell): measure their ask latency while
            // the primary worker runs — the quantity that decides whether hop latency matters.
            let mut bg_handles = Vec::new();
            let other_lats_acc: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::new()));
            if cfg.sessions > 0 {
                // Warm a second mapping of the *source* study so background sessions are hot.
                let bg_ctx = ServeCtx::open(study_src)?;
                for i in 0..bg_ctx.store.frame_count() {
                    let _ = touch_frame_pages(&bg_ctx.store, i);
                }
                let bg_arm = match cfg.bg_arm {
                    BgArm::AlwaysTouch => Arm::MmapBlockingTouch,
                    BgArm::Same => arm,
                };
                for _ in 0..cfg.sessions {
                    let c = bg_ctx.clone();
                    let acc = Arc::clone(&other_lats_acc);
                    let asks = cfg.session_asks;
                    bg_handles.push(tokio::spawn(async move {
                        let mut state = ArmState::new(&cfg);
                        let nframes = c.store.frame_count();
                        for i in 0..asks {
                            let idx = i % nframes;
                            let t0 = Instant::now();
                            serve_frame_async(
                                bg_arm,
                                &c,
                                idx,
                                Some((i + 1) % nframes),
                                access,
                                chunk,
                                &mut state,
                            )
                            .await
                            .expect("bg serve");
                            acc.lock().unwrap().push(t0.elapsed().as_nanos() as u64);
                        }
                    }));
                }
            }

            let ctx_w = ctx.clone();
            let trace_w = trace.to_vec();
            let work = tokio::spawn(async move {
                let mut lats = Vec::with_capacity(trace_w.len());
                let mut hops = Vec::with_capacity(trace_w.len());
                let mut per_ask: Vec<(u64, u64)> = Vec::with_capacity(trace_w.len());
                let mut bytes = 0u64;
                let mut state = ArmState::new(&cfg);
                let wall0 = Instant::now();
                for (i, &idx) in trace_w.iter().enumerate() {
                    let next = trace_w.get(i + 1).copied();
                    let out = serve_frame_async(arm, &ctx_w, idx, next, access, chunk, &mut state)
                        .await?;
                    lats.push(out.latency_ns);
                    per_ask.push((out.latency_ns, out.hop_ns));
                    if out.hop_ns > 0 {
                        hops.push(out.hop_ns);
                    }
                    bytes += out.bytes_copied;
                }
                Ok::<_, anyhow::Error>((
                    lats,
                    hops,
                    bytes,
                    wall0.elapsed().as_nanos() as u64,
                    per_ask,
                ))
            });

            let result = work.await.context("work join")??;
            for h in bg_handles {
                let _ = h.await;
            }
            stop.store(true, Ordering::Relaxed);
            // Nudge the monitors so they can observe stop.
            tokio::task::yield_now().await;
            for m in mons {
                let _ = m.await;
            }
            let gaps = gap_out.lock().unwrap().clone();
            let other = other_lats_acc.lock().unwrap().clone();
            Ok::<_, anyhow::Error>((
                result.0, result.1, result.2, result.3, gaps, other, result.4,
            ))
        })?;

    let cpu_ns = process_cpu_ns().saturating_sub(cpu0);
    let threads_max = process_threads();
    let first = latencies.first().copied().unwrap_or(0);
    let mut later: Vec<u64> = latencies.iter().skip(1).copied().collect();
    later.sort_unstable();
    let later_mean = if later.is_empty() {
        0
    } else {
        later.iter().sum::<u64>() / later.len() as u64
    };
    let hop_count = hops.len() as u32;
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
        cpu_ns,
        threads_max,
        runtime: cfg.runtime.as_str().to_string(),
        hop_count,
        samples,
    })
}

#[allow(clippy::too_many_arguments)]
async fn serve_frame_async(
    arm: Arm,
    ctx: &ServeCtx,
    idx: u32,
    next: Option<u32>,
    access: AccessMode,
    chunk: usize,
    state: &mut ArmState,
) -> Result<FrameOutcome> {
    let store = &ctx.store;
    let read_chunk = state.read_chunk;
    let uring_sqpoll = state.uring_sqpoll;
    let sink = &mut state.sink;
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
            let (offset, _) = store.frame_range(idx)?;
            let buf = tokio::task::spawn_blocking(move || {
                let mut buf = vec![0u8; len];
                s.read_at_blocking(&mut buf, offset)?;
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
            let mut buf = std::mem::take(&mut state.pread_pool);
            buf.resize(len, 0);
            let (offset, _) = store.frame_range(idx)?;
            let buf = tokio::task::spawn_blocking(move || {
                s.read_at_blocking(&mut buf, offset)?;
                Ok::<Vec<u8>, anyhow::Error>(buf)
            })
            .await
            .context("join")??;
            let hop = th.elapsed().as_nanos() as u64;
            write_sim(&buf, chunk, sink).await;
            state.pread_pool = buf;
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
        Arm::MmapTouchInPlace => {
            // No pool round trip: block on this worker and let the runtime move the
            // co-tenants off it. Warm touch is ~free once the PTEs exist; cold pays the
            // fault here, but tokio has already evacuated the local queue.
            let t0 = Instant::now();
            let th = Instant::now();
            tokio::task::block_in_place(|| touch_for_access(store, idx, access))?;
            let hop = th.elapsed().as_nanos() as u64;
            let slice = store.frame_slice(idx)?;
            write_sim(slice, chunk, sink).await;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: 0,
            })
        }
        Arm::MmapPopulateRead => {
            let t0 = Instant::now();
            let s = Arc::clone(store);
            let th = Instant::now();
            tokio::task::spawn_blocking(move || populate_read(s.frame_slice(idx)?))
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
        Arm::PreadNowait => {
            let (offset, _) = store.frame_range(idx)?;
            let len = access_len(store, idx, access)?;
            let t0 = Instant::now();
            let mut buf = std::mem::take(&mut state.pread_pool);
            buf.resize(len, 0);
            // Page-cache hit: the whole frame lands here with no hop and no fault risk.
            let got = store.read_at_nowait(&mut buf, offset)?;
            let mut hop = 0u64;
            if got < len {
                let s = Arc::clone(store);
                let th = Instant::now();
                buf = tokio::task::spawn_blocking(move || {
                    s.read_at_blocking(&mut buf[got..], offset + got as u64)?;
                    Ok::<Vec<u8>, anyhow::Error>(buf)
                })
                .await
                .context("join")??;
                hop = th.elapsed().as_nanos() as u64;
            }
            write_sim(&buf, chunk, sink).await;
            state.pread_pool = buf;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: len as u64,
            })
        }
        Arm::PreadNowaitChunked => {
            let (offset, _) = store.frame_range(idx)?;
            let len = access_len(store, idx, access)?;
            let window = read_chunk.min(len).max(1);
            let t0 = Instant::now();
            let mut buf = std::mem::take(&mut state.pread_pool);
            buf.resize(window, 0);
            let mut hop = 0u64;
            let mut pos = 0usize;
            while pos < len {
                let this = window.min(len - pos);
                let got = store.read_at_nowait(&mut buf[..this], offset + pos as u64)?;
                if got < this {
                    // Only the missing tail of this window goes to the pool; the readahead
                    // it triggers usually keeps the following windows on the fast path.
                    // This is exactly `stream_codestream` in the product, minus the wire.
                    let s = Arc::clone(store);
                    let at = offset + (pos + got) as u64;
                    let th = Instant::now();
                    buf = tokio::task::spawn_blocking(move || {
                        s.read_at_blocking(&mut buf[got..this], at)?;
                        Ok::<Vec<u8>, anyhow::Error>(buf)
                    })
                    .await
                    .context("join")??;
                    hop += th.elapsed().as_nanos() as u64;
                }
                for c in buf[..this].chunks(chunk) {
                    sink.clear();
                    sink.extend_from_slice(c);
                    std::hint::black_box(sink.len());
                    tokio::task::yield_now().await;
                }
                pos += this;
            }
            state.pread_pool = buf;
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: len as u64,
            })
        }
        Arm::PreadPipelinedPool => {
            // Same pool hop as `pread_blocking_pooled`, but issued one window early so it
            // overlaps `write_sim` instead of preceding it. If pipelining is what helps,
            // this arm captures it without io_uring.
            let (offset, _) = store.frame_range(idx)?;
            let len = access_len(store, idx, access)?;
            let win = read_chunk.min(len).max(1);
            let t0 = Instant::now();
            let mut hop = 0u64;
            let mut slot = 0usize;
            let mut pos = 0usize;
            let first = win.min(len);
            let mut pending = Some(spawn_window_read(
                store,
                &mut state.pipe[slot],
                offset,
                win,
                first,
            ));
            while let Some(handle) = pending.take() {
                let th = Instant::now();
                let buf = handle.await.context("join")??;
                hop += th.elapsed().as_nanos() as u64;
                let this = win.min(len - pos);
                let next_pos = pos + this;
                if next_pos < len {
                    let n = win.min(len - next_pos);
                    pending = Some(spawn_window_read(
                        store,
                        &mut state.pipe[1 - slot],
                        offset + next_pos as u64,
                        win,
                        n,
                    ));
                }
                for c in buf[..this].chunks(chunk) {
                    state.sink.clear();
                    state.sink.extend_from_slice(c);
                    std::hint::black_box(state.sink.len());
                    tokio::task::yield_now().await;
                }
                state.pipe[slot] = buf;
                slot = 1 - slot;
                pos = next_pos;
            }
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                hop_ns: hop,
                bytes_copied: len as u64,
            })
        }
        Arm::UringNaive | Arm::UringTuned | Arm::UringPipelined | Arm::UringNowaitHybrid => {
            let (offset, _) = store.frame_range(idx)?;
            let len = access_len(store, idx, access)?;
            let win = read_chunk.min(len).max(1);
            let windows = len.div_ceil(win);
            let slots = match arm {
                Arm::UringTuned => windows,
                Arm::UringPipelined => 2,
                // Hybrid and naive hold exactly one window, like `pread_nowait_chunked`.
                _ => 1,
            };
            if state.uring.is_none() {
                state.uring = Some(uring_access::UringReader::new(
                    &ctx.file,
                    slots,
                    win,
                    arm != Arm::UringNaive,
                    uring_sqpoll,
                )?);
            }
            let ring = state.uring.as_mut().expect("ring");
            let file = &ctx.file;
            let t0 = Instant::now();
            let mut hop = 0u64;
            let mut waited = 0usize;

            match arm {
                Arm::UringTuned => {
                    // Every window of the frame in one `io_uring_enter` — the only batch
                    // this workload offers.
                    for w in 0..windows {
                        let at = w * win;
                        ring.push(w, file, offset + at as u64, win.min(len - at))?;
                    }
                    ring.submit()?;
                    let th = Instant::now();
                    waited += ring.complete(windows).await?;
                    hop += th.elapsed().as_nanos() as u64;
                    for w in 0..windows {
                        let at = w * win;
                        let this = win.min(len - at);
                        write_sim(&ring.buf(w)[..this], chunk, &mut state.sink).await;
                    }
                }
                Arm::UringPipelined => {
                    // Read window n+1 while window n is on the wire: the read latency hides
                    // behind the write, which a synchronous `pread` cannot do.
                    let mut slot = 0usize;
                    ring.push(slot, file, offset, win.min(len))?;
                    ring.submit()?;
                    let mut pos = 0usize;
                    while pos < len {
                        let this = win.min(len - pos);
                        let th = Instant::now();
                        waited += ring.complete(1).await?;
                        hop += th.elapsed().as_nanos() as u64;
                        let next_pos = pos + this;
                        if next_pos < len {
                            ring.push(
                                1 - slot,
                                file,
                                offset + next_pos as u64,
                                win.min(len - next_pos),
                            )?;
                            ring.submit()?;
                        }
                        write_sim(&ring.buf(slot)[..this], chunk, &mut state.sink).await;
                        slot = 1 - slot;
                        pos = next_pos;
                    }
                }
                Arm::UringNowaitHybrid => {
                    let mut pos = 0usize;
                    while pos < len {
                        let this = win.min(len - pos);
                        let at = offset + pos as u64;
                        let got = store.read_at_nowait(&mut ring.buf_mut(0)[..this], at)?;
                        if got < this {
                            // Miss: finish the window through the ring rather than the
                            // blocking pool. No wasted work — `got` bytes are already in.
                            ring.push_at(0, got, file, at + got as u64, this - got)?;
                            ring.submit()?;
                            let th = Instant::now();
                            waited += ring.complete(1).await?;
                            hop += th.elapsed().as_nanos() as u64;
                        }
                        write_sim(&ring.buf(0)[..this], chunk, &mut state.sink).await;
                        pos += this;
                    }
                }
                _ => {
                    let mut pos = 0usize;
                    while pos < len {
                        let this = win.min(len - pos);
                        ring.push(0, file, offset + pos as u64, this)?;
                        ring.submit()?;
                        let th = Instant::now();
                        waited += ring.complete(1).await?;
                        hop += th.elapsed().as_nanos() as u64;
                        write_sim(&ring.buf(0)[..this], chunk, &mut state.sink).await;
                        pos += this;
                    }
                }
            }
            Ok(FrameOutcome {
                latency_ns: t0.elapsed().as_nanos() as u64,
                // Only completions that had to park count as a hop, so the column stays
                // comparable with `spawn_blocking` round trips.
                hop_ns: if waited > 0 { hop } else { 0 },
                bytes_copied: len as u64,
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
    // A hybrid host mounts an empty v2 hierarchy (`0::/`) *and* the v1 controllers. Only
    // treat the v2 line as authoritative when it actually carries the memory controller;
    // otherwise fall through to v1 rather than declaring the cell fake.
    let v2_path = cg
        .lines()
        .find_map(|l| l.strip_prefix("0::"))
        .filter(|rel| PathBuf::from(format!("/sys/fs/cgroup{rel}/memory.current")).is_file());
    if let Some(rel) = v2_path {
        let base = PathBuf::from(format!("/sys/fs/cgroup{rel}"));
        let max_path = base.join("memory.max");
        let cur_path = base.join("memory.current");
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
            std::fs::read_to_string(&cur_path)
                .unwrap_or_default()
                .trim()
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
    if args.selftest {
        selftest();
        return Ok(());
    }
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
    let workers = args
        .workers
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(4, |n| n.get()));
    if args.runtime == RuntimeKind::Current {
        if let Some(bad) = arms.iter().copied().find(|a| a.needs_multi_thread()) {
            anyhow::bail!(
                "arm {} needs --runtime multi (block_in_place panics on a current-thread runtime)",
                bad.as_str()
            );
        }
    }
    eprintln!(
        "runtime={} workers={} monitors={} bg_arm={:?} repeats={}",
        args.runtime.as_str(),
        workers,
        args.monitors,
        args.bg_arm,
        repeats
    );

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
                        let cfg = CellCfg {
                            access,
                            chunk,
                            sessions: args.sessions,
                            session_asks: args.session_asks,
                            runtime: args.runtime,
                            workers,
                            bg_arm: args.bg_arm,
                            monitors: args.monitors,
                            read_chunk: args.read_chunk.max(1),
                            uring_sqpoll: args.uring_sqpoll,
                        };
                        // Repeat is the OUTER loop: arms interleave round-robin so slow
                        // host drift lands on every arm instead of on whichever arm
                        // happened to run in a hot (or cold) block. Running all repeats of
                        // one arm back to back is how the archived campaign could show
                        // hybrid beating naive, which is impossible by construction.
                        for rep in 1..=repeats {
                            for &arm in &arms {
                                let row = run_cell(arm, &study, temp, tname, &tframes, rep, cfg)?;
                                println!("{}", row.to_tsv());
                                rows.push(row);
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(path) = args.samples {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut body =
            String::from("arm\ttemp\ttrace\tchunk\truntime\trepeat\tordinal\tlatency_ns\thop_ns\n");
        for r in &rows {
            for (i, (lat, hop)) in r.samples.iter().enumerate() {
                body.push_str(&format!(
                    "{}\t{}\t{}\t{}\t{}\t{}\t{i}\t{lat}\t{hop}\n",
                    r.arm, r.temp, r.trace, r.chunk, r.runtime, r.repeat
                ));
            }
        }
        std::fs::write(&path, body)?;
        eprintln!(
            "wrote {} ({} asks)",
            path.display(),
            rows.iter().map(|r| r.samples.len()).sum::<usize>()
        );
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
