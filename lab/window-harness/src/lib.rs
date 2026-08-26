//! Headless WebTransport client for window-saturation / HoL measurements.

mod client;
mod metrics;
mod trace;
mod wire;

pub use client::{peak_outstanding, reset_peak_outstanding, run_depth_sweep, run_harness};
pub use metrics::{HarnessMetrics, HarnessMode, RunConfig};
pub use trace::TraceSpec;
