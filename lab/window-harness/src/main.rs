use anyhow::Context;
use clap::Parser;
use std::path::PathBuf;
use window_harness::{
    peak_outstanding, run_depth_sweep, run_harness, run_stall_client, HarnessMode, ReaderMode,
    RunConfig, StallConfig, StreamMode, TraceSpec, WindowShape,
};

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
    /// trace | saturate | stall
    ///
    /// `stall` is the pathological client: it asks for `--stall-asks` frames, reads for
    /// `--stall-after-ms` past the first byte, then stops reading entirely while holding
    /// the connection and every receive stream open. It is the only mode that can reach
    /// the flow-control ceilings — every other mode drains, so the ceiling never binds.
    /// It emits `StallOutcome` JSON, not `HarnessMetrics`: no latency figure from a client
    /// that refuses to read would mean anything.
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
    /// Local bind IP. Omit for wtransport's dual-stack default (what L1 used);
    /// pass `0.0.0.0` on hosts without an IPv6 stack.
    #[arg(long)]
    bind: Option<std::net::IpAddr>,
    /// Client display-cache capacity in frames. 0 = unbounded (the old behaviour).
    #[arg(long, default_value_t = 0)]
    cache_frames: usize,
    /// `closed` = wait for each frame before advancing (every campaign before R6).
    /// `open` = advance on the trace clock, letting the transport fall behind.
    ///
    /// Head-of-line blocking cannot occur in `closed`, so no stream-shape result from it
    /// is admissible. Default stays `closed` so prior campaigns remain reproducible.
    #[arg(long, value_enum, default_value_t = ReaderMode::Closed)]
    reader_mode: ReaderMode,
    /// Open-loop only: grace period after the last step before unmet wants are censored.
    #[arg(long, default_value_t = 3_000)]
    drain_ms: u64,
    /// Multiplier on the trace's step interval. >1 slows the reader, <1 speeds it up.
    /// Set the reader's demand against the rate the link can *achieve*, not its label.
    #[arg(long, default_value_t = 1.0)]
    step_scale: f64,

    /// Window shape around the cursor. Use `forward` for one-way traces.
    #[arg(long, value_enum, default_value_t = WindowShape::Symmetric)]
    window_shape: WindowShape,
    /// Override the trace step interval (ms).
    #[arg(long)]
    step_interval_ms: Option<u64>,
    /// Optional QUIC per-stream receive window (bytes). Diagnostic / equalisation.
    #[arg(long)]
    stream_recv_window: Option<u64>,

    /// `stall` mode: stop reading this long after the first byte arrives.
    #[arg(long, default_value_t = 3_000)]
    stall_after_ms: u64,
    /// `stall` mode: asks issued back-to-back before the stall.
    ///
    /// Must commit the server to more bytes than the ceiling under test, or both arms sit
    /// below both ceilings and the run reports the same null the draining workloads did.
    /// At 64 KB frames, quinn's 10 MB default `send_window` needs ~160.
    #[arg(long, default_value_t = 300)]
    stall_asks: u32,
    /// `stall` mode: hold the connection open and unread this long after stalling.
    #[arg(long, default_value_t = 30_000)]
    stall_hold_ms: u64,

    /// Run depths serially in one process (comma-separated, e.g. 1,2,3,4,5,6,7,8).
    #[arg(long)]
    depth_sweep: Option<String>,
    #[arg(long)]
    json: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let stall_mode = args.mode.eq_ignore_ascii_case("stall");
    let mode = match args.mode.to_ascii_lowercase().as_str() {
        "saturate" => HarnessMode::Saturate,
        _ => HarnessMode::Trace,
    };
    let trace = match (&mode, &args.trace) {
        // `stall` never replays a trace: it asks a flat run of frames and then stops.
        _ if stall_mode => None,
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
        window_shape: args.window_shape,
        step_interval_ms: args.step_interval_ms,
        stream_recv_window: args.stream_recv_window,
        bind_ip: args.bind,
        cache_frames: args.cache_frames,
        reader_mode: args.reader_mode,
        drain_ms: args.drain_ms,
        step_scale: args.step_scale,
    };
    if stall_mode {
        let stall = StallConfig {
            stall_after_ms: args.stall_after_ms,
            asks: args.stall_asks,
            hold_ms: args.stall_hold_ms,
        };
        let out = run_stall_client(&cfg, &stall, &args.arm).await?;
        if args.json {
            println!("{}", serde_json::to_string_pretty(&out)?);
        } else {
            println!("arm={}", out.arm);
            println!("stream_mode={}", out.stream_mode);
            println!("stall_after_ms={}", out.stall_after_ms);
            println!("hold_ms={}", out.hold_ms);
            println!("asks_requested={}", out.asks_requested);
            println!("asks_sent={}", out.asks_sent);
            println!("bytes_read={}", out.bytes_read);
            println!("stall_engaged={}", out.stall_engaged);
            println!("uni_streams_opened={}", out.uni_streams_opened);
            println!("connection_alive_at_end={}", out.connection_alive_at_end);
            println!("close_reason={}", out.close_reason);
            println!("elapsed_ms={:.2}", out.elapsed_ms);
        }
        return Ok(());
    }

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
        println!("miss_mean_wait_ms={:.2}", m.miss_mean_wait_ms);
        println!("miss_p95_wait_ms={:.2}", m.miss_p95_wait_ms);
        println!("cache_hits={}", m.cache_hits);
        println!("cache_misses={}", m.cache_misses);
        println!("cache_hit_rate={:.4}", m.cache_hit_rate);
        println!("wait_samples={}", m.wait_samples);
        println!("fill_rate={:.2}", m.fill_rate);
        println!("link_util={:.4}", m.link_util);
        println!("fill_bytes={}", m.fill_bytes);
        println!("wasted_bytes={}", m.wasted_bytes);
        println!("commitment_depth={}", m.commitment_depth);
        println!("wanted_received={}", m.wanted_received);
        println!("warm_cache={}", m.warm_cache);
        println!("rtt_ms={}", m.rtt_ms);
        println!("step_loop_ms={:.2}", m.step_loop_ms);
        println!("wait_h1_median_ms={:.2}", m.wait_h1_median_ms);
        println!("wait_h2_median_ms={:.2}", m.wait_h2_median_ms);
        println!("link_util_measured={:.4}", m.link_util_measured);
        println!("late_mean_ms={:.2}", m.late_mean_ms);
        println!("late_p95_ms={:.2}", m.late_p95_ms);
        println!("late_max_ms={:.2}", m.late_max_ms);
        println!("on_time_rate={:.4}", m.on_time_rate);
        println!("reader_mode={}", m.reader_mode);
        println!("reader_lag_ms={:.2}", m.reader_lag_ms);
        println!("censored_waits={}", m.censored_waits);
        println!("censored_frac={:.4}", m.censored_frac);
        println!("stranded_frames={}", m.stranded_frames);
        println!("stranded_bytes={}", m.stranded_bytes);
        println!("center_asks_dropped={}", m.center_asks_dropped);
    }
    Ok(())
}
