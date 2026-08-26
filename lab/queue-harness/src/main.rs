use anyhow::Context;
use clap::Parser;
use queue_harness::{run_harness, RunConfig, TraceSpec};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "queue-harness")]
struct Args {
    #[arg(long, default_value = "https://127.0.0.1:4433/")]
    url: String,
    #[arg(long)]
    trace: PathBuf,
    #[arg(long, default_value_t = 2_000_000)]
    read_bps: u64,
    #[arg(long, default_value = "true")]
    send_cancel: bool,
    #[arg(long, default_value_t = 60_000)]
    timeout_ms: u64,
    /// Outstanding-ask depth D. 0 = legacy non-window schedule.
    #[arg(long, default_value_t = 0)]
    depth: u32,
    /// Frame count in the study (for window wrap).
    #[arg(long, default_value_t = 20)]
    frame_count: u32,
    /// Stationary dwell after settle for fill_rate (ms).
    #[arg(long, default_value_t = 2000)]
    fill_dwell_ms: u64,
    /// Report label (A/B/C/D) matching server arm.
    #[arg(long, default_value = "?")]
    arm: String,
    #[arg(long)]
    json: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let trace = TraceSpec::load(&args.trace).context("load trace")?;
    let cfg = RunConfig {
        wt_url: args.url,
        read_bps: args.read_bps,
        send_cancel: args.send_cancel,
        timeout_ms: args.timeout_ms,
        depth: args.depth,
        fill_dwell_ms: if args.depth > 0 {
            args.fill_dwell_ms
        } else {
            0
        },
        frame_count: args.frame_count,
    };
    let m = run_harness(&trace, &cfg, &args.arm).await?;
    if args.json {
        println!("{}", serde_json::to_string_pretty(&m)?);
    } else {
        println!("trace={}", m.trace);
        println!("arm={}", m.arm_label);
        println!("depth={}", m.depth);
        println!("read_bps={}", m.read_bps);
        println!("wanted_frame={}", m.wanted_frame);
        println!("recovered_ms={:.2}", m.recovered_ms);
        println!("fill_rate={:.2}", m.fill_rate);
        println!("wasted_bytes={}", m.wasted_bytes);
        println!("commitment_depth={}", m.commitment_depth);
        println!("wanted_received={}", m.wanted_received);
    }
    Ok(())
}
