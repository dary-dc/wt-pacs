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
use disk_access_bench::candidate_access::{hint_willneed, populate_read, unmap_pages};
use disk_access_bench::{rejected_access, residency, uring_access};
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
    /// bounds both the executor's uninterrupted copy and per-session memory. **The shipped
    /// shape until 2026-09-07**, kept because it is what every earlier number in
    /// `docs/disk-access/` was measured against.
    PreadNowaitChunked,
    /// The accepted path plus one `POSIX_FADV_WILLNEED` for the *next* ask's range.
    ///
    /// The candidate for an access shape read-ahead cannot see — a prefix taken from each
    /// frame, which strides the file. Costs one syscall and no copy, needs no change to how
    /// the study is laid out, and only helps if the hint lands far enough ahead of the ask.
    PreadNowaitPrefetch,
    /// `PreadNowaitChunked`, except that a window which misses sends **the rest of the
    /// frame** to the pool rather than the rest of that window.
    ///
    /// The window exists to bound how long the executor copies without yielding. That
    /// argument applies to the inline `RWF_NOWAIT` read, which only ever happens on a hit
    /// — the blocking read runs on the pool, where a big read costs nothing extra and a
    /// small one costs a whole round trip. Reading 64 KiB there buys nothing and pays
    /// 2-3 device round trips per frame instead of one.
    ///
    /// **This is the shipped shape** — `stream_codestream` in `server/src/transport/`.
    PreadNowaitEscalate,
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
    /// `RWF_NOWAIT` for the **whole frame**, io_uring for the shortfall — the shape
    /// `hybrid_lazyring` has in the read-path campaign, which `uring_nowait_hybrid` does
    /// not, because that one probes per window.
    ///
    /// Against `uring_whole` this isolates the one thing a layout-routed branch would skip:
    /// the inline probe.
    UringNowaitWhole,
    /// Registered, one read for the **whole frame** — no windows at all.
    ///
    /// The windowed arms exist because `RWF_NOWAIT` needs a bounded executor copy. A ring
    /// read never runs on the executor, so it has no such reason to split a frame into
    /// four, and splitting is not free when every read misses: four device round trips
    /// where one would do.
    UringWhole,
    /// Registered, every window of the frame submitted together — but written **as each
    /// one lands** instead of after all of them have.
    ///
    /// `uring_tuned` waits for the whole frame before writing a byte of it, which is why
    /// it was the worst arm on a miss (224 parked completions on a cold random trace).
    /// That is a property of that arm, not of io_uring: the ring can have every window in
    /// flight at once *and* stream. This is what "plain io_uring" should be judged as.
    UringBatchedStream,
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
            Self::PreadNowaitPrefetch => "pread_nowait_prefetch",
            Self::PreadNowaitEscalate => "pread_nowait_escalate",
            Self::PreadPipelinedPool => "pread_pipelined_pool",
            Self::UringNaive => "uring_naive",
            Self::UringTuned => "uring_tuned",
            Self::UringPipelined => "uring_pipelined",
            Self::UringNowaitHybrid => "uring_nowait_hybrid",
            Self::UringNowaitWhole => "uring_nowait_whole",
            Self::UringWhole => "uring_whole",
            Self::UringBatchedStream => "uring_batched_stream",
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
            Self::PreadNowaitPrefetch,
            Self::PreadNowaitEscalate,
            Self::PreadPipelinedPool,
            Self::UringNaive,
            Self::UringTuned,
            Self::UringPipelined,
            Self::UringNowaitHybrid,
            Self::UringNowaitWhole,
            Self::UringWhole,
            Self::UringBatchedStream,
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
    /// Whole frame (product path).
    Full,
}

impl AccessMode {
    fn as_str(self) -> &'static str {
        "full"
    }
}

/// Bytes of each frame actually served — `--prefix` caps it.
///
/// Rung delivery (`docs/adr-resolution-fitting-for-large-frames.md`) sends the first slice
/// of a progressive codestream, not the whole thing. That changes the *shape* of the disk
/// access, not just its size: reads take a prefix and skip the rest of the frame, so the
/// file is strided rather than swept, and the kernel read-ahead the `RWF_NOWAIT` fast path
/// leans on has less to work with. A global rather than a threaded parameter because every
/// arm must see the same lengths for the comparison to mean anything.
static PREFIX_BYTES: AtomicU64 = AtomicU64::new(0);

fn served_len(whole: u32) -> usize {
    match PREFIX_BYTES.load(Ordering::Relaxed) {
        0 => whole as usize,
        p => (p as usize).min(whole as usize),
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
    /// Study bundles to measure. Required for every mode except `--selftest`, which
    /// measures the instrument itself and never opens a study.
    #[arg(long = "study", required_unless_present = "selftest")]
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
    /// Serve only the first N bytes of each frame — the rung/prefix delivery shape. Reads
    /// then stride over the file instead of sweeping it, which is what a progressive
    /// codestream fitted to a viewport actually asks for. `0` = whole frames.
    #[arg(long, default_value_t = 0)]
    prefix: u64,
    /// Start a kernel submission thread for the io_uring arms. Submits then cost no
    /// syscall at all, at the price of a core spinning — check `cpu_us`, not just latency.
    #[arg(long, default_value_t = false)]
    uring_sqpoll: bool,
    /// Windows `uring_pipelined` keeps in flight. 2 reproduces the first campaign's arm.
    #[arg(long, default_value_t = 2)]
    uring_depth: usize,
    /// Cap Tokio's blocking pool (default: Tokio's own 512).
    #[arg(long)]
    max_blocking: Option<usize>,

    // ---- miss-ratio campaign (`--mix`) ----
    /// Fraction of a cell's frames that must **miss** the page cache, verified with
    /// `mincore` before the cell runs. Repeatable to sweep.
    ///
    /// The first campaign had only warm (every ask hits) and cold (read-ahead decides).
    /// Neither answers "what happens at 60% misses", and cold-forward is not even
    /// miss-dominated: 6 of 320 asks paid a hop. Passing this switches the harness to the
    /// mix campaign — `--temp` and the single-primary multi-session cell do not apply.
    #[arg(long = "mix")]
    mixes: Option<Vec<f64>>,
    /// Sessions run **together**, all on the arm under test, all measured. The first
    /// campaign's `--sessions` had warm background sessions around one cold primary, so no
    /// cell ever had more than one session on the miss path. Repeatable to sweep.
    #[arg(long = "concurrency")]
    concurrencies: Option<Vec<u32>>,
    /// Frames per mix cell, split evenly across the sessions.
    ///
    /// Each cell takes the **next** region of the study so the hypervisor's cache cannot
    /// follow one arm around: an 80 MB study re-read runs 10x faster on the second pass
    /// here, which is the effect that made the first campaign's cold cells unreadable.
    #[arg(long, default_value_t = 256)]
    region_frames: u32,
    /// Pin every mix cell to the same region instead of rotating — the control that says
    /// whether rotation is doing anything.
    #[arg(long, default_value_t = false)]
    region_fixed: bool,
    /// Frames between the frames a cell asks for.
    ///
    /// 1 means a contiguous region, and on this host that is **not a miss-dominated cell
    /// however cold it is**: read-ahead is 8 MB, so the first miss drags in the next ~32
    /// frames and a fully evicted 256-frame region pays 4 hops, not 256. A stride past the
    /// read-ahead window (>= 33 frames at 250 KB) is what makes an evicted frame an
    /// isolated miss — which is what "the working set exceeds RAM" actually means for an
    /// ask.
    #[arg(long, default_value_t = 1)]
    region_stride: u32,
    /// Seed for which frames are chosen to miss.
    #[arg(long, default_value_t = 0x5EED)]
    mix_seed: u64,
    /// Summary TSV for the mix campaign (one row per cell).
    #[arg(long)]
    mix_out: Option<PathBuf>,
    /// One row per ask for the mix campaign, so percentiles pool across repeats.
    #[arg(long)]
    mix_samples: Option<PathBuf>,
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
    // Read-ahead is not an instrument property, but it decides how many asks miss — which
    // is the axis the mix cells sweep. This host ships 8192 KB, 64x the usual 128, and at
    // that size reading one 250 KB frame pulls in the next ~32.
    let ra = std::fs::read_dir("/sys/block")
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let v = std::fs::read_to_string(e.path().join("queue/read_ahead_kb")).ok()?;
            Some(format!("{}={}", e.file_name().to_string_lossy(), v.trim()))
        })
        .collect::<Vec<_>>()
        .join(" ");
    println!("read_ahead_kb                      = {ra}");

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
    Ok(served_len(len))
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
    /// Round trips this ask had to park on: `spawn_blocking` joins for the pool arms,
    /// eventfd parks for the io_uring ones.
    ///
    /// `hop_ns` cannot distinguish one 400 us hop from four 100 us ones, and that is
    /// exactly the difference between a whole-frame read and a windowed one when every
    /// read misses. `stream_codestream` documents "one pool round trip per frame either
    /// way, never one per window" — true only while read-ahead serves the windows behind
    /// the first.
    hop_events: u32,
    /// Time spent inside `read_at_nowait` on calls that **came up short**, and the bytes
    /// those calls returned before giving up.
    ///
    /// The gap between an arm that probes and one that does not is supposed to be exactly
    /// this. Measuring it directly says whether the probe is a wasted syscall (returns 0,
    /// costs a syscall) or real work (returns a partial frame, and those bytes are kept) —
    /// which is the difference between skipping it being worth 10 us and worth 2.
    probe_ns: u64,
    probe_got: u64,
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
    uring_depth: usize,
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
            uring_depth: cfg.uring_depth,
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
    /// Kept so the mix cells can `fadvise` the same inode the arms read from.
    path: PathBuf,
}

impl ServeCtx {
    fn open(path: &Path) -> Result<Self> {
        Ok(Self {
            store: Arc::new(FrameStore::open(path)?),
            file: Arc::new(
                File::open(path)
                    .with_context(|| format!("open {} for io_uring", path.display()))?,
            ),
            path: path.to_path_buf(),
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
    /// Windows kept in flight by `uring_pipelined`. 2 is the arm the campaign measured.
    uring_depth: usize,
    /// Cap on Tokio's blocking pool. Tokio's default is 512, which is not a pool an
    /// operator would run — and the cap is exactly what decides whether a miss-dominated
    /// `spawn_blocking` path queues or just grows threads.
    max_blocking: Option<usize>,
}

fn build_runtime(cfg: &CellCfg) -> Result<tokio::runtime::Runtime> {
    match cfg.runtime {
        RuntimeKind::Current => {
            let mut b = Builder::new_current_thread();
            b.enable_all();
            if let Some(n) = cfg.max_blocking {
                b.max_blocking_threads(n);
            }
            b.build().context("tokio current-thread rt")
        }
        RuntimeKind::Multi => {
            let mut b = Builder::new_multi_thread();
            b.worker_threads(cfg.workers).enable_all();
            if let Some(n) = cfg.max_blocking {
                b.max_blocking_threads(n);
            }
            b.build().context("tokio multi-thread rt")
        }
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
                hop_events: 0,
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: u32::from(hop > 0),
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: u32::from(hop > 0),
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: u32::from(hop > 0),
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: u32::from(hop > 0),
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: u32::from(hop > 0),
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: 0,
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: 0,
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: u32::from(hop > 0),
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: u32::from(hop > 0),
                probe_ns: 0,
                probe_got: 0,
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
                hop_events: u32::from(hop > 0),
                probe_ns: 0,
                probe_got: 0,
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
            let mut hop_events = 0u32;
            let mut pos = 0usize;
            while pos < len {
                let this = window.min(len - pos);
                let got = store.read_at_nowait(&mut buf[..this], offset + pos as u64)?;
                if got < this {
                    hop_events += 1;
                    // Only the missing tail of *this window* goes to the pool. That was
                    // `stream_codestream` until 2026-09-07; it now escalates to the rest of
                    // the frame — see `PreadNowaitEscalate` and `docs/disk-access/RERUN-miss.md`.
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
                hop_events,
                probe_ns: 0,
                probe_got: 0,
            })
        }
        Arm::PreadNowaitEscalate => {
            // Window the executor's reads; do not window the pool's.
            let (offset, _) = store.frame_range(idx)?;
            let len = access_len(store, idx, access)?;
            let window = read_chunk.min(len).max(1);
            let t0 = Instant::now();
            let mut buf = std::mem::take(&mut state.pread_pool);
            let mut hop = 0u64;
            let mut hop_events = 0u32;
            let mut probe_ns = 0u64;
            let mut probe_got = 0u64;
            let mut pos = 0usize;
            while pos < len {
                let this = window.min(len - pos);
                if buf.len() < this {
                    buf.resize(this, 0);
                }
                let tp = Instant::now();
                let got = store.read_at_nowait(&mut buf[..this], offset + pos as u64)?;
                let probe_this = tp.elapsed().as_nanos() as u64;
                if got < this {
                    probe_ns += probe_this;
                    probe_got += got as u64;
                    // Miss. One round trip for everything still outstanding in this frame,
                    // not one per window — the pool is where a large read is free.
                    let rest = len - pos - got;
                    if buf.len() < got + rest {
                        buf.resize(got + rest, 0);
                    }
                    let s = Arc::clone(store);
                    let at = offset + (pos + got) as u64;
                    let th = Instant::now();
                    buf = tokio::task::spawn_blocking(move || {
                        s.read_at_blocking(&mut buf[got..got + rest], at)?;
                        Ok::<Vec<u8>, anyhow::Error>(buf)
                    })
                    .await
                    .context("join")??;
                    hop += th.elapsed().as_nanos() as u64;
                    hop_events += 1;
                    // Still write in `window` pieces: the executor's copy bound is the
                    // point of the window, and it survives the bigger read.
                    for piece in buf[..got + rest].chunks(window) {
                        for c in piece.chunks(chunk) {
                            sink.clear();
                            sink.extend_from_slice(c);
                            std::hint::black_box(sink.len());
                            tokio::task::yield_now().await;
                        }
                    }
                    pos = len;
                    continue;
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
                hop_events,
                probe_ns,
                probe_got,
            })
        }
        Arm::PreadNowaitPrefetch => {
            // The hint goes out *before* this ask's own reads, so the kernel has this whole
            // ask's duration to satisfy it. That is the entire mechanism: it only helps if
            // one ask takes longer than one read-ahead, which is a property of the
            // deployment's storage, not of this code.
            if let Some(n) = next {
                let (noff, nlen) = store.frame_range(n)?;
                hint_willneed(&ctx.file, noff, served_len(nlen));
            }

            let (offset, _) = store.frame_range(idx)?;
            let len = access_len(store, idx, access)?;
            let window = read_chunk.min(len).max(1);
            let t0 = Instant::now();
            let mut buf = std::mem::take(&mut state.pread_pool);
            buf.resize(window, 0);
            let mut hop = 0u64;
            let mut hop_events = 0u32;
            let mut pos = 0usize;
            while pos < len {
                let this = window.min(len - pos);
                let got = store.read_at_nowait(&mut buf[..this], offset + pos as u64)?;
                if got < this {
                    hop_events += 1;
                    // Only the missing tail of *this window* goes to the pool — the shape
                    // `stream_codestream` had until 2026-09-07. See `PreadNowaitEscalate`.
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
                hop_events,
                probe_ns: 0,
                probe_got: 0,
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
            let mut hop_events = 0u32;
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
                hop_events += 1;
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
                hop_events,
                probe_ns: 0,
                probe_got: 0,
            })
        }
        Arm::UringNaive
        | Arm::UringTuned
        | Arm::UringPipelined
        | Arm::UringNowaitHybrid
        | Arm::UringNowaitWhole
        | Arm::UringWhole
        | Arm::UringBatchedStream => {
            let (offset, _) = store.frame_range(idx)?;
            let len = access_len(store, idx, access)?;
            // The whole-frame arm ignores `--read-chunk`: one read is the point of it.
            let win = if matches!(arm, Arm::UringWhole | Arm::UringNowaitWhole) {
                len.max(1)
            } else {
                read_chunk.min(len).max(1)
            };
            let windows = len.div_ceil(win);
            if state.uring.is_none() {
                // Registered buffers are allocated once and reused for every ask, so their
                // geometry must cover the study's **longest** frame — not whichever frame
                // was asked for first. HTJ2K frames are variable length; sizing from frame
                // 0 reads past the buffer as soon as a longer frame arrives. The campaign
                // fixture is fixed-size (320 x 250 000 B), which is why this never fired
                // there: with `max_len == len` the geometry below is bit-identical to
                // sizing from the first frame.
                let mut max_len = len;
                for i in 0..store.frame_count() {
                    let (_, l) = store.frame_range(i)?;
                    max_len = max_len.max(l as usize);
                }
                let (win_len, batched_slots) = uring_access::ring_geometry(read_chunk, max_len);
                // `uring_whole` reads a frame per submit, so its one buffer has to be the
                // longest frame rather than a window of it.
                let (buf_len, slots) = match arm {
                    Arm::UringWhole | Arm::UringNowaitWhole => (max_len.max(1), 1),
                    Arm::UringTuned | Arm::UringBatchedStream => (win_len, batched_slots),
                    Arm::UringPipelined => {
                        (win_len, state.uring_depth.max(2).min(batched_slots.max(2)))
                    }
                    // Hybrid and naive hold exactly one window, like `pread_nowait_chunked`.
                    _ => (win_len, 1),
                };
                state.uring = Some(uring_access::UringReader::new(
                    &ctx.file,
                    slots,
                    buf_len,
                    arm != Arm::UringNaive,
                    uring_sqpoll,
                )?);
            }
            let ring = state.uring.as_mut().expect("ring");
            let file = &ctx.file;
            let t0 = Instant::now();
            let mut hop = 0u64;
            let mut waited = 0usize;
            let mut probe_ns = 0u64;
            let mut probe_got = 0u64;

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
                    // behind the write, which a synchronous `pread` cannot do. `depth` is
                    // how many windows may be in flight; 2 is the shape the first campaign
                    // measured, and the flag exists because a miss-dominated cell is the
                    // one place a deeper queue could pay for itself. It comes from the ring
                    // rather than from this frame — the ring was sized for the study's
                    // longest frame, and indexing past its slots would panic.
                    let depth = ring.slots().max(2);
                    let mut issued = 0usize;
                    let mut done = 0usize;
                    while issued < windows && issued < depth {
                        let at = issued * win;
                        ring.push(issued % depth, file, offset + at as u64, win.min(len - at))?;
                        issued += 1;
                    }
                    ring.submit()?;
                    while done < windows {
                        let slot = done % depth;
                        let at = done * win;
                        let this = win.min(len - at);
                        let th = Instant::now();
                        waited += ring.complete_slot(slot).await?;
                        hop += th.elapsed().as_nanos() as u64;
                        // Issue before writing, into a slot that is neither in flight nor
                        // the one about to be written.
                        if issued < windows && issued - done < depth {
                            let nat = issued * win;
                            ring.push(
                                issued % depth,
                                file,
                                offset + nat as u64,
                                win.min(len - nat),
                            )?;
                            ring.submit()?;
                            issued += 1;
                        }
                        write_sim(&ring.buf(slot)[..this], chunk, &mut state.sink).await;
                        done += 1;
                    }
                }
                Arm::UringNowaitWhole => {
                    // Probe the whole frame inline; the ring finishes whatever is missing.
                    let tp = Instant::now();
                    let got = store.read_at_nowait(&mut ring.buf_mut(0)[..len], offset)?;
                    let probe_this = tp.elapsed().as_nanos() as u64;
                    if got < len {
                        probe_ns += probe_this;
                        probe_got += got as u64;
                        ring.push_at(0, got, file, offset + got as u64, len - got)?;
                        ring.submit()?;
                        let th = Instant::now();
                        waited += ring.complete_slot(0).await?;
                        hop += th.elapsed().as_nanos() as u64;
                    }
                    write_sim(&ring.buf(0)[..len], chunk, &mut state.sink).await;
                }
                Arm::UringWhole => {
                    ring.push(0, file, offset, len)?;
                    ring.submit()?;
                    let th = Instant::now();
                    waited += ring.complete_slot(0).await?;
                    hop += th.elapsed().as_nanos() as u64;
                    write_sim(&ring.buf(0)[..len], chunk, &mut state.sink).await;
                }
                Arm::UringBatchedStream => {
                    // Every window in flight at once, like `uring_tuned` — but each one is
                    // written the moment it lands instead of after the last one does. The
                    // difference only shows when reads miss, which is the cell this arm was
                    // added for.
                    for w in 0..windows {
                        let at = w * win;
                        ring.push(w, file, offset + at as u64, win.min(len - at))?;
                    }
                    ring.submit()?;
                    for w in 0..windows {
                        let at = w * win;
                        let this = win.min(len - at);
                        let th = Instant::now();
                        waited += ring.complete_slot(w).await?;
                        hop += th.elapsed().as_nanos() as u64;
                        write_sim(&ring.buf(w)[..this], chunk, &mut state.sink).await;
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
                hop_events: waited as u32,
                probe_ns,
                probe_got,
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
                hop_events: u32::from(hop > 0),
                probe_ns: 0,
                probe_got: 0,
            })
        }
    }
}

/// One mix cell: `concurrency` sessions, each on its own slice of a region whose
/// page-cache residency was set and verified before the cell started.
struct MixRow {
    arm: String,
    trace: String,
    repeat: u32,
    concurrency: u32,
    region_start: u32,
    region_frames: u32,
    region_stride: u32,
    mix_target: f64,
    mix_achieved: f64,
    hit_resident: f64,
    miss_resident: f64,
    asks: u32,
    wall_ns: u64,
    throughput_fps: f64,
    p50_ns: u64,
    p90_ns: u64,
    p99_ns: u64,
    max_ns: u64,
    hop_count: u32,
    /// Total pool/eventfd round trips, which `hop_count` (asks that hopped at all) hides:
    /// four 100 us window hops and one 400 us frame hop look identical there.
    hop_events: u64,
    /// Median time in a `read_at_nowait` call that came up short, and the median bytes it
    /// returned. Zero for arms that never probe. See `FrameOutcome::probe_ns`.
    probe_ns_p50: u64,
    probe_got_p50: u64,
    hop_p50_ns: u64,
    hop_p99_ns: u64,
    gap_p99_ns: u64,
    gap_max_ns: u64,
    cpu_ns: u64,
    cpu_per_ask_ns: u64,
    threads_max: u32,
    read_chunk: usize,
    uring_depth: usize,
    runtime: String,
    samples: Vec<(u64, u64, u32, u64, u64)>,
}

fn mix_tsv_header() -> &'static str {
    "arm\ttrace\trepeat\tconcurrency\tregion_start\tregion_frames\tregion_stride\tmix_target\tmix_achieved\thit_resident\tmiss_resident\tasks\twall_ns\tthroughput_fps\tp50_ns\tp90_ns\tp99_ns\tmax_ns\thop_count\thop_events\tprobe_ns_p50\tprobe_got_p50\thop_p50_ns\thop_p99_ns\tgap_p99_ns\tgap_max_ns\tcpu_ns\tcpu_per_ask_ns\tthreads_max\tread_chunk\turing_depth\truntime"
}

impl MixRow {
    fn to_tsv(&self) -> String {
        format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{:.4}\t{:.4}\t{:.4}\t{:.4}\t{}\t{}\t{:.1}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            self.arm,
            self.trace,
            self.repeat,
            self.concurrency,
            self.region_start,
            self.region_frames,
            self.region_stride,
            self.mix_target,
            self.mix_achieved,
            self.hit_resident,
            self.miss_resident,
            self.asks,
            self.wall_ns,
            self.throughput_fps,
            self.p50_ns,
            self.p90_ns,
            self.p99_ns,
            self.max_ns,
            self.hop_count,
            self.hop_events,
            self.probe_ns_p50,
            self.probe_got_p50,
            self.hop_p50_ns,
            self.hop_p99_ns,
            self.gap_p99_ns,
            self.gap_max_ns,
            self.cpu_ns,
            self.cpu_per_ask_ns,
            self.threads_max,
            self.read_chunk,
            self.uring_depth,
            self.runtime
        )
    }
}

/// Everything a mix cell needs that is not the arm.
#[derive(Clone, Copy)]
struct MixCfg {
    cell: CellCfg,
    mix: f64,
    concurrency: u32,
    region_start: u32,
    region_frames: u32,
    region_stride: u32,
    seed: u64,
}

/// Run one mix cell.
///
/// Shape, and why: every session is measured (there is no privileged "primary"), every
/// session runs the arm under test, and the sessions share one `FrameStore` — which is
/// also what the product does, so read-ahead state is shared between them exactly as it
/// would be in production.
fn run_mix_cell(
    arm: Arm,
    ctx: &ServeCtx,
    mcfg: MixCfg,
    trace: TraceKind,
    repeat: u32,
) -> Result<MixRow> {
    let cfg = mcfg.cell;
    let store = &ctx.store;
    let stride = mcfg.region_stride.max(1);
    let region: Vec<u32> = (0..mcfg.region_frames)
        .map(|i| mcfg.region_start + i * stride)
        .collect();

    if matches!(
        arm,
        Arm::PreadNowait
            | Arm::PreadNowaitChunked
            | Arm::PreadNowaitEscalate
            | Arm::UringNowaitWhole
    ) && !store.nowait_supported()
    {
        anyhow::bail!(
            "RWF_NOWAIT unsupported on this study — the nowait arms are not themselves here"
        );
    }

    // Residency is set per cell, not per campaign: reading the region is what warms it, so
    // the arm that ran before this one left it warm.
    let plan = residency::MixPlan::build(&region, mcfg.mix, mcfg.seed ^ u64::from(repeat) << 32);
    let report = residency::apply(store, &ctx.path, data_span(store)?, &plan)?;
    if (report.achieved - report.target).abs() > 0.05 {
        anyhow::bail!(
            "mix cell missed its target: asked {:.0}% misses, got {:.0}% (hit set {:.1}% resident, miss set {:.1}%)",
            report.target * 100.0,
            report.achieved * 100.0,
            report.hit_resident * 100.0,
            report.miss_resident * 100.0
        );
    }

    let n_sessions = mcfg.concurrency.max(1) as usize;
    let per = region.len() / n_sessions;
    if per == 0 {
        anyhow::bail!(
            "--region-frames {} cannot be split across --concurrency {}",
            mcfg.region_frames,
            n_sessions
        );
    }
    let mut partitions: Vec<Vec<u32>> = Vec::with_capacity(n_sessions);
    for s in 0..n_sessions {
        let mut part: Vec<u32> = region[s * per..(s + 1) * per].to_vec();
        match trace {
            TraceKind::Forward => {}
            TraceKind::Reverse => part.reverse(),
            TraceKind::Random => {
                let mut state = mcfg.seed ^ (s as u64).wrapping_mul(0x9E37_79B9);
                for i in (1..part.len()).rev() {
                    state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                    let j = (state >> 33) as usize % (i + 1);
                    part.swap(i, j);
                }
            }
        }
        partitions.push(part);
    }

    let rt = build_runtime(&cfg)?;
    let cpu0 = process_cpu_ns();
    let (per_ask, wall_ns, mut gaps) = rt.block_on(async {
        let stop = Arc::new(AtomicBool::new(false));
        let gap_out: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::new()));
        let mut mons = Vec::with_capacity(cfg.monitors);
        for _ in 0..cfg.monitors {
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

        // Sessions start together: a staggered start would measure the ramp, and the whole
        // question here is what happens when they are all on the miss path at once.
        let gate = Arc::new(tokio::sync::Barrier::new(n_sessions + 1));
        let acc: Arc<Mutex<Vec<(u64, u64, u32, u64, u64)>>> = Arc::new(Mutex::new(Vec::new()));
        let mut handles = Vec::with_capacity(n_sessions);
        for part in partitions {
            let c = ctx.clone();
            let gate = Arc::clone(&gate);
            let acc = Arc::clone(&acc);
            handles.push(tokio::spawn(async move {
                let mut state = ArmState::new(&cfg);
                let mut mine: Vec<(u64, u64, u32, u64, u64)> = Vec::with_capacity(part.len());
                gate.wait().await;
                for (i, &idx) in part.iter().enumerate() {
                    let next = part.get(i + 1).copied();
                    let t0 = Instant::now();
                    let out =
                        serve_frame_async(arm, &c, idx, next, cfg.access, cfg.chunk, &mut state)
                            .await?;
                    mine.push((
                        t0.elapsed().as_nanos() as u64,
                        out.hop_ns,
                        out.hop_events,
                        out.probe_ns,
                        out.probe_got,
                    ));
                }
                acc.lock().unwrap().extend(mine);
                Ok::<(), anyhow::Error>(())
            }));
        }
        gate.wait().await;
        let wall0 = Instant::now();
        for h in handles {
            h.await.context("session join")??;
        }
        let wall = wall0.elapsed().as_nanos() as u64;
        stop.store(true, Ordering::Relaxed);
        tokio::task::yield_now().await;
        for m in mons {
            let _ = m.await;
        }
        let gaps = gap_out.lock().unwrap().clone();
        let out = acc.lock().unwrap().clone();
        Ok::<_, anyhow::Error>((out, wall, gaps))
    })?;

    let cpu_ns = process_cpu_ns().saturating_sub(cpu0);
    let threads_max = process_threads();
    let mut lats: Vec<u64> = per_ask.iter().map(|(l, ..)| *l).collect();
    lats.sort_unstable();
    let mut hops: Vec<u64> = per_ask
        .iter()
        .map(|(_, h, ..)| *h)
        .filter(|h| *h > 0)
        .collect();
    hops.sort_unstable();
    let hop_events: u64 = per_ask.iter().map(|(_, _, e, _, _)| u64::from(*e)).sum();
    // Only asks that actually probed and came up short say anything about the probe.
    let mut probe_ns: Vec<u64> = per_ask.iter().map(|(.., n, _)| *n).filter(|n| *n > 0).collect();
    let mut probe_got: Vec<u64> = per_ask
        .iter()
        .filter(|(.., n, _)| *n > 0)
        .map(|(.., g)| *g)
        .collect();
    probe_ns.sort_unstable();
    probe_got.sort_unstable();
    let probe_ns_p50 = percentile(&probe_ns, 0.50);
    let probe_got_p50 = percentile(&probe_got, 0.50);
    let (_, gap_p99, gap_max, _) = summarize_gaps(&mut gaps);
    let asks = lats.len() as u32;

    Ok(MixRow {
        arm: arm.as_str().to_string(),
        trace: trace.as_str().to_string(),
        repeat,
        concurrency: mcfg.concurrency,
        region_start: mcfg.region_start,
        region_frames: mcfg.region_frames,
        region_stride: stride,
        mix_target: report.target,
        mix_achieved: report.achieved,
        hit_resident: report.hit_resident,
        miss_resident: report.miss_resident,
        asks,
        wall_ns,
        throughput_fps: if wall_ns == 0 {
            0.0
        } else {
            asks as f64 * 1e9 / wall_ns as f64
        },
        p50_ns: percentile(&lats, 0.50),
        p90_ns: percentile(&lats, 0.90),
        p99_ns: percentile(&lats, 0.99),
        max_ns: lats.last().copied().unwrap_or(0),
        hop_count: hops.len() as u32,
        hop_events,
        probe_ns_p50,
        probe_got_p50,
        hop_p50_ns: percentile(&hops, 0.50),
        hop_p99_ns: percentile(&hops, 0.99),
        gap_p99_ns: gap_p99,
        gap_max_ns: gap_max,
        cpu_ns,
        cpu_per_ask_ns: if asks == 0 {
            0
        } else {
            cpu_ns / u64::from(asks)
        },
        threads_max,
        read_chunk: cfg.read_chunk,
        uring_depth: cfg.uring_depth,
        runtime: cfg.runtime.as_str().to_string(),
        samples: per_ask,
    })
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

/// The miss-ratio / concurrency campaign.
///
/// Separate from the classic loop on purpose. That loop's unit is "one primary session on
/// a whole study at one temperature"; this one's is "N sessions on a region whose miss
/// ratio was chosen and verified", and folding the second into the first would have meant
/// changing the instrument the accepted decision rests on.
fn run_mix_campaign(
    args: &Args,
    arms: &[Arm],
    chunks: &[usize],
    repeats: u32,
    workers: usize,
    mixes: Vec<f64>,
) -> Result<()> {
    let concurrencies = args.concurrencies.clone().unwrap_or_else(|| vec![1]);
    let traces = args
        .trace
        .clone()
        .unwrap_or_else(|| vec![TraceKind::Forward]);
    let mut rows: Vec<MixRow> = Vec::new();
    println!("{}", mix_tsv_header());

    for study in &args.studies {
        let study = study.canonicalize().context("study")?;
        let ctx = ServeCtx::open(&study)?;
        let n = ctx.store.frame_count();
        let region_frames = args.region_frames.max(1);
        let stride = args.region_stride.max(1);
        let span = region_frames * stride;
        if span > n {
            anyhow::bail!(
                "--region-frames {region_frames} x --region-stride {stride} spans {span} frames, \
                 past the study's {n}"
            );
        }
        let regions = n / span;
        eprintln!(
            "study={} frames={n} region_frames={region_frames} stride={stride} regions={regions} \
             nowait={} concurrency={:?} mixes={:?}",
            study.display(),
            ctx.store.nowait_supported(),
            concurrencies,
            mixes,
        );
        // Every cell takes the next region unless pinned. An 80 MB study re-read is 10x
        // faster on its second pass here (442 ms then 31 ms) — the hypervisor caches it —
        // so an arm that runs second on the same bytes is measuring the cache, not itself.
        let mut cell = 0u32;
        for &chunk in chunks {
            for &mix in &mixes {
                for &conc in &concurrencies {
                    for &trace in &traces {
                        for rep in 1..=repeats {
                            for &arm in arms {
                                let region_start = if args.region_fixed {
                                    0
                                } else {
                                    (cell % regions) * span
                                };
                                cell += 1;
                                let mcfg = MixCfg {
                                    cell: CellCfg {
                                        access: AccessMode::Full,
                                        chunk,
                                        sessions: 0,
                                        session_asks: 0,
                                        runtime: args.runtime,
                                        workers,
                                        bg_arm: args.bg_arm,
                                        monitors: args.monitors,
                                        read_chunk: args.read_chunk.max(1),
                                        uring_sqpoll: args.uring_sqpoll,
                                        uring_depth: args.uring_depth.max(2),
                                        max_blocking: args.max_blocking,
                                    },
                                    mix,
                                    concurrency: conc,
                                    region_start,
                                    region_frames,
                                    region_stride: stride,
                                    seed: args.mix_seed,
                                };
                                let row = run_mix_cell(arm, &ctx, mcfg, trace, rep)?;
                                println!("{}", row.to_tsv());
                                rows.push(row);
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(path) = &args.mix_samples {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut body = String::from(
            "arm\ttrace\tmix_target\tconcurrency\trepeat\tordinal\tlatency_ns\thop_ns\thop_events\tprobe_ns\tprobe_got\n",
        );
        for r in &rows {
            for (i, (lat, hop, ev, pns, pgot)) in r.samples.iter().enumerate() {
                body.push_str(&format!(
                    "{}\t{}\t{:.2}\t{}\t{}\t{i}\t{lat}\t{hop}\t{ev}\t{pns}\t{pgot}\n",
                    r.arm, r.trace, r.mix_target, r.concurrency, r.repeat
                ));
            }
        }
        std::fs::write(path, body)?;
        eprintln!(
            "wrote {} ({} asks)",
            path.display(),
            rows.iter().map(|r| r.samples.len()).sum::<usize>()
        );
    }
    if let Some(out) = &args.mix_out {
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut body = String::from(mix_tsv_header());
        body.push('\n');
        for r in &rows {
            body.push_str(&r.to_tsv());
            body.push('\n');
        }
        std::fs::write(out, body)?;
        eprintln!("wrote {}", out.display());
    }
    Ok(())
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
    let arms = if let Some(a) = args.arm.clone() {
        a
    } else if args.decision || args.realistic {
        Arm::decision().to_vec()
    } else {
        Arm::all().to_vec()
    };
    let accesses = if let Some(a) = args.access.clone() {
        a
    } else {
        vec![AccessMode::Full]
    };
    let temps = args.temp.clone().unwrap_or_else(|| Temp::all().to_vec());
    let chunks = if args.chunk.is_empty() {
        vec![16_384]
    } else {
        args.chunk.clone()
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
    PREFIX_BYTES.store(args.prefix, Ordering::Relaxed);
    eprintln!(
        "runtime={} workers={} monitors={} bg_arm={:?} repeats={} prefix={}",
        args.runtime.as_str(),
        workers,
        args.monitors,
        args.bg_arm,
        repeats,
        args.prefix
    );

    if let Some(mixes) = args.mixes.clone() {
        return run_mix_campaign(&args, &arms, &chunks, repeats, workers, mixes);
    }

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
                            uring_depth: args.uring_depth.max(2),
                            max_blocking: args.max_blocking,
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

    if let Some(path) = args.samples.clone() {
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

    if let Some(out) = args.out.clone() {
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
