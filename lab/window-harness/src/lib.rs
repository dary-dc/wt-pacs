//! Headless WebTransport client for window-saturation / HoL measurements.

mod client;
mod metrics;
mod trace;
mod wire;

pub use client::run_harness;
pub use metrics::{HarnessMetrics, RunConfig};
pub use trace::TraceSpec;
