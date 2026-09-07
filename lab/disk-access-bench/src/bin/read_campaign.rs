//! Read-path campaign harness: every factor that changes the answer, on one axis each.
//!
//! The disk-access question has more than one dimension, and earlier cells varied one at a
//! time and generalised the result. This runs the cross:
//!
//! | Factor | Values | Why it changes the answer |
//! | --- | --- | --- |
//! | `arm` | pool · uring · hybrid · pooled_pread | how concurrency is held, and where a miss goes |
//! | `prefetch` | off · on | `POSIX_FADV_WILLNEED` for the asks one round ahead |
//! | `depth` | 1…64 | reads in flight per reader; a ring has nothing to do at 1 |
//! | `readers` | 1…N | independent readers, i.e. sessions; R×D is total in flight |
//! | `temp` | cold · warm | a cached read has nothing to wait for |
//! | `stride` | = size (sweep) · > size (stride) | whether kernel read-ahead can see a pattern |
//! | `size` | 4 KiB…250 KB | rung size |
//!
//! Controls, because a benchmark that only measures what it hoped to find is not evidence:
//!
//! * **Arm order rotates** per repeat, so host drift cannot settle on one arm.
//! * **Cold cells assert residency** below 1% and abort otherwise — `fadvise(DONTNEED)` is
//!   advisory and silently does nothing on a mapped page.
//! * **A co-tenant monitor** spins `yield_now` and records the gaps, so an arm that buys
//!   throughput by stalling the executor is visible rather than invisible. This is the
//!   property the ADR was chosen for, and it is not a latency number.
//! * **Per-cell CPU, wall, thread high-water and miss count** are reported together: an arm
//!   that wins latency while doubling CPU or thread count has not won.

use anyhow::{Context, Result};
use clap::Parser;
use disk_access_bench::candidate_access::hint_willneed;
use disk_access_bench::uring_access::UringReader;
use exact_server::media::frame_store::FrameStore;
use exact_server::media::read_path::{ReadCtx, ReadMode};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Arm {
    /// The product path: `RWF_NOWAIT` on the executor, `spawn_blocking` for the shortfall.
    Pool,
    /// One ring per reader; every read goes through it.
    Uring,
    /// `RWF_NOWAIT` inline, ring only for the shortfall. A hit never reaches the ring.
    Hybrid,
    /// The ADR's escape hatch: every read on the blocking pool, no fast path attempted.
    PooledPread,
    /// **The S5 control.** `hybrid`'s loop with `pool`'s miss mechanism: one task holding
    /// `depth` slots, `RWF_NOWAIT` inline, `spawn_blocking` — not a ring — for the
    /// shortfall. Its delta against `pool` is reader-loop shape alone; `hybrid` minus this
    /// is what io_uring is actually worth. See `docs/disk-access/EVIDENCE.md`.
    PoolRingLoop,
    /// **The synthesis S5 points at.** `hybrid`, but the ring is built on the *first miss*
    /// rather than at session start. A session whose reads all hit never constructs one, so
    /// it keeps the ring-shaped loop's win on hits without the idle ring's cost; a session
    /// that misses pays construction once and is `hybrid` from then on.
    HybridLazyRing,
    /// **The shipped path itself** — `server`'s `ReadCtx`, driven exactly as
    /// `stream_codestream` drives it, rather than a lab reimplementation of its shape.
    ///
    /// Every other arm models a candidate. This one *is* the product, so its delta against
    /// `hybrid_lazyring` answers the only question left after the arm was chosen: did the
    /// thing that shipped land where the arm that won it did. `WTPACS_READ_PATH` selects
    /// the product's own mode, so `pool` and `uring` are reachable here too.
    Product,
}

impl Arm {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "pool" => Some(Self::Pool),
            "uring" => Some(Self::Uring),
            "hybrid" => Some(Self::Hybrid),
            "pooled_pread" => Some(Self::PooledPread),
            "pool_ringloop" => Some(Self::PoolRingLoop),
            "hybrid_lazyring" => Some(Self::HybridLazyRing),
            "product" => Some(Self::Product),
            _ => None,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Self::Pool => "pool",
            Self::Uring => "uring",
            Self::Hybrid => "hybrid",
            Self::PooledPread => "pooled_pread",
            Self::PoolRingLoop => "pool_ringloop",
            Self::HybridLazyRing => "hybrid_lazyring",
            Self::Product => "product",
        }
    }
    fn uses_ring(self) -> bool {
        matches!(self, Self::Uring | Self::Hybrid | Self::HybridLazyRing)
    }
}

#[derive(Parser)]
#[command(name = "read_campaign")]
struct Args {
    #[arg(long)]
    study: PathBuf,
    /// Comma-separated: pool,uring,hybrid,pooled_pread,pool_ringloop,hybrid_lazyring,product
    #[arg(long, default_value = "pool,uring,hybrid")]
    arms: String,
    /// Comma-separated reads in flight per reader.
    #[arg(long, default_value = "1,4,16")]
    depths: String,
    /// Comma-separated independent readers (sessions).
    #[arg(long, default_value = "1")]
    readers: String,
    /// Comma-separated: cold,warm
    #[arg(long, default_value = "cold,warm")]
    temps: String,
    /// Comma-separated: off,on — `POSIX_FADV_WILLNEED` one round ahead.
    #[arg(long, default_value = "off")]
    prefetch: String,
    /// Bytes per ask.
    #[arg(long, default_value_t = 16384)]
    size: usize,
    /// Distance between consecutive asks. Equal to `size` sweeps the file; larger strides it.
    #[arg(long, default_value_t = 250_000)]
    stride: u64,
    /// Asks per reader per cell.
    #[arg(long, default_value_t = DEFAULT_ASKS)]
    asks: usize,
    #[arg(long, default_value_t = 6)]
    repeats: usize,
    /// Co-tenant `yield_now` monitors. 0 disables (and removes their CPU from the totals).
    #[arg(long, default_value_t = 1)]
    monitors: usize,
    /// Give each reader a disjoint slice of the file instead of letting readers overlap.
    ///
    /// Overlapping readers model several sessions on the *same* study, where sharing the
    /// page cache is real and a later reader legitimately hits what an earlier one pulled
    /// in. Disjoint readers model sessions on *different* studies, where nothing is shared.
    /// Both are real; conflating them is what is not.
    #[arg(long)]
    partition: bool,
    /// Tag written into every row, so phases can share one file.
    #[arg(long, default_value = "cell")]
    label: String,
    /// Print the header row (omit when appending to an existing file).
    #[arg(long)]
    no_header: bool,
    /// Replay a read sequence from `lab/scripts/gen_access_trace.py` instead of a synthetic
    /// stride. `--size` and `--stride` are then ignored; `--asks` defaults to the trace
    /// length. The reported `shape` becomes `trace` and `size` the median read length.
    #[arg(long)]
    trace: Option<PathBuf>,
}

/// Sentinel so `--trace` can tell "the user asked for 512" from "the user said nothing" and
/// default to replaying the whole trace.
const DEFAULT_ASKS: usize = 512;

fn cpu_ns() -> u64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `ts` is a valid, writable timespec.
    unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut ts) };
    ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64
}

fn threads() -> usize {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("Threads:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse().ok())
        })
        .unwrap_or(0)
}

fn pct(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    sorted[(((sorted.len() - 1) as f64) * p).round() as usize]
}

/// Evict the file from the page cache, retrying until it takes, and report what fraction
/// stayed resident.
///
/// The check is the point: `fadvise(DONTNEED)` is advisory, so a cell that trusted it could
/// silently measure warm reads and label them cold. It is also not instantaneous — after a
/// warm phase some pages are briefly un-evictable, so one attempt can leave a few percent
/// behind. Retry, then report; the caller decides what to do with a cell that would not go
/// cold, and records the number either way rather than hiding it.
fn evict_retry(path: &PathBuf) -> Result<f64> {
    let mut resident = f64::NAN;
    for attempt in 0..8 {
        resident = evict(path)?;
        // NaN means mincore failed; treat that as "cannot verify" and stop retrying rather
        // than looping on a number that will never compare true.
        if resident.is_nan() || resident <= 0.005 {
            return Ok(resident);
        }
        std::thread::sleep(std::time::Duration::from_millis(20 * (attempt + 1)));
    }
    Ok(resident)
}

fn evict(path: &PathBuf) -> Result<f64> {
    use std::os::unix::io::AsRawFd;
    let file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    // SAFETY: advisory call on an open fd; touches no user memory.
    unsafe {
        libc::posix_fadvise(
            file.as_raw_fd(),
            0,
            len as libc::off_t,
            libc::POSIX_FADV_DONTNEED,
        );
    }
    // SAFETY: read-only shared mapping of a file held open here; unmapped below.
    let addr = unsafe {
        libc::mmap(
            std::ptr::null_mut(),
            len as usize,
            libc::PROT_READ,
            libc::MAP_SHARED,
            file.as_raw_fd(),
            0,
        )
    };
    if addr == libc::MAP_FAILED {
        return Ok(f64::NAN);
    }
    let pages = (len as usize).div_ceil(4096);
    let mut vec = vec![0u8; pages];
    // SAFETY: `addr` maps `len` bytes; `vec` holds one byte per page of that range.
    let rc = unsafe { libc::mincore(addr, len as usize, vec.as_mut_ptr()) };
    let resident = if rc == 0 {
        vec.iter().filter(|b| *b & 1 != 0).count() as f64 / pages as f64
    } else {
        f64::NAN
    };
    // SAFETY: unmapping exactly what was mapped above.
    unsafe { libc::munmap(addr, len as usize) };
    Ok(resident)
}

/// The exact read sequence one reader will issue: `(offset, length)` per ask.
///
/// Synthetic cells derive it from base/stride/size. `--trace` replays a sequence produced by
/// `lab/scripts/gen_access_trace.py`, which turns a real client ask schedule into disk reads
/// under a chosen layout. Making the sequence *data* rather than a closure is what lets the
/// same harness — same arms, same controls, same accounting — measure both without a second
/// code path to keep honest.
type Plan = Arc<Vec<(u64, u32)>>;

/// Build reader `reader`'s share of the work.
///
/// The two sources interleave differently, on purpose:
///
/// * **Synthetic**: reader `r` of `n` takes every `n`-th slot of one shared sequence, so no
///   reader trails another through pages it already warmed.
/// * **Trace**: each reader walks the trace *in order* from its own starting position. The
///   whole point of a trace cell is the pattern's local sequentiality — what kernel
///   read-ahead can and cannot see — and interleaving would destroy exactly that.
fn plan_for(
    cell: &Cell,
    base: u64,
    span: u64,
    reader: usize,
    readers: usize,
    trace: Option<&[(u64, u32)]>,
) -> Plan {
    let n = readers.max(1);
    Arc::new(match trace {
        Some(t) if !t.is_empty() => {
            let start = reader * t.len() / n;
            (0..cell.asks).map(|i| t[(start + i) % t.len()]).collect()
        }
        _ => (0..cell.asks)
            .map(|i| {
                let off = base
                    + ((reader as u64 + i as u64 * n as u64).wrapping_mul(cell.stride)
                        % span.max(1));
                (off, cell.size as u32)
            })
            .collect(),
    })
}

/// Read a `gen_access_trace.py` TSV: `offset<TAB>length`, `#` comments ignored.
fn load_trace(path: &PathBuf) -> Result<Vec<(u64, u32)>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {path:?}"))?;
    let mut out = Vec::new();
    for (n, line) in text.lines().enumerate() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let mut it = line.split('\t');
        let off = it
            .next()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .with_context(|| format!("{path:?}:{}: bad offset", n + 1))?;
        let len = it
            .next()
            .and_then(|v| v.trim().parse::<u32>().ok())
            .with_context(|| format!("{path:?}:{}: bad length", n + 1))?;
        out.push((off, len));
    }
    if out.is_empty() {
        anyhow::bail!("{path:?} has no reads");
    }
    Ok(out)
}

struct Cell {
    arm: Arm,
    prefetch: bool,
    partition: bool,
    depth: usize,
    readers: usize,
    asks: usize,
    size: usize,
    stride: u64,
    warm: bool,
    monitors: usize,
}

struct Outcome {
    lat: Vec<u64>,
    gaps: Vec<u64>,
    wall_ns: u64,
    cpu_ns: u64,
    threads_max: usize,
    misses: u64,
}

/// One reader's worth of work: replay `plan`, `depth` reads in flight.
async fn reader_pool(
    store: Arc<FrameStore>,
    file: Arc<std::fs::File>,
    cell: &Cell,
    plan: Plan,
    lat: Arc<Mutex<Vec<u64>>>,
    misses: Arc<AtomicU64>,
) -> Result<()> {
    let (depth, prefetch) = (cell.depth, cell.prefetch);
    let asks = plan.len();
    let next = Arc::new(AtomicU64::new(0));
    let always_pool = cell.arm == Arm::PooledPread;
    let mut set = tokio::task::JoinSet::new();
    let cap = plan.iter().map(|(_, l)| *l as usize).max().unwrap_or(0);
    for _ in 0..depth {
        let store = Arc::clone(&store);
        let file = Arc::clone(&file);
        let next = Arc::clone(&next);
        let lat = Arc::clone(&lat);
        let misses = Arc::clone(&misses);
        let plan = Arc::clone(&plan);
        set.spawn(async move {
            let mut buf = vec![0u8; cap];
            let mut mine = Vec::new();
            let mut miss = 0u64;
            loop {
                let i = next.fetch_add(1, Ordering::Relaxed) as usize;
                if i >= asks {
                    break;
                }
                let (off, len) = plan[i];
                let len = len as usize;
                let t = Instant::now();
                if prefetch {
                    // One round ahead: the ask this reader will take next.
                    if let Some(&(noff, nlen)) = plan.get(i + depth) {
                        hint_willneed(&file, noff, nlen as usize);
                    }
                }
                let got = if always_pool {
                    0
                } else {
                    store.read_at_nowait(&mut buf[..len], off).unwrap_or(0)
                };
                if got < len {
                    miss += 1;
                    let s = Arc::clone(&store);
                    let mut owned = std::mem::take(&mut buf);
                    owned = tokio::task::spawn_blocking(move || {
                        s.read_at_blocking(&mut owned[got..len], off + got as u64)
                            .map(|_| owned)
                    })
                    .await
                    .expect("join")
                    .expect("blocking read");
                    buf = owned;
                }
                mine.push(t.elapsed().as_nanos() as u64);
            }
            lat.lock().unwrap().extend(mine);
            misses.fetch_add(miss, Ordering::Relaxed);
        });
    }
    // Propagate a panicking task instead of counting it as success: a task that died still
    // spent CPU, and swallowing it would divide that CPU by the asks it never recorded.
    while let Some(joined) = set.join_next().await {
        joined.context("reader task")?;
    }
    Ok(())
}

/// The product path, driven the way `stream_codestream` drives it.
///
/// One `ReadCtx` per reader — the per-session state a real connection holds — and a frame is
/// streamed in `read_window` pieces until it is done. No lab reimplementation: the loop
/// below is `stream_codestream`'s, and everything under it is `server` code.
///
/// An ask here is a whole frame, as it is on the wire, so latency is per frame rather than
/// per window. A frame counts as a miss when its first read escalates, which under the
/// shipping mode happens at most once per frame by design.
async fn reader_product(
    store: Arc<FrameStore>,
    cell: &Cell,
    plan: Plan,
    lat: Arc<Mutex<Vec<u64>>>,
    misses: Arc<AtomicU64>,
) -> Result<()> {
    let depth = cell.depth;
    let asks = plan.len();
    let next = Arc::new(AtomicU64::new(0));
    let mut set = tokio::task::JoinSet::new();
    for _ in 0..depth {
        let store = Arc::clone(&store);
        let next = Arc::clone(&next);
        let lat = Arc::clone(&lat);
        let misses = Arc::clone(&misses);
        let plan = Arc::clone(&plan);
        set.spawn(async move {
            let mut ctx = ReadCtx::new(ReadMode::from_env(), &store);
            let mut mine = Vec::new();
            let mut miss = 0u64;
            loop {
                let i = next.fetch_add(1, Ordering::Relaxed) as usize;
                if i >= asks {
                    break;
                }
                let (off, len) = plan[i];
                let t = Instant::now();
                let stride = store.read_window(len);
                let mut pos = 0u32;
                let mut first = true;
                while pos < len {
                    let remaining = (len - pos) as usize;
                    let ready = ctx
                        .read(&store, off + u64::from(pos), stride, remaining)
                        .await
                        .expect("product read");
                    if first && ready.len() > stride.min(remaining) {
                        miss += 1;
                    }
                    first = false;
                    pos += ready.len() as u32;
                }
                mine.push(t.elapsed().as_nanos() as u64);
            }
            lat.lock().unwrap().extend(mine);
            misses.fetch_add(miss, Ordering::Relaxed);
        });
    }
    while let Some(joined) = set.join_next().await {
        joined.context("reader task")?;
    }
    Ok(())
}

/// **S5 control**: `reader_ring`'s shape, `reader_pool`'s miss mechanism.
///
/// One task holding `depth` slots — not `depth` tasks sharing a cursor — with
/// `RWF_NOWAIT` inline and `spawn_blocking` for the shortfall. No ring, no eventfd, no
/// registered buffers.
///
/// It exists because `pool` and `hybrid` differ in **two** things at once (loop shape and
/// miss mechanism), so neither of them isolates either. This arm holds the miss mechanism
/// fixed against `pool` and the loop fixed against `hybrid`:
///
/// * `pool_ringloop` − `pool`   = the loop alone
/// * `hybrid` − `pool_ringloop` = the ring alone
///
/// Correctness check: in the **hit** regime no read reaches a ring in either arm, so
/// `hybrid` − `pool_ringloop` must come out ~0. If it does not, this arm is not built right.
async fn reader_ringloop(
    store: Arc<FrameStore>,
    file: Arc<std::fs::File>,
    cell: &Cell,
    plan: Plan,
    lat: Arc<Mutex<Vec<u64>>>,
    misses: Arc<AtomicU64>,
) -> Result<()> {
    let (depth, prefetch) = (cell.depth, cell.prefetch);
    let asks = plan.len();
    // Same slot geometry as `reader_ring`: `depth` buffers sized to the longest read in the
    // plan, so the two arms hold the same memory and differ only in how a miss is served.
    let cap = plan.iter().map(|(_, l)| *l as usize).max().unwrap_or(0);
    let mut slots: Vec<Vec<u8>> = (0..depth).map(|_| vec![0u8; cap]).collect();
    let mut free: Vec<usize> = (0..depth).collect();
    let mut inflight: tokio::task::JoinSet<Result<(usize, Vec<u8>, Instant)>> =
        tokio::task::JoinSet::new();
    let mut mine = Vec::with_capacity(asks);
    let (mut issued, mut completed, mut miss) = (0usize, 0usize, 0u64);

    while completed < asks {
        while issued < asks {
            let Some(slot) = free.pop() else { break };
            let (off, len) = plan[issued];
            let len = len as usize;
            let started = Instant::now();
            if prefetch {
                if let Some(&(noff, nlen)) = plan.get(issued + depth) {
                    hint_willneed(&file, noff, nlen as usize);
                }
            }
            let mut buf = std::mem::take(&mut slots[slot]);
            let got = store.read_at_nowait(&mut buf[..len], off).unwrap_or(0);
            issued += 1;
            if got == len {
                // Hit: served inline, the slot never leaves this task — the same shape the
                // hybrid has on a hit, which is what makes the two comparable there.
                mine.push(started.elapsed().as_nanos() as u64);
                slots[slot] = buf;
                free.push(slot);
                completed += 1;
                continue;
            }
            miss += 1;
            let s = Arc::clone(&store);
            inflight.spawn(async move {
                let buf = tokio::task::spawn_blocking(move || {
                    s.read_at_blocking(&mut buf[got..len], off + got as u64)
                        .map(|_| buf)
                })
                .await
                .context("join blocking read")??;
                Ok((slot, buf, started))
            });
        }
        let Some(joined) = inflight.join_next().await else {
            // No slot free and nothing in flight can only mean every ask is accounted for.
            break;
        };
        let (slot, buf, started) = joined.context("reader task")??;
        mine.push(started.elapsed().as_nanos() as u64);
        slots[slot] = buf;
        free.push(slot);
        completed += 1;
    }

    lat.lock().unwrap().extend(mine);
    misses.fetch_add(miss, Ordering::Relaxed);
    Ok(())
}

/// One reader backed by its own ring — the per-session shape, `depth` slots in flight.
async fn reader_ring(
    store: Arc<FrameStore>,
    file: Arc<std::fs::File>,
    cell: &Cell,
    plan: Plan,
    lat: Arc<Mutex<Vec<u64>>>,
    misses: Arc<AtomicU64>,
) -> Result<()> {
    let (depth, prefetch) = (cell.depth, cell.prefetch);
    let asks = plan.len();
    let lazy = cell.arm == Arm::HybridLazyRing;
    let hybrid = cell.arm == Arm::Hybrid || lazy;
    // Registered buffers are fixed-size, so they are sized to the longest read in the plan.
    // Variable-length traces then read into a prefix of the slot.
    let cap = plan.iter().map(|(_, l)| *l as usize).max().unwrap_or(0);

    // `lazy` defers construction to the first miss. Until then hits are served into local
    // buffers of the same geometry, so the loop shape is identical and only the ring's
    // existence differs. Nothing can be in flight before the ring exists — every earlier ask
    // was a hit — so building it mid-loop is safe.
    let mut ring: Option<UringReader> = if lazy {
        None
    } else {
        Some(UringReader::new(&file, depth, cap, true, false)?)
    };
    let mut local: Vec<Vec<u8>> = if lazy {
        (0..depth).map(|_| vec![0u8; cap]).collect()
    } else {
        Vec::new()
    };
    let mut starts = vec![Instant::now(); depth];
    let mut busy = vec![false; depth];
    let mut mine = Vec::with_capacity(asks);
    let mut freed: Vec<usize> = Vec::with_capacity(depth);
    let (mut issued, mut in_flight, mut completed, mut miss) = (0usize, 0usize, 0usize, 0u64);

    while completed < asks {
        let mut pushed = 0usize;
        for slot in 0..depth {
            if in_flight >= depth || issued >= asks {
                break;
            }
            if busy[slot] {
                continue;
            }
            let (off, len) = plan[issued];
            let len = len as usize;
            starts[slot] = Instant::now();
            if prefetch {
                if let Some(&(noff, nlen)) = plan.get(issued + depth) {
                    hint_willneed(&file, noff, nlen as usize);
                }
            }
            // The hybrid's point: a page-cache hit is served inline and the ring never sees
            // it. Only the shortfall is submitted.
            let got = if hybrid {
                match ring.as_mut() {
                    Some(r) => store.read_at_nowait(&mut r.buf_mut(slot)[..len], off)?,
                    None => store.read_at_nowait(&mut local[slot][..len], off)?,
                }
            } else {
                0
            };
            if hybrid && got == len {
                mine.push(starts[slot].elapsed().as_nanos() as u64);
                issued += 1;
                completed += 1;
                continue;
            }
            miss += 1;
            // First miss on a lazy session: build the ring now, and carry the prefix the
            // inline read already produced into the slot the ring will complete into, so no
            // byte is read twice.
            if ring.is_none() {
                let mut r = UringReader::new(&file, depth, cap, true, false)?;
                r.buf_mut(slot)[..got].copy_from_slice(&local[slot][..got]);
                ring = Some(r);
            }
            let ring = ring.as_mut().expect("ring built above");
            ring.push_at(slot, got, &file, off + got as u64, len - got)?;
            busy[slot] = true;
            issued += 1;
            in_flight += 1;
            pushed += 1;
        }
        if pushed > 0 {
            ring.as_mut()
                .expect("ring exists once anything is in flight")
                .submit()?;
        }
        if in_flight == 0 {
            if issued >= asks {
                break;
            }
            continue;
        }
        freed.clear();
        ring.as_mut()
            .expect("ring exists once anything is in flight")
            .complete_into(1, &mut freed)
            .await?;
        let done = Instant::now();
        for &slot in &freed {
            mine.push(done.duration_since(starts[slot]).as_nanos() as u64);
            busy[slot] = false;
            in_flight -= 1;
            completed += 1;
        }
    }
    lat.lock().unwrap().extend(mine);
    misses.fetch_add(miss, Ordering::Relaxed);
    Ok(())
}

fn run_cell(
    path: &PathBuf,
    cell: &Cell,
    workers: usize,
    trace: Option<&[(u64, u32)]>,
) -> Result<Outcome> {
    let store = Arc::new(FrameStore::open(path)?);
    let file = Arc::new(std::fs::File::open(path)?);
    let flen = file.metadata()?.len();
    let base = store.frame_span(0)?.offset;
    let span = flen - base - cell.size as u64;

    let partition = cell.partition;
    let reader_span = if partition {
        (span / cell.readers.max(1) as u64).max(cell.size as u64 * 2)
    } else {
        span
    };
    // Build every reader's plan up front: the warm phase has to touch exactly the bytes the
    // cell will read, and with a trace those are not derivable from base/stride.
    let plans: Vec<Plan> = (0..cell.readers)
        .map(|r| {
            let (rbase, rreader, rreaders) = if partition {
                (
                    base + (r as u64) * (span / cell.readers.max(1) as u64),
                    0,
                    1,
                )
            } else {
                (base, r, cell.readers.max(1))
            };
            plan_for(cell, rbase, reader_span, rreader, rreaders, trace)
        })
        .collect();

    // A read past EOF would short-read and be miscounted as a cache miss, so refuse the cell
    // instead: a trace generated against a different fixture must fail loudly.
    for p in &plans {
        if let Some(&(off, len)) = p.iter().find(|(o, l)| o + *l as u64 > flen) {
            anyhow::bail!("plan reads {off}+{len} past EOF ({flen}) — trace/fixture mismatch");
        }
    }

    if cell.warm {
        let cap = plans
            .iter()
            .flat_map(|p| p.iter().map(|(_, l)| *l as usize))
            .max()
            .unwrap_or(0);
        let mut buf = vec![0u8; cap];
        for p in &plans {
            for &(off, len) in p.iter() {
                store.read_at_blocking(&mut buf[..len as usize], off)?;
            }
        }
    }

    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()?;

    let lat = Arc::new(Mutex::new(Vec::new()));
    let misses = Arc::new(AtomicU64::new(0));
    let gaps = Arc::new(Mutex::new(Vec::new()));

    let (wall_ns, cpu_ns_used, threads_max, reader_err) = rt.block_on(async {
        // Co-tenant monitor: an arm that stalls the executor shows up here and nowhere else.
        let stop = Arc::new(AtomicBool::new(false));
        let mut mons = Vec::new();
        for _ in 0..cell.monitors {
            let stop = Arc::clone(&stop);
            let gaps = Arc::clone(&gaps);
            mons.push(tokio::spawn(async move {
                let mut local = Vec::with_capacity(1 << 16);
                while !stop.load(Ordering::Relaxed) {
                    let t = Instant::now();
                    tokio::task::yield_now().await;
                    local.push(t.elapsed().as_nanos() as u64);
                }
                gaps.lock().unwrap().extend(local);
            }));
        }

        let cpu0 = cpu_ns();
        let wall0 = Instant::now();
        let mut set = tokio::task::JoinSet::new();
        for reader_plan in &plans {
            let store = Arc::clone(&store);
            let file = Arc::clone(&file);
            let lat = Arc::clone(&lat);
            let misses = Arc::clone(&misses);
            let plan = Arc::clone(reader_plan);
            let c = Cell {
                arm: cell.arm,
                prefetch: cell.prefetch,
                partition: cell.partition,
                depth: cell.depth,
                readers: 1,
                asks: cell.asks,
                size: cell.size,
                stride: cell.stride,
                warm: cell.warm,
                monitors: 0,
            };
            set.spawn(async move {
                if c.arm == Arm::Product {
                    reader_product(store, &c, plan, lat, misses).await
                } else if c.arm.uses_ring() {
                    reader_ring(store, file, &c, plan, lat, misses).await
                } else if c.arm == Arm::PoolRingLoop {
                    reader_ringloop(store, file, &c, plan, lat, misses).await
                } else {
                    reader_pool(store, file, &c, plan, lat, misses).await
                }
            });
        }
        let mut peak = threads();
        let mut reader_err: Option<String> = None;
        while let Some(joined) = set.join_next().await {
            peak = peak.max(threads());
            match joined {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    reader_err.get_or_insert(format!("{e:#}"));
                }
                Err(e) => {
                    reader_err.get_or_insert(format!("reader panicked: {e}"));
                }
            }
        }
        let wall = wall0.elapsed().as_nanos() as u64;
        let cpu = cpu_ns() - cpu0;
        stop.store(true, Ordering::Relaxed);
        tokio::task::yield_now().await;
        for m in mons {
            let _ = m.await;
        }
        (wall, cpu, peak.max(threads()), reader_err)
    });

    if let Some(e) = reader_err {
        anyhow::bail!("reader failed: {e}");
    }
    let mut v = lat.lock().unwrap().clone();
    v.sort_unstable();
    // Every ask must be accounted for. A cell that silently records a fraction of its work
    // divides its CPU by the wrong denominator, which is how an arm can look 9x worse than
    // it is.
    let expected = cell.asks * cell.readers;
    if v.len() != expected {
        anyhow::bail!(
            "{} recorded {} of {expected} asks (readers={}, depth={})",
            cell.arm.as_str(),
            v.len(),
            cell.readers,
            cell.depth
        );
    }
    let mut g = gaps.lock().unwrap().clone();
    g.sort_unstable();
    Ok(Outcome {
        lat: v,
        gaps: g,
        wall_ns,
        cpu_ns: cpu_ns_used,
        threads_max,
        misses: misses.load(Ordering::Relaxed),
    })
}

fn main() -> Result<()> {
    let args = Args::parse();
    let arms: Vec<Arm> = args
        .arms
        .split(',')
        .map(|s| Arm::parse(s.trim()).with_context(|| format!("unknown arm {s}")))
        .collect::<Result<_>>()?;
    let depths: Vec<usize> = args
        .depths
        .split(',')
        .map(|s| s.trim().parse().unwrap())
        .collect();
    let readers: Vec<usize> = args
        .readers
        .split(',')
        .map(|s| s.trim().parse().unwrap())
        .collect();
    let temps: Vec<bool> = args.temps.split(',').map(|s| s.trim() == "warm").collect();
    let prefetches: Vec<bool> = args.prefetch.split(',').map(|s| s.trim() == "on").collect();
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get());

    if !args.no_header {
        println!(
            "label\tarm\tprefetch\ttemp\tshape\tsize\tstride\tdepth\treaders\trepeat\tpos\t\
             asks\tp50_ns\tp90_ns\tp99_ns\tcpu_ns_per_ask\twall_ns\tasks_per_s\tthreads\t\
             gap_p99_ns\tgap_max_ns\tmiss_pct\tresident_pct"
        );
    }
    let trace = match &args.trace {
        Some(p) => Some(load_trace(p)?),
        None => None,
    };
    let (shape, report_size, report_stride) = match &trace {
        Some(t) => {
            let mut lens: Vec<u32> = t.iter().map(|(_, l)| *l).collect();
            lens.sort_unstable();
            ("trace", lens[lens.len() / 2] as usize, 0u64)
        }
        None if args.stride <= args.size as u64 => ("sweep", args.size, args.stride),
        None => ("stride", args.size, args.stride),
    };
    // Default to replaying the whole trace once per reader.
    let asks = match (&trace, args.asks) {
        (Some(t), a) if a == DEFAULT_ASKS => t.len(),
        (_, a) => a,
    };
    // Registered ring buffers are sized from the plan, but `size` still bounds the synthetic
    // span calculation, so give it the longest read a trace can produce.
    let buf_size = match &trace {
        Some(t) => t
            .iter()
            .map(|(_, l)| *l as usize)
            .max()
            .unwrap_or(args.size),
        None => args.size,
    };
    if let (Some(t), Some(p)) = (&trace, &args.trace) {
        eprintln!(
            "# trace {}: {} reads, median {} B, max {} B",
            p.display(),
            t.len(),
            report_size,
            buf_size
        );
    }

    for &warm in &temps {
        for &readers_n in &readers {
            for &depth in &depths {
                for &prefetch in &prefetches {
                    for repeat in 0..args.repeats {
                        // Rotate arm order per repeat so drift cannot settle on one arm.
                        let n = arms.len();
                        for pos in 0..n {
                            let arm = arms[(repeat + pos) % n];
                            let resident = if warm { 0.0 } else { evict_retry(&args.study)? };
                            if !warm && resident > 0.02 {
                                // Skip rather than abort: one stubborn cell must not throw
                                // away a campaign, and a silent warm cell labelled cold
                                // would be worse than a missing one.
                                eprintln!(
                                    "  skip: {} d{depth} r{readers_n} — {:.2}% still resident",
                                    arm.as_str(),
                                    resident * 100.0
                                );
                                continue;
                            }
                            let cell = Cell {
                                arm,
                                prefetch,
                                partition: args.partition,
                                depth,
                                readers: readers_n,
                                asks,
                                size: buf_size,
                                stride: args.stride,
                                warm,
                                monitors: args.monitors,
                            };
                            let o = run_cell(&args.study, &cell, workers, trace.as_deref())?;
                            let n_asks = o.lat.len().max(1) as u64;
                            let total = (asks * readers_n) as u64;
                            println!(
                                "{}\t{}\t{}\t{}\t{shape}\t{}\t{}\t{depth}\t{readers_n}\t{repeat}\t{pos}\t\
                                 {}\t{}\t{}\t{}\t{}\t{}\t{:.0}\t{}\t{}\t{}\t{:.1}\t{:.3}",
                                args.label,
                                arm.as_str(),
                                if prefetch { "on" } else { "off" },
                                if warm { "warm" } else { "cold" },
                                report_size,
                                report_stride,
                                o.lat.len(),
                                pct(&o.lat, 0.50),
                                pct(&o.lat, 0.90),
                                pct(&o.lat, 0.99),
                                o.cpu_ns / n_asks,
                                o.wall_ns,
                                n_asks as f64 / (o.wall_ns as f64 / 1e9),
                                o.threads_max,
                                pct(&o.gaps, 0.99),
                                o.gaps.last().copied().unwrap_or(0),
                                100.0 * o.misses as f64 / total as f64,
                                resident * 100.0,
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
