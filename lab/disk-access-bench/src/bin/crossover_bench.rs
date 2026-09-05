//! Where exactly does the ring start paying? Miss rate as a *controlled* variable.
//!
//! The campaign found the ranking to be a function of the miss rate, with the crossover
//! somewhere between 5% and 20%. But those buckets were assembled from cells that happened
//! to land there — temperature and access shape were the knobs, and the miss rate was an
//! outcome. That is enough to see a crossover and not enough to place it.
//!
//! Here the miss rate is the knob: evict the file, then deliberately pre-warm a chosen
//! fraction of the offsets the cell will read. Everything else is held fixed. The output is
//! the one number a router would need — the miss rate above which a ring is worth having.

use anyhow::{Context, Result};
use disk_access_bench::uring_access::UringReader;
use exact_server::media::frame_store::FrameStore;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Arm {
    Pool,
    Uring,
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

fn pct(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    sorted[(((sorted.len() - 1) as f64) * p).round() as usize]
}

fn evict(path: &PathBuf) -> Result<()> {
    use std::os::unix::io::AsRawFd;
    let file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    for _ in 0..8 {
        // SAFETY: advisory call on an open fd; touches no user memory.
        unsafe {
            libc::posix_fadvise(
                file.as_raw_fd(),
                0,
                len as libc::off_t,
                libc::POSIX_FADV_DONTNEED,
            );
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
}

/// Deterministic 0..1 from an index — a fixed shuffle, so "warm 80%" picks the same 80% for
/// every arm in a repeat and a different 80% between repeats.
fn hash01(i: u64, salt: u64) -> f64 {
    let mut x = i.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ salt.wrapping_mul(0xD6E8_FEB8_6659_FD93);
    x ^= x >> 30;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 27;
    (x >> 11) as f64 / (1u64 << 53) as f64
}

#[allow(clippy::too_many_arguments)]
async fn run(
    arm: Arm,
    store: Arc<FrameStore>,
    file: Arc<std::fs::File>,
    offsets: Arc<Vec<u64>>,
    size: usize,
    depth: usize,
) -> Result<(Vec<u64>, u64)> {
    let lat = Arc::new(Mutex::new(Vec::new()));
    let misses = Arc::new(AtomicU64::new(0));
    let asks = offsets.len();

    match arm {
        Arm::Pool => {
            let next = Arc::new(AtomicU64::new(0));
            let mut set = tokio::task::JoinSet::new();
            for _ in 0..depth {
                let (store, offsets, next, lat, misses) = (
                    Arc::clone(&store),
                    Arc::clone(&offsets),
                    Arc::clone(&next),
                    Arc::clone(&lat),
                    Arc::clone(&misses),
                );
                set.spawn(async move {
                    let mut buf = vec![0u8; size];
                    let mut mine = Vec::new();
                    let mut m = 0u64;
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed) as usize;
                        if i >= asks {
                            break;
                        }
                        let off = offsets[i];
                        let t = Instant::now();
                        let got = store.read_at_nowait(&mut buf, off).unwrap_or(0);
                        if got < size {
                            m += 1;
                            let s = Arc::clone(&store);
                            let mut owned = std::mem::take(&mut buf);
                            owned = tokio::task::spawn_blocking(move || {
                                s.read_at_blocking(&mut owned[got..], off + got as u64)
                                    .map(|_| owned)
                            })
                            .await
                            .expect("join")
                            .expect("read");
                            buf = owned;
                        }
                        mine.push(t.elapsed().as_nanos() as u64);
                    }
                    lat.lock().unwrap().extend(mine);
                    misses.fetch_add(m, Ordering::Relaxed);
                });
            }
            while set.join_next().await.is_some() {}
        }
        Arm::Uring | Arm::Hybrid => {
            let hybrid = arm == Arm::Hybrid;
            let mut ring = UringReader::new(&file, depth, size, true, false)?;
            let mut starts = vec![Instant::now(); depth];
            let mut busy = vec![false; depth];
            let mut mine = Vec::with_capacity(asks);
            let mut freed = Vec::with_capacity(depth);
            let (mut issued, mut in_flight, mut done, mut m) = (0usize, 0usize, 0usize, 0u64);
            while done < asks {
                let mut pushed = 0;
                for slot in 0..depth {
                    if in_flight >= depth || issued >= asks {
                        break;
                    }
                    if busy[slot] {
                        continue;
                    }
                    let off = offsets[issued];
                    starts[slot] = Instant::now();
                    let got = if hybrid {
                        store.read_at_nowait(&mut ring.buf_mut(slot)[..size], off)?
                    } else {
                        0
                    };
                    if hybrid && got == size {
                        mine.push(starts[slot].elapsed().as_nanos() as u64);
                        issued += 1;
                        done += 1;
                        continue;
                    }
                    m += 1;
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
                let now = Instant::now();
                for &slot in &freed {
                    mine.push(now.duration_since(starts[slot]).as_nanos() as u64);
                    busy[slot] = false;
                    in_flight -= 1;
                    done += 1;
                }
            }
            lat.lock().unwrap().extend(mine);
            misses.fetch_add(m, Ordering::Relaxed);
        }
    }
    let mut v = lat.lock().unwrap().clone();
    v.sort_unstable();
    Ok((v, misses.load(Ordering::Relaxed)))
}

fn main() -> Result<()> {
    let mut a = std::env::args().skip(1);
    let path: PathBuf = a
        .next()
        .context("usage: crossover_bench <study.sbnd> [asks] [size] [stride] [repeats]")?
        .into();
    let asks: usize = a.next().and_then(|s| s.parse().ok()).unwrap_or(256);
    let size: usize = a.next().and_then(|s| s.parse().ok()).unwrap_or(16384);
    let stride: u64 = a.next().and_then(|s| s.parse().ok()).unwrap_or(250_000);
    let repeats: usize = a.next().and_then(|s| s.parse().ok()).unwrap_or(6);
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get());

    println!(
        "# crossover_bench · {} · asks={asks} size={size} stride={stride} repeats={repeats}",
        path.display()
    );
    println!("arm\twarm_frac\tdepth\trepeat\tmiss_pct\tp50_ns\tp99_ns\tcpu_ns_per_ask\tasks_per_s");

    for &warm_frac in &[0.0f64, 0.5, 0.8, 0.9, 0.95, 0.98, 1.0] {
        for &depth in &[1usize, 8] {
            for repeat in 0..repeats {
                let arms = [Arm::Pool, Arm::Uring, Arm::Hybrid];
                for pos in 0..arms.len() {
                    let arm = arms[(repeat + pos) % arms.len()];
                    let store = Arc::new(FrameStore::open(&path)?);
                    let file = Arc::new(std::fs::File::open(&path)?);
                    let flen = file.metadata()?.len();
                    let base = store.frame_range(0)?.0;
                    let span = flen - base - size as u64;
                    let offsets: Arc<Vec<u64>> = Arc::new(
                        (0..asks)
                            .map(|i| base + ((i as u64 * stride) % span.max(1)))
                            .collect(),
                    );

                    evict(&path)?;
                    // Pre-warm exactly the chosen fraction — the same subset for every arm
                    // within a repeat, a different one between repeats.
                    let mut buf = vec![0u8; size];
                    for (i, &off) in offsets.iter().enumerate() {
                        if hash01(i as u64, repeat as u64) < warm_frac {
                            store.read_at_blocking(&mut buf, off)?;
                        }
                    }

                    let rt = tokio::runtime::Builder::new_multi_thread()
                        .worker_threads(workers)
                        .enable_all()
                        .build()?;
                    let cpu0 = cpu_ns();
                    let t0 = Instant::now();
                    let (lat, misses) = rt.block_on(run(
                        arm,
                        Arc::clone(&store),
                        Arc::clone(&file),
                        Arc::clone(&offsets),
                        size,
                        depth,
                    ))?;
                    let wall = t0.elapsed().as_nanos() as u64;
                    let cpu = cpu_ns() - cpu0;
                    let n = lat.len().max(1) as u64;
                    println!(
                        "{}\t{warm_frac}\t{depth}\t{repeat}\t{:.1}\t{}\t{}\t{}\t{:.0}",
                        arm.as_str(),
                        100.0 * misses as f64 / asks as f64,
                        pct(&lat, 0.50),
                        pct(&lat, 0.99),
                        cpu / n,
                        n as f64 / (wall as f64 / 1e9),
                    );
                    drop(rt);
                }
            }
        }
    }
    Ok(())
}
