//! Warm vs cold SBND timings and heartbeat stall — naive mmap vs blocking pre-touch (E3 / L3).
//!
//! Stall = heartbeat late-wake while another thread faults pages. The L3 path moves the fault onto
//! a blocking thread so the "executor" stand-in (and the heartbeat) should not stall.

use anyhow::Context;
use clap::{Parser, ValueEnum};
use exact_server::media::frame_store::{touch_pages, FrameStore};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, ValueEnum)]
enum Arm {
    /// Touch pages on the calling thread (old path — cold faults stall the "executor").
    Naive,
    /// Touch pages on a blocking thread, then `frame_slice` on the caller (L3 path).
    BlockingPretouch,
}

#[derive(Parser)]
#[command(name = "cold-page-bench")]
struct Args {
    #[arg(long)]
    study: PathBuf,
    #[arg(long, default_value_t = 500)]
    iterations: u32,
    /// Heartbeat period while measuring stall (µs).
    #[arg(long, default_value_t = 500)]
    heartbeat_us: u64,
    /// Which arm to run. Default runs both.
    #[arg(long, value_enum)]
    arm: Option<Arm>,
}

/// Ask the kernel to drop file pages from the page cache (no privileges required).
fn advise_dontneed(path: &std::path::Path) -> anyhow::Result<()> {
    use std::os::unix::io::AsRawFd;
    let f = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| format!("open {}", path.display()))?;
    f.sync_all().context("fsync cold copy")?;
    let rc = unsafe { libc::posix_fadvise(f.as_raw_fd(), 0, 0, libc::POSIX_FADV_DONTNEED) };
    if rc != 0 {
        anyhow::bail!("posix_fadvise(DONTNEED) failed errno={rc}");
    }
    Ok(())
}

fn percentile(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn summarize(samples: &mut [u64]) -> (u64, u64) {
    samples.sort_unstable();
    (percentile(samples, 0.50), percentile(samples, 0.99))
}

/// Naive: `frame_slice` + touch on the calling thread.
fn bench_latencies_naive(store: &FrameStore, iterations: u32) -> Vec<u64> {
    let n = store.frame_count();
    let mut samples = Vec::with_capacity(iterations as usize);
    for i in 0..iterations {
        let idx = i % n;
        let t0 = Instant::now();
        let slice = store.frame_slice(idx).expect("frame_slice");
        touch_pages(slice);
        samples.push(t0.elapsed().as_nanos() as u64);
    }
    samples
}

/// Blocking pre-touch: touch on a worker thread; then time `frame_slice` on the caller (executor
/// stand-in). Also records the hop+touch cost separately.
fn bench_latencies_blocking(
    store: &Arc<FrameStore>,
    iterations: u32,
) -> (Vec<u64>, Vec<u64>) {
    let n = store.frame_count();
    let mut executor_samples = Vec::with_capacity(iterations as usize);
    let mut hop_samples = Vec::with_capacity(iterations as usize);
    for i in 0..iterations {
        let idx = i % n;
        let store_touch = Arc::clone(store);
        let t_hop = Instant::now();
        let join = thread::spawn(move || store_touch.touch_frame_pages(idx).expect("touch"));
        join.join().expect("join touch");
        hop_samples.push(t_hop.elapsed().as_nanos() as u64);

        let t0 = Instant::now();
        let slice = store.frame_slice(idx).expect("frame_slice");
        // Pages should already be resident; a light touch confirms without re-faulting cold I/O.
        std::hint::black_box(slice.len());
        executor_samples.push(t0.elapsed().as_nanos() as u64);
    }
    (executor_samples, hop_samples)
}

fn measure_stall_naive(store: &FrameStore, iterations: u32, heartbeat_us: u64) -> (u64, u64, u64) {
    let (stop, max_delay, sum_delay, samples, hb) = start_heartbeat(heartbeat_us);

    let n = store.frame_count();
    for i in 0..iterations {
        let slice = store.frame_slice(i % n).expect("frame_slice");
        touch_pages(slice);
    }

    stop_heartbeat(stop, hb, max_delay, sum_delay, samples)
}

fn measure_stall_blocking(
    store: &Arc<FrameStore>,
    iterations: u32,
    heartbeat_us: u64,
) -> (u64, u64, u64) {
    let (stop, max_delay, sum_delay, samples, hb) = start_heartbeat(heartbeat_us);

    // Faults run on a blocking worker; this thread only joins — stand-in for the async executor
    // awaiting spawn_blocking.
    let n = store.frame_count();
    for i in 0..iterations {
        let idx = i % n;
        let store_touch = Arc::clone(store);
        thread::spawn(move || store_touch.touch_frame_pages(idx).expect("touch"))
            .join()
            .expect("join");
    }

    stop_heartbeat(stop, hb, max_delay, sum_delay, samples)
}

fn start_heartbeat(
    heartbeat_us: u64,
) -> (
    Arc<AtomicBool>,
    Arc<AtomicU64>,
    Arc<AtomicU64>,
    Arc<AtomicU64>,
    thread::JoinHandle<()>,
) {
    let stop = Arc::new(AtomicBool::new(false));
    let max_delay = Arc::new(AtomicU64::new(0));
    let sum_delay = Arc::new(AtomicU64::new(0));
    let samples = Arc::new(AtomicU64::new(0));

    let stop_h = Arc::clone(&stop);
    let max_h = Arc::clone(&max_delay);
    let sum_h = Arc::clone(&sum_delay);
    let n_h = Arc::clone(&samples);
    let hb = thread::spawn(move || {
        let period = Duration::from_micros(heartbeat_us);
        let mut expected = Instant::now() + period;
        while !stop_h.load(Ordering::Relaxed) {
            thread::sleep(period);
            let now = Instant::now();
            let delay = now.saturating_duration_since(expected).as_nanos() as u64;
            expected = now + period;
            max_h.fetch_max(delay, Ordering::Relaxed);
            sum_h.fetch_add(delay, Ordering::Relaxed);
            n_h.fetch_add(1, Ordering::Relaxed);
        }
    });
    (stop, max_delay, sum_delay, samples, hb)
}

fn stop_heartbeat(
    stop: Arc<AtomicBool>,
    hb: thread::JoinHandle<()>,
    max_delay: Arc<AtomicU64>,
    sum_delay: Arc<AtomicU64>,
    samples: Arc<AtomicU64>,
) -> (u64, u64, u64) {
    stop.store(true, Ordering::Relaxed);
    let _ = hb.join();
    let count = samples.load(Ordering::Relaxed).max(1);
    let sum = sum_delay.load(Ordering::Relaxed);
    let max = max_delay.load(Ordering::Relaxed);
    (sum / count, max, count)
}

fn make_cold_copy(study: &std::path::Path) -> anyhow::Result<PathBuf> {
    // Must not use tmpfs (/tmp) — DONTNEED is a no-op there and "cold" stays RAM-hot.
    let cold_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.local/measurements");
    std::fs::create_dir_all(&cold_dir)?;
    let cold_copy = cold_dir.join(format!("e3-cold-{}.sbnd", std::process::id()));
    // Full rewrite — avoid btrfs/xfs reflink sharing extents with the warm original.
    let data = std::fs::read(study)?;
    std::fs::write(&cold_copy, &data)?;
    advise_dontneed(&cold_copy)?;
    Ok(cold_copy)
}

fn run_arm(arm: Arm, study: &std::path::Path, iterations: u32, heartbeat_us: u64) -> anyhow::Result<()> {
    let warm_store = Arc::new(FrameStore::open(study)?);
    for idx in 0..warm_store.frame_count() {
        warm_store.touch_frame_pages(idx)?;
    }

    let (warm_p50, warm_p99, warm_hop_p50, warm_hop_p99, warm_stall_mean, warm_stall_max) =
        match arm {
            Arm::Naive => {
                let mut warm_lat = bench_latencies_naive(&warm_store, iterations);
                let (p50, p99) = summarize(&mut warm_lat);
                let (stall_mean, stall_max, _) =
                    measure_stall_naive(&warm_store, iterations, heartbeat_us);
                (p50, p99, None, None, stall_mean, stall_max)
            }
            Arm::BlockingPretouch => {
                let (mut exec, mut hop) = bench_latencies_blocking(&warm_store, iterations);
                let (p50, p99) = summarize(&mut exec);
                let (hop_p50, hop_p99) = summarize(&mut hop);
                let (stall_mean, stall_max, _) =
                    measure_stall_blocking(&warm_store, iterations, heartbeat_us);
                (p50, p99, Some(hop_p50), Some(hop_p99), stall_mean, stall_max)
            }
        };

    let cold_copy = make_cold_copy(study)?;
    let cold_store = Arc::new(FrameStore::open(&cold_copy)?);
    let (cold_p50, cold_p99) = match arm {
        Arm::Naive => {
            let mut cold_lat = bench_latencies_naive(&cold_store, iterations);
            summarize(&mut cold_lat)
        }
        Arm::BlockingPretouch => {
            // Report the hop+touch cost under cold — that is where the fault still lives.
            let (_exec, mut hop) = bench_latencies_blocking(&cold_store, iterations);
            summarize(&mut hop)
        }
    };
    drop(cold_store);
    advise_dontneed(&cold_copy)?;
    let cold_store2 = Arc::new(FrameStore::open(&cold_copy)?);
    let (cold_stall_mean, cold_stall_max, _) = match arm {
        Arm::Naive => measure_stall_naive(&cold_store2, iterations, heartbeat_us),
        Arm::BlockingPretouch => measure_stall_blocking(&cold_store2, iterations, heartbeat_us),
    };
    let _ = std::fs::remove_file(&cold_copy);

    let arm_name = match arm {
        Arm::Naive => "naive",
        Arm::BlockingPretouch => "blocking_pretouch",
    };
    println!("arm={arm_name}");
    println!("study={}", study.display());
    println!("iterations={iterations}");
    println!("warm_p50_ns={warm_p50} warm_p99_ns={warm_p99}");
    if let (Some(h50), Some(h99)) = (warm_hop_p50, warm_hop_p99) {
        println!("warm_hop_p50_ns={h50} warm_hop_p99_ns={h99}");
    }
    println!("cold_p50_ns={cold_p50} cold_p99_ns={cold_p99}");
    println!("warm_stall_mean_ns={warm_stall_mean} warm_stall_max_ns={warm_stall_max}");
    println!("cold_stall_mean_ns={cold_stall_mean} cold_stall_max_ns={cold_stall_max}");
    println!("note=cold copy + posix_fadvise(DONTNEED); no drop_caches / CAP_SYS_ADMIN");
    match arm {
        Arm::Naive => {
            println!("note=stall is heartbeat late-wake while frame_slice+touch runs on caller");
        }
        Arm::BlockingPretouch => {
            println!(
                "note=warm_p50 is frame_slice on caller after blocking touch; warm_hop is thread hop+touch"
            );
            println!("note=cold_p50/p99 are hop+touch on worker (fault cost stays there)");
            println!("note=stall is heartbeat late-wake while worker touches; caller only joins");
        }
    }
    println!("---");
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let study = args.study.canonicalize().context("study path")?;
    let arms = match args.arm {
        Some(Arm::Naive) => vec![Arm::Naive],
        Some(Arm::BlockingPretouch) => vec![Arm::BlockingPretouch],
        None => vec![Arm::Naive, Arm::BlockingPretouch],
    };
    for arm in arms {
        run_arm(arm, &study, args.iterations, args.heartbeat_us)?;
    }
    Ok(())
}
