//! Time `frame_slice()` and runtime stall under warm vs cold-ish SBND mappings.
//! Stall = heartbeat scheduling delay while another task faults pages (E3).

use anyhow::Context;
use clap::Parser;
use exact_server::media::frame_store::FrameStore;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

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
}

/// Ask the kernel to drop file pages from the page cache (no privileges required).
fn advise_dontneed(path: &std::path::Path) -> anyhow::Result<()> {
    use std::os::unix::io::AsRawFd;
    let f = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .with_context(|| format!("open {}", path.display()))?;
    // Ensure copy is durable, then drop cached pages so the next mmap faults from disk.
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

fn bench_latencies(store: &FrameStore, iterations: u32) -> Vec<u64> {
    let n = store.frame_count();
    let mut samples = Vec::with_capacity(iterations as usize);
    for i in 0..iterations {
        let idx = i % n;
        let t0 = Instant::now();
        let slice = store.frame_slice(idx).expect("frame_slice");
        // Must touch pages — constructing the slice alone does not fault the whole range.
        touch_pages(slice);
        samples.push(t0.elapsed().as_nanos() as u64);
    }
    samples
}

fn touch_pages(bytes: &[u8]) {
    let mut acc = 0u8;
    for page in bytes.chunks(4096) {
        acc ^= page[0];
    }
    if let Some(last) = bytes.last() {
        acc ^= *last;
    }
    std::hint::black_box(acc);
}

fn measure_stall_ns(store: &FrameStore, iterations: u32, heartbeat_us: u64) -> (u64, u64, u64) {
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

    // Concurrent page-touching work on this process (same OS threads compete).
    let n = store.frame_count();
    for i in 0..iterations {
        let slice = store.frame_slice(i % n).expect("frame_slice");
        touch_pages(slice);
    }

    stop.store(true, Ordering::Relaxed);
    let _ = hb.join();
    let count = samples.load(Ordering::Relaxed).max(1);
    let sum = sum_delay.load(Ordering::Relaxed);
    let max = max_delay.load(Ordering::Relaxed);
    (sum / count, max, count)
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let study = args.study.canonicalize().context("study path")?;

    let warm_store = FrameStore::open(&study)?;
    for idx in 0..warm_store.frame_count() {
        let slice = warm_store.frame_slice(idx)?;
        touch_pages(slice);
    }
    let mut warm_lat = bench_latencies(&warm_store, args.iterations);
    warm_lat.sort_unstable();
    let (warm_stall_mean, warm_stall_max, _) =
        measure_stall_ns(&warm_store, args.iterations, args.heartbeat_us);

    // Must not use tmpfs (/tmp) — DONTNEED is a no-op there and "cold" stays RAM-hot.
    let cold_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.local/measurements");
    std::fs::create_dir_all(&cold_dir)?;
    let cold_copy = cold_dir.join(format!("e3-cold-{}.sbnd", std::process::id()));
    std::fs::copy(&study, &cold_copy)?;
    // Avoid btrfs/xfs reflink sharing extents with the warm original.
    {
        let data = std::fs::read(&study)?;
        std::fs::write(&cold_copy, &data)?;
    }
    advise_dontneed(&cold_copy)?;
    let cold_store = FrameStore::open(&cold_copy)?;
    let mut cold_lat = bench_latencies(&cold_store, args.iterations);
    cold_lat.sort_unstable();
    drop(cold_store);
    advise_dontneed(&cold_copy)?;
    let cold_store2 = FrameStore::open(&cold_copy)?;
    let (cold_stall_mean, cold_stall_max, _) =
        measure_stall_ns(&cold_store2, args.iterations, args.heartbeat_us);
    let _ = std::fs::remove_file(&cold_copy);

    println!("study={}", study.display());
    println!("iterations={}", args.iterations);
    println!(
        "warm_p50_ns={} warm_p99_ns={}",
        percentile(&warm_lat, 0.50),
        percentile(&warm_lat, 0.99)
    );
    println!(
        "cold_p50_ns={} cold_p99_ns={}",
        percentile(&cold_lat, 0.50),
        percentile(&cold_lat, 0.99)
    );
    println!(
        "warm_stall_mean_ns={} warm_stall_max_ns={}",
        warm_stall_mean, warm_stall_max
    );
    println!(
        "cold_stall_mean_ns={} cold_stall_max_ns={}",
        cold_stall_mean, cold_stall_max
    );
    println!("note=cold copy + posix_fadvise(DONTNEED); no drop_caches / CAP_SYS_ADMIN");
    println!("note=stall is heartbeat late-wake while frame_slice runs (naive mmap arm only)");
    Ok(())
}
// rebuild bump
