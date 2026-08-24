//! CLI sweep for layer-1 predicted curves.

use clap::Parser;
use queue_sim::{simulate_fly_and_settle, CancelPolicy, FlyAndSettleConfig};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "queue-sim")]
struct Args {
    /// Mean bytes per frame (overridden by --study when set).
    #[arg(long)]
    frame_bytes: Option<u64>,
    /// SBND bundle — uses mean codestream size from the index table.
    #[arg(long)]
    study: Option<PathBuf>,
    #[arg(long, default_value_t = 20)]
    burst_asks: u32,
    /// Comma-separated Mbps list, e.g. `1,5,10,50,100,300`.
    #[arg(long)]
    mbps: Option<String>,
    /// Minimum Mbps (inclusive) when using --mbps-range sweep.
    #[arg(long, default_value_t = 1)]
    mbps_min: u64,
    /// Maximum Mbps (inclusive).
    #[arg(long, default_value_t = 300)]
    mbps_max: u64,
    /// Step between Mbps samples.
    #[arg(long, default_value_t = 1)]
    mbps_step: u64,
    /// Also print human-readable ms columns.
    #[arg(long, default_value_t = true)]
    human: bool,
    /// Per-arm frames/bytes on wire (human mode).
    #[arg(long, default_value_t = false)]
    wire: bool,
}

fn parse_mbps_list(args: &Args) -> Vec<u64> {
    if let Some(s) = &args.mbps {
        return s.split(',').filter_map(|x| x.trim().parse().ok()).collect();
    }
    let [min, max, step] = [args.mbps_min, args.mbps_max, args.mbps_step];
    let step = step.max(1);
    let mut out = Vec::new();
    let mut v = min;
    while v <= max {
        out.push(v);
        v = v.saturating_add(step);
    }
    out
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let frame_bytes = if let Some(study) = &args.study {
        let s = queue_sim::study::stats_from_sbnd(study)?;
        eprintln!(
            "# study {} frames={} mean_frame_bytes={} min={} max={}",
            study.display(),
            s.frame_count,
            s.mean_frame_bytes,
            s.min_frame_bytes,
            s.max_frame_bytes
        );
        args.frame_bytes.unwrap_or(s.mean_frame_bytes)
    } else {
        args.frame_bytes.unwrap_or(50_000)
    };

    let rates_mbps = parse_mbps_list(&args);
    if args.human {
        println!(
            "frame_bytes={frame_bytes}\tburst_asks={}\ttrace=fly_and_settle\task_interval_ms=16",
            args.burst_asks
        );
        if args.wire {
            println!("mbps\tarm\tframes_on_wire\tbytes_on_wire\tframes_after_settle\tbytes_after_settle\twasted_codestream_bytes\trecovered_ms");
        } else {
            println!(
                "mbps\tcancel_off_wasted_bytes\tcancel_off_recovered_ms\tcancel_on_wasted_bytes\tcancel_on_recovered_ms\tcancel_saves_ms"
            );
        }
    } else {
        println!("link_bps\tcancel_off_wasted\tcancel_off_recovered_us\tcancel_on_wasted\tcancel_on_recovered_us");
    }

    for mbps in rates_mbps {
        let bps = mbps.saturating_mul(1_000_000);
        let base = FlyAndSettleConfig {
            frame_bytes,
            link_bps: bps,
            ask_interval_us: 16_000,
            burst_asks: args.burst_asks,
            cancel: CancelPolicy::Off,
        };
        let off = simulate_fly_and_settle(&base);
        let on = simulate_fly_and_settle(&FlyAndSettleConfig {
            cancel: CancelPolicy::On,
            ..base
        });
        if args.human {
            let off_ms = off.recovered_time_us as f64 / 1000.0;
            let on_ms = on.recovered_time_us as f64 / 1000.0;
            if args.wire {
                for (arm, m) in [("A_off", &off), ("B_on", &on)] {
                    println!(
                        "{mbps}\t{arm}\t{}\t{}\t{}\t{}\t{}\t{:.1}",
                        m.frames_on_wire,
                        m.bytes_on_wire,
                        m.frames_after_settle,
                        m.bytes_after_settle,
                        m.wasted_bytes,
                        if arm == "A_off" { off_ms } else { on_ms }
                    );
                }
            } else {
                println!(
                    "{mbps}\t{}\t{off_ms:.1}\t{}\t{on_ms:.1}\t{:.1}",
                    off.wasted_bytes,
                    on.wasted_bytes,
                    off_ms - on_ms
                );
            }
        } else {
            println!(
                "{bps}\t{}\t{}\t{}\t{}",
                off.wasted_bytes,
                off.recovered_time_us,
                on.wasted_bytes,
                on.recovered_time_us
            );
        }
    }
    Ok(())
}
