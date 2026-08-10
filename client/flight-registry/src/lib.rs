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

    pub fn complete(&mut self, frame: u32) {
        self.in_flight.remove(&frame);
    }

    pub fn cancel(&mut self, frame: u32) -> bool {
        self.in_flight.remove(&frame)
    }

    pub fn len(&self) -> usize {
        self.in_flight.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
