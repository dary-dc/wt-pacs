//! Server telemetry, lab builds only (series-server's `telemetry`): the Tap, its sink and report, path sampling,
//! and the controller trace.

mod report;
mod rows;
mod sink;
pub mod tap;

/// Loss-regime sampling: a row per second on its own switch, against `tap`'s row per frame.
pub mod path;

pub mod cc_trace;

pub use sink::flush_on_exit;
pub use tap::{set_run_meta, RunMeta};
