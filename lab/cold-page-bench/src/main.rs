//! Warm vs cold SBND timings and **executor availability** — naive mmap vs blocking pre-touch (E3 / L3).
//!
//! Instrument (evidence review §6):
//! - Co-tenant `yield_now` gap monitor (ns), not sleep heartbeat
//! - Cold = **one pass** over frames `0..n` (never `i % n` revisits)
//! - Both arms consume frame bytes (touch / write-shaped read), not `black_box(len)`

use anyhow::Context;
use clap::{Parser, ValueEnum};
use exact_server::media::frame_store::{host_page_size, FrameStore};

/// Fault every page of `index` in. Lab-local since the product stopped pre-touching —
/// this crate exists to measure that rejected arm. See `docs/disk-access/adr.md`.
fn touch_frame_pages(store: &FrameStore, index: u32) -> anyhow::Result<()> {
    touch_pages(store.frame_slice(index)?);
    Ok(())
}

/// Touch one byte per page so the kernel faults the range now, not during a later read.
fn touch_pages(bytes: &[u8]) {
    let page = host_page_size();
    let mut acc = 0u8;
    for chunk in bytes.chunks(page) {
        acc ^= chunk[0];
    }
    if let Some(last) = bytes.last() {
        acc ^= *last;
    }
    std::hint::black_box(acc);
}
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::runtime::Builder;

#[derive(Clone, Copy, Debug, ValueEnum)]
enum Arm {
    /// Touch/read pages on the executor thread (old path — cold faults stall the runtime).
    Naive,
    /// Touch pages via `spawn_blocking`, then consume bytes on the executor (L3 path).
    BlockingPretouch,
}

#[derive(Parser)]
#[command(name = "cold-page-bench")]
struct Args {
    #[arg(long)]
    study: PathBuf,
    /// Warm iterations may revisit frames. Cold always uses one pass (`frame_count`).
    #[arg(long, default_value_t = 500)]
    iterations: u32,
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

/// Consume every byte the product will eventually hand to quinn (touch all pages).
fn consume_slice(slice: &[u8]) {
    touch_pages(slice);
}

fn bench_latencies_naive(store: &FrameStore, frames: &[u32]) -> Vec<u64> {
    let mut samples = Vec::with_capacity(frames.len());
    for &idx in frames {
        let t0 = Instant::now();
        let slice = store.frame_slice(idx).expect("frame_slice");
        consume_slice(slice);
        samples.push(t0.elapsed().as_nanos() as u64);
    }
    samples
}

fn bench_latencies_blocking(store: &Arc<FrameStore>, frames: &[u32]) -> (Vec<u64>, Vec<u64>) {
    let rt = Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("rt");
    let mut executor_samples = Vec::with_capacity(frames.len());
    let mut hop_samples = Vec::with_capacity(frames.len());
    rt.block_on(async {
        for &idx in frames {
            let store_touch = Arc::clone(store);
            let t_hop = Instant::now();
            tokio::task::spawn_blocking(move || {
                touch_frame_pages(&store_touch, idx).expect("touch")
            })
            .await
            .expect("join");
            hop_samples.push(t_hop.elapsed().as_nanos() as u64);

            let t0 = Instant::now();
            let slice = store.frame_slice(idx).expect("frame_slice");
            consume_slice(slice);
            executor_samples.push(t0.elapsed().as_nanos() as u64);
        }
    });
    (executor_samples, hop_samples)
}

/// Co-tenant yield gaps while a worker serves `frames` (product-shaped: await per frame).
fn measure_executor_gaps(
    store: &Arc<FrameStore>,
    frames: &[u32],
    arm: Arm,
) -> (u64, u64, u64, u64) {
    let rt = Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("rt");
    let stop = Arc::new(AtomicBool::new(false));
    let gap_out: Arc<Mutex<Vec<u64>>> = Arc::new(Mutex::new(Vec::new()));

    let mut gaps = rt.block_on(async {
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

        let store_w = Arc::clone(store);
        let frames_w = frames.to_vec();
        let work = tokio::spawn(async move {
            for &idx in &frames_w {
                match arm {
                    Arm::Naive => {
                        let slice = store_w.frame_slice(idx).expect("frame_slice");
                        consume_slice(slice);
                        tokio::task::yield_now().await;
                    }
                    Arm::BlockingPretouch => {
                        let s = Arc::clone(&store_w);
                        tokio::task::spawn_blocking(move || {
                            touch_frame_pages(&s, idx).expect("touch")
                        })
                        .await
                        .expect("join");
                        let slice = store_w.frame_slice(idx).expect("frame_slice");
                        consume_slice(slice);
                        tokio::task::yield_now().await;
                    }
                }
            }
        });

        let _ = work.await;
        stop.store(true, Ordering::Relaxed);
        tokio::task::yield_now().await;
        let _ = mon.await;
        gap_out.lock().unwrap().clone()
    });

    summarize_gaps(&mut gaps)
}

struct ColdCopy {
    path: PathBuf,
}

impl Drop for ColdCopy {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn make_cold_copy(study: &std::path::Path) -> anyhow::Result<ColdCopy> {
    let cold_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.local/measurements");
    std::fs::create_dir_all(&cold_dir)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let cold_copy = cold_dir.join(format!("e3-cold-{}-{}.sbnd", std::process::id(), stamp));
    {
        let mut src = std::fs::File::open(study)?;
        let mut dst = std::fs::File::create(&cold_copy)?;
        std::io::copy(&mut src, &mut dst)?;
        dst.sync_all()?;
    }
    advise_dontneed(&cold_copy)?;
    Ok(ColdCopy { path: cold_copy })
}

fn warm_frame_list(n: u32, iterations: u32) -> Vec<u32> {
    (0..iterations).map(|i| i % n).collect()
}

fn cold_frame_list(n: u32) -> Vec<u32> {
    // One honest pass — never wrap. Reporting a p50 over revisits as "cold" is F4.
    (0..n).collect()
}

fn run_arm(arm: Arm, study: &std::path::Path, iterations: u32) -> anyhow::Result<()> {
    let warm_store = Arc::new(FrameStore::open(study)?);
    let n = warm_store.frame_count();
    for idx in 0..n {
        touch_frame_pages(&warm_store, idx)?;
    }
    let warm_frames = warm_frame_list(n, iterations);

    let (warm_p50, warm_p99, warm_hop_p50, warm_hop_p99) = match arm {
        Arm::Naive => {
            let mut warm_lat = bench_latencies_naive(&warm_store, &warm_frames);
            let (p50, p99) = summarize(&mut warm_lat);
            (p50, p99, None, None)
        }
        Arm::BlockingPretouch => {
            let (mut exec, mut hop) = bench_latencies_blocking(&warm_store, &warm_frames);
            let (p50, p99) = summarize(&mut exec);
            let (hop_p50, hop_p99) = summarize(&mut hop);
            (p50, p99, Some(hop_p50), Some(hop_p99))
        }
    };
    let (warm_gap_p50, warm_gap_p99, warm_gap_max, warm_gap_n) =
        measure_executor_gaps(&warm_store, &warm_frames, arm);

    let cold = make_cold_copy(study)?;
    let cold_frames = cold_frame_list(n);
    let cold_store = Arc::new(FrameStore::open(&cold.path)?);
    let (cold_p50, cold_p99) = match arm {
        Arm::Naive => {
            let mut cold_lat = bench_latencies_naive(&cold_store, &cold_frames);
            summarize(&mut cold_lat)
        }
        Arm::BlockingPretouch => {
            let (_exec, mut hop) = bench_latencies_blocking(&cold_store, &cold_frames);
            summarize(&mut hop)
        }
    };
    drop(cold_store);
    advise_dontneed(&cold.path)?;
    let cold_store2 = Arc::new(FrameStore::open(&cold.path)?);
    let (cold_gap_p50, cold_gap_p99, cold_gap_max, cold_gap_n) =
        measure_executor_gaps(&cold_store2, &cold_frames, arm);

    let arm_name = match arm {
        Arm::Naive => "naive",
        Arm::BlockingPretouch => "blocking_pretouch",
    };
    println!("arm={arm_name}");
    println!("study={}", study.display());
    println!("warm_iterations={} cold_frames={}", iterations, n);
    println!("warm_p50_ns={warm_p50} warm_p99_ns={warm_p99}");
    if let (Some(h50), Some(h99)) = (warm_hop_p50, warm_hop_p99) {
        println!("warm_hop_p50_ns={h50} warm_hop_p99_ns={h99}");
    }
    println!("cold_p50_ns={cold_p50} cold_p99_ns={cold_p99}");
    println!(
        "warm_gap_p50_ns={warm_gap_p50} warm_gap_p99_ns={warm_gap_p99} warm_gap_max_ns={warm_gap_max} warm_gap_samples={warm_gap_n}"
    );
    println!(
        "cold_gap_p50_ns={cold_gap_p50} cold_gap_p99_ns={cold_gap_p99} cold_gap_max_ns={cold_gap_max} cold_gap_samples={cold_gap_n}"
    );
    println!("note=cold = one pass over 0..n-1 after posix_fadvise(DONTNEED); no i%n");
    println!("note=gaps = co-tenant yield_now monitor (executor unavailable to another session)");
    match arm {
        Arm::Naive => {
            println!("note=worker consumes bytes on the executor (sync fault freezes peers)");
        }
        Arm::BlockingPretouch => {
            println!("note=cold_p50/p99 are spawn_blocking hop+touch; consume on executor after");
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
        run_arm(arm, &study, args.iterations)?;
    }
    Ok(())
}
