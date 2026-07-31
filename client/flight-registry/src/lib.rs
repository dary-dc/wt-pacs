//! In-flight frame ask bookkeeping (host-testable; not linked into WASM graph).

use std::collections::HashSet;

#[derive(Debug, Default)]
pub struct FlightRegistry {
    in_flight: HashSet<u32>,
}

impl FlightRegistry {
    pub fn register(&mut self, frame: u32) -> bool {
        if self.in_flight.contains(&frame) {
            return false;
        }
        self.in_flight.insert(frame);
        true
    }

