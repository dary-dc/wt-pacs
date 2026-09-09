//! Headless WebTransport client for window-saturation / HoL measurements.

mod client;
mod metrics;
mod stall;
mod trace;
mod wire;

pub use client::{
    center_asks_dropped, peak_outstanding, reset_peak_outstanding, run_depth_sweep, run_harness,
};
pub use metrics::{HarnessMetrics, HarnessMode, ReaderMode, RunConfig, StreamMode, WindowShape};
pub use stall::{run_stall_client, StallConfig, StallOutcome};
pub use trace::TraceSpec;
