//! Headless WebTransport client for window-saturation / HoL / ask-policy measurements.

mod client;
mod depth;
mod metrics;
mod trace;
mod wire;

pub use client::{peak_outstanding, reset_peak_outstanding, run_depth_sweep, run_harness};
pub use depth::{formula_depth, RttSource};
pub use metrics::{HarnessMetrics, HarnessMode, RunConfig, StreamMode, WindowShape};
pub use trace::TraceSpec;
