//! Time `frame_slice()` on warm vs cold-ish SBND mappings.

use anyhow::Context;
use clap::Parser;
use exact_server::media::frame_store::FrameStore;
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[derive(Parser)]
#[command(name = "cold-page-bench")]
struct Args {
    #[arg(long)]
    study: PathBuf,
    #[arg(long, default_value_t = 500)]
    iterations: u32,
}

fn bench(store: &FrameStore, iterations: u32) -> Duration {
    let n = store.frame_count();
    let start = Instant::now();
    for i in 0..iterations {
        let idx = i % n;
        let _ = store.frame_slice(idx).expect("frame_slice");
    }
    start.elapsed()
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let study = args.study.canonicalize().context("study path")?;

    let warm_store = FrameStore::open(&study)?;
    for idx in 0..warm_store.frame_count() {
        let _ = warm_store.frame_slice(idx)?;
    }
    let warm = bench(&warm_store, args.iterations);

    let cold_copy = std::env::temp_dir().join(format!(
        "wt-pacs-cold-{}.sbnd",
        std::process::id()
    ));
    std::fs::copy(&study, &cold_copy)?;
    let cold_store = FrameStore::open(&cold_copy)?;
    let cold = bench(&cold_store, args.iterations);
    let _ = std::fs::remove_file(&cold_copy);

    println!("study={}", study.display());
    println!("iterations={}", args.iterations);
    println!("warm_total_ms={:.2}", warm.as_secs_f64() * 1000.0);
    println!("cold_total_ms={:.2}", cold.as_secs_f64() * 1000.0);
    println!(
        "cold_over_warm_ratio={:.2}",
        cold.as_secs_f64() / warm.as_secs_f64().max(1e-9)
    );
    println!("note= cold copy avoids warm process pages; OS page cache may still help");
    Ok(())
}
