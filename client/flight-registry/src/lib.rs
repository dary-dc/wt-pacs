//! In-flight frame ask bookkeeping (host-testable; not linked into WASM graph).

use std::collections::HashSet;

#[derive(Debug, Default)]
pub struct FlightRegistry {
    in_flight: HashSet<u32>,
}

