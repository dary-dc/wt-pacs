//! Server telemetry types and Tap sink (`feature = "telemetry"` only).

mod types;

pub use types::{LocateOutcome, Refusal, WriteOutcome};

#[cfg(feature = "telemetry")]
pub mod tap;
