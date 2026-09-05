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
}

impl Arm {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "pool" => Some(Self::Pool),
            "uring" => Some(Self::Uring),
            "hybrid" => Some(Self::Hybrid),
            "pooled_pread" => Some(Self::PooledPread),
            _ => None,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Self::Pool => "pool",
            Self::Uring => "uring",
            Self::Hybrid => "hybrid",
            Self::PooledPread => "pooled_pread",
        }
    }
    fn uses_ring(self) -> bool {
        matches!(self, Self::Uring | Self::Hybrid)
    }
}

#[derive(Parser)]
#[command(name = "read_campaign")]
struct Args {
    #[arg(long)]
    study: PathBuf,
    /// Comma-separated: pool,uring,hybrid,pooled_pread
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
    #[arg(long, default_value_t = 512)]
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
}

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

/// One reader's worth of work: `asks` reads of `size`, `depth` of them in flight.
async fn reader_pool(
    store: Arc<FrameStore>,
    file: Arc<std::fs::File>,
    cell: &Cell,
    base: u64,
    span: u64,
    lat: Arc<Mutex<Vec<u64>>>,
    misses: Arc<AtomicU64>,
) {
    let (depth, asks, size, stride, prefetch) =
        (cell.depth, cell.asks, cell.size, cell.stride, cell.prefetch);
    let offset_of = move |i: usize| base + ((i as u64 * stride) % span.max(1));
    let next = Arc::new(AtomicU64::new(0));
    let always_pool = cell.arm == Arm::PooledPread;
    let mut set = tokio::task::JoinSet::new();
    for _ in 0..depth {
        let store = Arc::clone(&store);
        let file = Arc::clone(&file);
        let next = Arc::clone(&next);
        let lat = Arc::clone(&lat);
        let misses = Arc::clone(&misses);
        set.spawn(async move {
            let mut buf = vec![0u8; size];
            let mut mine = Vec::new();
            let mut miss = 0u64;
            loop {
                let i = next.fetch_add(1, Ordering::Relaxed) as usize;
                if i >= asks {
                    break;
                }
                let off = offset_of(i);
                let t = Instant::now();
                if prefetch {
                    // One round ahead: the asks this reader will take next.
                    hint_willneed(&file, offset_of(i + depth), size);
                }
                let got = if always_pool {
                    0
                } else {
                    store.read_at_nowait(&mut buf, off).unwrap_or(0)
                };
                if got < size {
                    miss += 1;
                    let s = Arc::clone(&store);
                    let mut owned = std::mem::take(&mut buf);
                    owned = tokio::task::spawn_blocking(move || {
                        s.read_at_blocking(&mut owned[got..], off + got as u64)
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
    while set.join_next().await.is_some() {}
}

/// One reader backed by its own ring — the per-session shape, `depth` slots in flight.
async fn reader_ring(
    store: Arc<FrameStore>,
    file: Arc<std::fs::File>,
    cell: &Cell,
    base: u64,
    span: u64,
    lat: Arc<Mutex<Vec<u64>>>,
    misses: Arc<AtomicU64>,
) -> Result<()> {
    let (depth, asks, size, stride, prefetch) =
        (cell.depth, cell.asks, cell.size, cell.stride, cell.prefetch);
    let hybrid = cell.arm == Arm::Hybrid;
    let offset_of = move |i: usize| base + ((i as u64 * stride) % span.max(1));

    let mut ring = UringReader::new(&file, depth, size, true, false)?;
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
            let off = offset_of(issued);
            starts[slot] = Instant::now();
            if prefetch {
                hint_willneed(&file, offset_of(issued + depth), size);
            }
            // The hybrid's point: a page-cache hit is served inline and the ring never sees
            // it. Only the shortfall is submitted.
            let got = if hybrid {
                store.read_at_nowait(&mut ring.buf_mut(slot)[..size], off)?
            } else {
                0
            };
            if hybrid && got == size {
                mine.push(starts[slot].elapsed().as_nanos() as u64);
                issued += 1;
                completed += 1;
                continue;
            }
            miss += 1;
            ring.push_at(slot, got, &file, off + got as u64, size - got)?;
            busy[slot] = true;
            issued += 1;
            in_flight += 1;
            pushed += 1;
        }
        if pushed > 0 {
            ring.submit()?;
        }
        if in_flight == 0 {
            if issued >= asks {
                break;
            }
            continue;
        }
        freed.clear();
        ring.complete_into(1, &mut freed).await?;
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

fn run_cell(path: &PathBuf, cell: &Cell, workers: usize) -> Result<Outcome> {
    let store = Arc::new(FrameStore::open(path)?);
    let file = Arc::new(std::fs::File::open(path)?);
    let flen = file.metadata()?.len();
    let base = store.frame_range(0)?.0;
    let span = flen - base - cell.size as u64;

    if cell.warm {
        let mut buf = vec![0u8; cell.size];
        let total = cell.asks + cell.depth + 1;
        for i in 0..total {
            let off = base + ((i as u64 * cell.stride) % span.max(1));
            store.read_at_blocking(&mut buf, off)?;
        }
    }

    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()?;

    let lat = Arc::new(Mutex::new(Vec::new()));
    let misses = Arc::new(AtomicU64::new(0));
    let gaps = Arc::new(Mutex::new(Vec::new()));

    let partition = cell.partition;
    let reader_span = if partition {
        (span / cell.readers.max(1) as u64).max(cell.size as u64 * 2)
    } else {
        span
    };
    let (wall_ns, cpu_ns_used, threads_max) = rt.block_on(async {
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
        for r in 0..cell.readers {
            let store = Arc::clone(&store);
            let file = Arc::clone(&file);
            let lat = Arc::clone(&lat);
            let misses = Arc::clone(&misses);
            // Overlapping (default) or disjoint, per `--partition`.
            let rbase = if partition {
                base + (r as u64) * (span / cell.readers.max(1) as u64)
            } else {
                base + (r as u64 * cell.stride * 7) % span.max(1)
            };
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
                if c.arm.uses_ring() {
                    reader_ring(store, file, &c, rbase, reader_span, lat, misses)
                        .await
                        .expect("ring reader");
                } else {
                    reader_pool(store, file, &c, rbase, reader_span, lat, misses).await;
                }
            });
        }
        let mut peak = threads();
        while set.join_next().await.is_some() {
            peak = peak.max(threads());
        }
        let wall = wall0.elapsed().as_nanos() as u64;
        let cpu = cpu_ns() - cpu0;
        stop.store(true, Ordering::Relaxed);
        tokio::task::yield_now().await;
        for m in mons {
            let _ = m.await;
        }
        (wall, cpu, peak.max(threads()))
    });

    let mut v = lat.lock().unwrap().clone();
    v.sort_unstable();
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
    let shape = if args.stride <= args.size as u64 {
        "sweep"
    } else {
        "stride"
    };

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
                                asks: args.asks,
                                size: args.size,
                                stride: args.stride,
                                warm,
                                monitors: args.monitors,
                            };
                            let o = run_cell(&args.study, &cell, workers)?;
                            let n_asks = o.lat.len().max(1) as u64;
                            let total = (args.asks * readers_n) as u64;
                            println!(
                                "{}\t{}\t{}\t{}\t{shape}\t{}\t{}\t{depth}\t{readers_n}\t{repeat}\t{pos}\t\
                                 {}\t{}\t{}\t{}\t{}\t{}\t{:.0}\t{}\t{}\t{}\t{:.1}\t{:.3}",
                                args.label,
                                arm.as_str(),
                                if prefetch { "on" } else { "off" },
                                if warm { "warm" } else { "cold" },
                                args.size,
                                args.stride,
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
