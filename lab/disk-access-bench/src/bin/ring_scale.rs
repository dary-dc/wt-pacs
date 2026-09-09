//! What a per-session ring costs when there are thousands of sessions.
//!
//! Both ring arms build one io_uring plus one eventfd per session that misses. CPU per read
//! is not the only thing that has to scale: at a thousand concurrent sessions that is a
//! thousand rings, and file descriptors, kernel memory and setup latency are all per-session
//! costs the campaign never measured.
//!
//!     ring_scale <study.sbnd> <count>

use anyhow::{Context, Result};
use exact_server::media::read_path::TILE_SLOTS;
use exact_server::media::uring_reader::UringReader;
use std::time::Instant;

fn open_fds() -> usize {
    std::fs::read_dir("/proc/self/fd")
        .map(|d| d.count())
        .unwrap_or(0)
}

/// Resident set in KiB, from `/proc/self/status`.
fn rss_kib() -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("VmRSS:"))
                .and_then(|l| l.split_whitespace().nth(1).and_then(|v| v.parse().ok()))
        })
        .unwrap_or(0)
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: ring_scale <study.sbnd> <count>");
        std::process::exit(2);
    }
    let file = std::fs::File::open(&args[1]).context("open study")?;
    let count: usize = args[2].parse()?;

    let (fd0, rss0) = (open_fds(), rss_kib());
    let mut rings = Vec::with_capacity(count);
    let mut setup = Vec::with_capacity(count);
    let t0 = Instant::now();
    for i in 0..count {
        let t = Instant::now();
        match UringReader::new(&file, TILE_SLOTS as u32) {
            Ok(r) => rings.push(r),
            Err(err) => {
                println!(
                    "FAILED at ring {i}: {err:#}\n  fds={} rss_kib={} (+{} since start)",
                    open_fds(),
                    rss_kib(),
                    rss_kib() - rss0
                );
                return Ok(());
            }
        }
        setup.push(t.elapsed().as_nanos() as u64);
    }
    let wall = t0.elapsed();
    setup.sort_unstable();
    let (fd1, rss1) = (open_fds(), rss_kib());
    println!(
        "rings={count}\tfds_per_ring={:.1}\trss_kib_per_ring={:.1}\tsetup_p50_ns={}\t\
         setup_p99_ns={}\ttotal_ms={}",
        (fd1 - fd0) as f64 / count as f64,
        (rss1 - rss0) as f64 / count as f64,
        setup[setup.len() / 2],
        setup[setup.len() * 99 / 100],
        wall.as_millis()
    );
    Ok(())
}
