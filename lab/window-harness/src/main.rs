use anyhow::Context;
use clap::Parser;
use std::path::PathBuf;
use window_harness::{peak_outstanding, run_depth_sweep, run_harness, HarnessMode, RunConfig, StreamMode, TraceSpec};

#[derive(Parser)]
#[command(name = "window-harness")]
struct Args {
    #[arg(long, default_value = "https://127.0.0.1:4433/")]
    url: String,
    #[arg(long)]
    trace: Option<PathBuf>,
    #[arg(long, default_value_t = 2_000_000)]
    read_bps: u64,
    #[arg(long, default_value_t = 60_000)]
    timeout_ms: u64,
    /// Outstanding-ask depth D. 0 = legacy fire-all schedule (trace mode).
    #[arg(long, default_value_t = 0)]
    depth: u32,
    /// Frame count in the study (for window / pipeline wrap).
    #[arg(long, default_value_t = 20)]
    frame_count: u32,
    /// Stationary dwell for fill_rate / link_util (ms).
    #[arg(long, default_value_t = 2000)]
    fill_dwell_ms: u64,
    /// trace | saturate
    #[arg(long, default_value = "trace")]
    mode: String,
    /// E2 warm-cache control: prefetch before settle.
    #[arg(long, default_value_t = false)]
    warm_cache: bool,
    /// Simulated RTT (ms). Userspace stand-in for netem (ask + return path).
    #[arg(long, default_value_t = 0)]
    rtt_ms: u64,
    #[arg(long, default_value = "?")]
    arm: String,
    /// Must match the server's `--stream-mode`.
    #[arg(long, value_enum, default_value_t = StreamMode::PerFrame)]
    stream_mode: StreamMode,
    /// Local bind IP. Use `::` for dual-stack; `0.0.0.0` on hosts without IPv6.
    #[arg(long, default_value = "0.0.0.0")]
    bind: std::net::IpAddr,

    /// Run depths serially in one process (comma-separated, e.g. 1,2,3,4,5,6,7,8).
    #[arg(long)]
    depth_sweep: Option<String>,
    #[arg(long)]
    json: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let mode = match args.mode.to_ascii_lowercase().as_str() {
        "saturate" => HarnessMode::Saturate,
        _ => HarnessMode::Trace,
    };
    let trace = match (&mode, &args.trace) {
        (HarnessMode::Trace, Some(p)) => Some(TraceSpec::load(p).context("load trace")?),
        (HarnessMode::Trace, None) => anyhow::bail!("--trace required in trace mode"),
        (HarnessMode::Saturate, _) => None,
    };
    let depth = if mode == HarnessMode::Saturate {
        args.depth.max(1)
    } else {
        args.depth
    };
    let fill_dwell_ms = match mode {
        HarnessMode::Saturate => args.fill_dwell_ms.max(500),
        HarnessMode::Trace if depth > 0 => args.fill_dwell_ms,
        HarnessMode::Trace => 0,
    };
    let cfg = RunConfig {
        wt_url: args.url,
        read_bps: args.read_bps,
        timeout_ms: args.timeout_ms,
        depth,
        fill_dwell_ms,
        frame_count: args.frame_count,
        mode,
        warm_cache: args.warm_cache,
        rtt_ms: args.rtt_ms,
        stream_mode: args.stream_mode,
        bind_ip: args.bind,
    };
    if let Some(sweep) = &args.depth_sweep {
        let depths: Vec<u32> = sweep
            .split(',')
            .map(|s| s.trim().parse())
            .collect::<Result<_, _>>()
            .context("parse --depth-sweep")?;
        let trace = trace.context("--trace required with --depth-sweep")?;
        let results = run_depth_sweep(&trace, &cfg, &depths, &args.arm).await?;
        if args.json {
            println!("{}", serde_json::to_string_pretty(&results)?);
        } else {
            for m in &results {
                println!(
                    "depth={} peak_outstanding={} mean={:.2} p95={:.2} waits={}",
                    m.depth, m.peak_outstanding, m.mean_wait_ms, m.p95_wait_ms, m.wait_ms.len()
                );
            }
        }
        return Ok(());
    }
    let m = run_harness(trace.as_ref(), &cfg, &args.arm).await?;
    if args.json {
        println!("{}", serde_json::to_string_pretty(&m)?);
    } else {
        println!("trace={}", m.trace);
        println!("mode={}", m.mode);
        println!("arm={}", m.arm_label);
        println!("depth={}", m.depth);
        println!("peak_outstanding={}", peak_outstanding());
        println!("read_bps={}", m.read_bps);
        println!("wanted_frame={}", m.wanted_frame);
        println!("recovered_ms={:.2}", m.recovered_ms);
        println!("mean_wait_ms={:.2}", m.mean_wait_ms);
        println!("p95_wait_ms={:.2}", m.p95_wait_ms);
        println!("wait_samples={}", m.wait_samples);
        println!("fill_rate={:.2}", m.fill_rate);
        println!("link_util={:.4}", m.link_util);
        println!("fill_bytes={}", m.fill_bytes);
        println!("wasted_bytes={}", m.wasted_bytes);
        println!("commitment_depth={}", m.commitment_depth);
        println!("wanted_received={}", m.wanted_received);
        println!("warm_cache={}", m.warm_cache);
        println!("rtt_ms={}", m.rtt_ms);
    }
    Ok(())
}
