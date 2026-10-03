//! Server telemetry: the Tap, its sink and report, and path sampling.

mod report;
mod rows;
mod sink;
pub mod tap;

/// Loss-regime sampling: a row per second on its own switch, against `tap`'s row per frame.
pub mod path;

pub use report::write_report_from_rows;
pub use sink::flush_on_exit;
pub use tap::{set_run_meta, RunMeta};
