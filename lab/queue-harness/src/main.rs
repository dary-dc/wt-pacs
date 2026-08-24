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
    /// Report label only — set when server was started with WTPACS_QUEUE_CANCEL=1.
    #[arg(long, default_value_t = false)]
    server_cancel: bool,
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
    };
    let m = run_harness(&trace, &cfg, args.server_cancel).await?;
    if args.json {
        println!("{}", serde_json::to_string_pretty(&m)?);
    } else {
        println!("trace={}", m.trace);
        println!("read_bps={}", m.read_bps);
        println!("server_cancel={}", m.server_cancel_enabled);
        println!("wanted_frame={}", m.wanted_frame);
        println!("recovered_ms={:.2}", m.recovered_ms);
        println!("wasted_bytes={}", m.wasted_bytes);
        println!("commitment_depth={}", m.commitment_depth);
        println!("wanted_received={}", m.wanted_received);
    }
    Ok(())
}
