//! Warm vs cold SBND timings and **executor** stall — naive mmap vs blocking pre-touch (E3 / L3).
//!
//! Stall is measured on a `current_thread` tokio runtime: a heartbeat task uses
//! `tokio::time::sleep` while a worker task faults pages. Sync page faults are not `.await`
//! points, so on the naive arm they freeze the whole runtime (heartbeat wakes late). On the
//! L3 arm, `spawn_blocking` moves the fault off the executor and the heartbeat keeps time.

use anyhow::Context;
use clap::{Parser, ValueEnum};
use exact_server::media::frame_store::{touch_pages, FrameStore};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::runtime::Builder;

#[derive(Clone, Copy, Debug, ValueEnum)]
enum Arm {
    /// Touch pages on the executor thread (old path — cold faults stall the runtime).
    Naive,
    /// Touch pages via `spawn_blocking`, then `frame_slice` on the executor (L3 path).
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

fn bench_latencies_blocking(store: &Arc<FrameStore>, iterations: u32) -> (Vec<u64>, Vec<u64>) {
    let rt = Builder::new_current_thread().enable_all().build().expect("rt");
    let n = store.frame_count();
    let mut executor_samples = Vec::with_capacity(iterations as usize);
    let mut hop_samples = Vec::with_capacity(iterations as usize);
    rt.block_on(async {
        for i in 0..iterations {
            let idx = i % n;
            let store_touch = Arc::clone(store);
            let t_hop = Instant::now();
            tokio::task::spawn_blocking(move || store_touch.touch_frame_pages(idx).expect("touch"))
                .await
                .expect("join");
            hop_samples.push(t_hop.elapsed().as_nanos() as u64);

            let t0 = Instant::now();
            let slice = store.frame_slice(idx).expect("frame_slice");
            std::hint::black_box(slice.len());
            executor_samples.push(t0.elapsed().as_nanos() as u64);
        }
    });
    (executor_samples, hop_samples)
}

/// Heartbeat task on the current-thread runtime; worker faults pages either inline or via
/// `spawn_blocking`. Returns (mean_delay_ns, max_delay_ns, sample_count).
fn measure_executor_stall(
    store: &Arc<FrameStore>,
    iterations: u32,
    heartbeat_us: u64,
    arm: Arm,
) -> (u64, u64, u64) {
    let rt = Builder::new_current_thread().enable_all().build().expect("rt");
    let stop = Arc::new(AtomicBool::new(false));
    let max_delay = Arc::new(AtomicU64::new(0));
    let sum_delay = Arc::new(AtomicU64::new(0));
    let samples = Arc::new(AtomicU64::new(0));

    let stop_h = Arc::clone(&stop);
    let max_h = Arc::clone(&max_delay);
    let sum_h = Arc::clone(&sum_delay);
    let n_h = Arc::clone(&samples);
    let period = Duration::from_micros(heartbeat_us);

    rt.block_on(async {
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

        let store_w = Arc::clone(store);
        let work = tokio::spawn(async move {
            let n = store_w.frame_count();
            for i in 0..iterations {
                let idx = i % n;
                match arm {
                    Arm::Naive => {
                        let slice = store_w.frame_slice(idx).expect("frame_slice");
                        touch_pages(slice);
                    }
                    Arm::BlockingPretouch => {
                        let s = Arc::clone(&store_w);
                        tokio::task::spawn_blocking(move || s.touch_frame_pages(idx).expect("touch"))
                            .await
                            .expect("join");
                    }
                }
            }
        });

        let _ = work.await;
        stop.store(true, Ordering::Relaxed);
        let _ = hb.await;
    });

    let count = samples.load(Ordering::Relaxed).max(1);
    let sum = sum_delay.load(Ordering::Relaxed);
    let max = max_delay.load(Ordering::Relaxed);
    (sum / count, max, count)
}

fn make_cold_copy(study: &std::path::Path) -> anyhow::Result<PathBuf> {
    let cold_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.local/measurements");
    std::fs::create_dir_all(&cold_dir)?;
    let cold_copy = cold_dir.join(format!("e3-cold-{}.sbnd", std::process::id()));
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

    let (warm_p50, warm_p99, warm_hop_p50, warm_hop_p99) = match arm {
        Arm::Naive => {
            let mut warm_lat = bench_latencies_naive(&warm_store, iterations);
            let (p50, p99) = summarize(&mut warm_lat);
            (p50, p99, None, None)
        }
        Arm::BlockingPretouch => {
            let (mut exec, mut hop) = bench_latencies_blocking(&warm_store, iterations);
            let (p50, p99) = summarize(&mut exec);
            let (hop_p50, hop_p99) = summarize(&mut hop);
            (p50, p99, Some(hop_p50), Some(hop_p99))
        }
    };
    let (warm_stall_mean, warm_stall_max, warm_stall_n) =
        measure_executor_stall(&warm_store, iterations, heartbeat_us, arm);

    let cold_copy = make_cold_copy(study)?;
    let cold_store = Arc::new(FrameStore::open(&cold_copy)?);
    let (cold_p50, cold_p99) = match arm {
        Arm::Naive => {
            let mut cold_lat = bench_latencies_naive(&cold_store, iterations);
            summarize(&mut cold_lat)
        }
        Arm::BlockingPretouch => {
            let (_exec, mut hop) = bench_latencies_blocking(&cold_store, iterations);
            summarize(&mut hop)
        }
    };
    drop(cold_store);
    advise_dontneed(&cold_copy)?;
    let cold_store2 = Arc::new(FrameStore::open(&cold_copy)?);
    let (cold_stall_mean, cold_stall_max, cold_stall_n) =
        measure_executor_stall(&cold_store2, iterations, heartbeat_us, arm);
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
    println!(
        "warm_stall_mean_ns={warm_stall_mean} warm_stall_max_ns={warm_stall_max} warm_stall_samples={warm_stall_n}"
    );
    println!(
        "cold_stall_mean_ns={cold_stall_mean} cold_stall_max_ns={cold_stall_max} cold_stall_samples={cold_stall_n}"
    );
    println!("note=cold copy + posix_fadvise(DONTNEED); no drop_caches / CAP_SYS_ADMIN");
    println!("note=stall uses current_thread tokio runtime: heartbeat sleep vs worker faults");
    match arm {
        Arm::Naive => {
            println!("note=worker touches on the executor thread (sync fault freezes the runtime)");
        }
        Arm::BlockingPretouch => {
            println!(
                "note=warm_p50 is frame_slice on executor after spawn_blocking touch; warm_hop is hop+touch"
            );
            println!("note=cold_p50/p99 are spawn_blocking hop+touch (fault cost stays on the pool)");
            println!("note=worker uses spawn_blocking; executor should keep beating");
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
