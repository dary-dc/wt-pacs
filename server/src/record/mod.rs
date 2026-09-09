//! Server telemetry types and Tap sink (`feature = "telemetry"` only).

mod types;

pub use types::{LocateOutcome, Refusal, WriteOutcome};

#[cfg(feature = "telemetry")]
mod report;
#[cfg(feature = "telemetry")]
mod rows;
#[cfg(feature = "telemetry")]
mod sink;
#[cfg(feature = "telemetry")]
pub mod tap;

/// Loss-regime sampling. Separate from `tap`: a row per second to leave on in
/// production, against `tap`'s row per frame for development.
#[cfg(feature = "telemetry")]
pub mod path;

#[cfg(feature = "telemetry")]
pub use report::write_report_from_rows;
#[cfg(feature = "telemetry")]
pub use sink::flush_on_exit;
#[cfg(feature = "telemetry")]
pub use tap::{set_run_meta, RunMeta};
