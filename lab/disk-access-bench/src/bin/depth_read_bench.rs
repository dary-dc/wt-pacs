//! Reads in flight, not reads one at a time — the regime io_uring exists for.
//!
//! Every io_uring number in `docs/disk-access/` so far was taken at **queue depth 1**,
//! because the harness serves one ask to completion before starting the next, mirroring
//! `run_session` in the server today. At depth 1 a ring has nothing to overlap and can only
//! lose: it adds submission and completion bookkeeping to a read that would have returned
//! inline. That is a measurement of the harness's shape, not of io_uring.
//!
//! The client already keeps `D` asks outstanding (`docs/adr-client-window-depth.md`); it is
//! the server that flattens them to one. So depth is a server design choice, and this bench
//! measures what that choice is worth by holding `D` reads in flight both ways:
//!
//! * `pool` — `D` tasks, each `RWF_NOWAIT` on the executor and `spawn_blocking` on the
//!   miss. `D` concurrent misses means `D` blocking-pool threads parked on the device.
//! * `uring` — one ring, `D` reads submitted together, completions awaited through a
//!   registered eventfd. `D` concurrent misses means one ring and no extra threads.
//!
//! Same bytes, same offsets, same order, same runtime. The only difference is how the
//! concurrency is held.

use anyhow::{Context, Result};
use disk_access_bench::uring_access::UringReader;
use exact_server::media::frame_store::FrameStore;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Arm {
    Pool,
    Uring,
    /// `RWF_NOWAIT` inline first, the ring only for what it could not get. Warm reads never
    /// touch the ring; cold ones never touch a thread.
    Hybrid,
}

impl Arm {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pool => "pool",
            Self::Uring => "uring",
            Self::Hybrid => "hybrid",
        }
    }
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

/// Drop this file's pages from the page cache, then prove they are gone.
///
/// `fadvise(DONTNEED)` is advisory and silently does nothing while a page is mapped, so a
/// cell that skipped the check would quietly measure warm reads and call them cold.
fn evict(path: &PathBuf) -> Result<f64> {
    let file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    use std::os::unix::io::AsRawFd;
    // SAFETY: advisory call on an open fd; touches no user memory.
    unsafe {
        libc::posix_fadvise(
            file.as_raw_fd(),
            0,
            len as libc::off_t,
            libc::POSIX_FADV_DONTNEED,
        );
    }
    // Residency via mincore over a fresh mapping of the file.
    // SAFETY: read-only shared mapping of a file we hold open; unmapped below.
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
    let page = 4096usize;
    let pages = (len as usize).div_ceil(page);
    let mut vec = vec![0u8; pages];
    // SAFETY: `addr` maps `len` bytes; `vec` has one byte per page of that range.
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

#[allow(clippy::too_many_arguments)]
async fn run_cell(
    arm: Arm,
    store: Arc<FrameStore>,
    path: PathBuf,
    depth: usize,
    asks: usize,
    size: usize,
    stride: u64,
    warm: bool,
) -> Result<(Vec<u64>, u64, u64, usize)> {
    let file = std::fs::File::open(&path)?;
    let flen = file.metadata()?.len();
    let base = store.frame_range(0)?.0;
    let span = flen - base - size as u64;
    // The i-th ask reads `size` bytes `stride` apart — stride == size sweeps the file,
    // stride > size strides it, which is the shape rung delivery produces.
    let offset_of = move |i: usize| base + ((i as u64 * stride) % span.max(1));

    if warm {
        let mut buf = vec![0u8; size];
        for i in 0..asks {
            store.read_at_blocking(&mut buf, offset_of(i))?;
        }
    }

    let next = Arc::new(AtomicU64::new(0));
    let lat: Arc<std::sync::Mutex<Vec<u64>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let cpu0 = cpu_ns();
    let wall0 = Instant::now();

    match arm {
        // `depth` independent tasks, each doing the product's read: nowait on the executor,
        // blocking pool for the shortfall. Concurrency costs a thread per concurrent miss.
        Arm::Pool => {
            let mut set = tokio::task::JoinSet::new();
            for _ in 0..depth {
                let store = Arc::clone(&store);
                let next = Arc::clone(&next);
                let lat = Arc::clone(&lat);
                set.spawn(async move {
                    let mut buf = vec![0u8; size];
                    let mut mine = Vec::new();
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed) as usize;
                        if i >= asks {
                            break;
                        }
                        let off = offset_of(i);
                        let t = Instant::now();
                        let got = store.read_at_nowait(&mut buf, off).unwrap_or(0);
                        if got < size {
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
                });
            }
            while set.join_next().await.is_some() {}
        }
        // One ring, `depth` reads in flight, completions awaited on the eventfd. Concurrency
        // costs registered buffers, not threads.
        //
        // Slots refill as they complete rather than in lockstep batches: waiting for a whole
        // batch would charge every read in it the latency of the slowest, which measures the
        // batching and not the ring. The `pool` arm's tasks are independent for the same
        // reason, so the two hold `depth` in flight the same way.
        Arm::Uring | Arm::Hybrid => {
            let hybrid = arm == Arm::Hybrid;
            let mut ring = UringReader::new(&file, depth, size, true, false)?;
            let mut issued = 0usize;
            let mut starts = vec![Instant::now(); depth];
            let mut busy = vec![false; depth];
            let mut mine = Vec::with_capacity(asks);
            let mut in_flight = 0usize;
            let mut freed: Vec<usize> = Vec::with_capacity(depth);
            let mut completed = 0usize;
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
                    // The hybrid's whole point: a page-cache hit is served inline by
                    // `preadv2` and the ring never sees it. Only the shortfall is submitted.
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
        }
    }

    let wall = wall0.elapsed().as_nanos() as u64;
    let cpu = cpu_ns() - cpu0;
    let th = threads();
    let mut v = lat.lock().unwrap().clone();
    v.sort_unstable();
    Ok((v, wall, cpu, th))
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let path: PathBuf = args
        .next()
        .context("usage: depth_read_bench <study.sbnd> [asks] [size] [stride] [repeats]")?
        .into();
    let asks: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(2048);
    let size: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(16384);
    let stride: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(250_000);
    let repeats: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(5);

    let workers = std::thread::available_parallelism().map_or(4, |n| n.get());
    println!(
        "# depth_read_bench · {} · asks={asks} size={size} stride={stride} repeats={repeats} \
         workers={workers}",
        path.display()
    );
    println!("arm\ttemp\tdepth\trepeat\tasks\tp50_ns\tp99_ns\twall_ns\tcpu_ns\tthreads\tresident_pct\tasks_per_s\tcpu_ns_per_ask");

    for warm in [false, true] {
        for depth in [1usize, 2, 4, 8, 16, 32, 64] {
            for repeat in 0..repeats {
                // Arms alternate order between repeats so host drift cannot settle on one.
                // Rotate the order so host drift cannot settle on one arm.
                let order: [Arm; 3] = match repeat % 3 {
                    0 => [Arm::Pool, Arm::Uring, Arm::Hybrid],
                    1 => [Arm::Uring, Arm::Hybrid, Arm::Pool],
                    _ => [Arm::Hybrid, Arm::Pool, Arm::Uring],
                };
                for arm in order {
                    let resident = if warm { f64::NAN } else { evict(&path)? };
                    if !warm && resident > 0.01 {
                        anyhow::bail!(
                            "cold cell not cold: {:.1}% resident before {} d{depth}",
                            resident * 100.0,
                            arm.as_str()
                        );
                    }
                    let store = Arc::new(FrameStore::open(&path)?);
                    let rt = tokio::runtime::Builder::new_multi_thread()
                        .worker_threads(workers)
                        .enable_all()
                        .build()?;
                    let (lat, wall, cpu, th) = rt.block_on(run_cell(
                        arm,
                        Arc::clone(&store),
                        path.clone(),
                        depth,
                        asks,
                        size,
                        stride,
                        warm,
                    ))?;
                    let n = lat.len().max(1) as u64;
                    println!(
                        "{}\t{}\t{depth}\t{repeat}\t{}\t{}\t{}\t{wall}\t{cpu}\t{th}\t{:.3}\t{:.0}\t{}",
                        arm.as_str(),
                        if warm { "warm" } else { "cold" },
                        lat.len(),
                        pct(&lat, 0.50),
                        pct(&lat, 0.99),
                        if warm { 0.0 } else { resident * 100.0 },
                        n as f64 / (wall as f64 / 1e9),
                        cpu / n,
                    );
                    drop(rt);
                }
            }
        }
    }
    Ok(())
}
