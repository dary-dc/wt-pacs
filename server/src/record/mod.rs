//! Server telemetry types and Tap sink (`feature = "telemetry"` only).

mod types;

pub use types::{LocateOutcome, Refusal, WriteOutcome};

#[cfg(feature = "telemetry")]
mod report;
#[cfg(feature = "telemetry")]
mod sink;
#[cfg(feature = "telemetry")]
pub mod tap;

#[cfg(feature = "telemetry")]
pub use sink::flush_on_exit;
