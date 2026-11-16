//! Server telemetry, lab builds only (series-server's `telemetry`): the Tap, its sink and report, path sampling,
//! and the controller trace.

mod report;
mod rows;
mod sink;
pub mod tap;

/// Loss-regime sampling: a row per second on its own switch, against `tap`'s row per frame.
pub mod path;

/// One line per session at its end, keyed by the page's load id: the reports' link record.
pub mod link;

/// SESSION's receiver: a record per client stream after the control stream, answered with one byte.
pub mod session_report;

pub mod cc_trace;

pub use sink::flush_on_exit;
pub use tap::{set_run_meta, RunMeta};
