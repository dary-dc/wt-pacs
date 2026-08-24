//! CLI sweep for layer-1 predicted curves.

use clap::Parser;
use queue_sim::{simulate_fly_and_settle, CancelPolicy, FlyAndSettleConfig};

#[derive(Parser)]
#[command(name = "queue-sim")]
struct Args {
    #[arg(long, default_value_t = 50_000)]
    frame_bytes: u64,
    #[arg(long, default_value_t = 20)]
    burst_asks: u32,
    #[arg(long, default_value = "2000000,5000000,10000000,50000000")]
    link_bps: String,
}

fn main() {
    let args = Args::parse();
    let rates: Vec<u64> = args
        .link_bps
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    println!("link_bps\tcancel_off_wasted\tcancel_off_recovered_us\tcancel_on_wasted\tcancel_on_recovered_us");
    for bps in rates {
        let base = FlyAndSettleConfig {
            frame_bytes: args.frame_bytes,
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
        println!(
            "{bps}\t{}\t{}\t{}\t{}",
            off.wasted_bytes,
            off.recovered_time_us,
            on.wasted_bytes,
            on.recovered_time_us
        );
    }
}
