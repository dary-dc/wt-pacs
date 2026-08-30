//! Headless WebTransport client for window-saturation / HoL measurements.

mod client;
mod depth;
mod metrics;
mod trace;
mod wire;

pub use client::{peak_outstanding, reset_peak_outstanding, run_depth_sweep, run_harness};
pub use depth::formula_depth;
pub use metrics::{HarnessMetrics, HarnessMode, RunConfig, StreamMode};
pub use trace::TraceSpec;
