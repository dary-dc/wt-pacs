//! Write-only recording seam — always compiled (`Noop` only in default builds).
//!
//! Product code threads `R: Record` through the session loop. Clocks and the sink
//! live in `tap` (`feature = "telemetry"`).

mod types;

pub use types::{LocateOutcome, Refusal, WriteOutcome};

/// Opaque recorder — product path hands facts in, never reads state back (I2).
pub trait Record: Send {
    type Stamp: Copy + Send;

    fn stamp(&self) -> Self::Stamp;

    /// Ask parsed — ordinal assigned inside `Tap`, not returned (R1).
    fn ask(&mut self, frame_index: u32);

    fn located(&mut self, since: Self::Stamp, outcome: LocateOutcome, byte_len: usize);

    fn wrote(&mut self, since: Self::Stamp, outcome: WriteOutcome, byte_len: usize);

    fn refused(&mut self, reason: Refusal);
}

/// Zero-sized no-op recorder — production default (`Noop` inlined away).
#[derive(Clone, Copy, Default)]
pub struct Noop;

impl Record for Noop {
    type Stamp = ();

    #[inline(always)]
    fn stamp(&self) {}

    #[inline(always)]
    fn ask(&mut self, _: u32) {}

    #[inline(always)]
    fn located(&mut self, _: (), _: LocateOutcome, _: usize) {}

    #[inline(always)]
    fn wrote(&mut self, _: (), _: WriteOutcome, _: usize) {}

    #[inline(always)]
    fn refused(&mut self, _: Refusal) {}
}

#[cfg(feature = "telemetry")]
pub mod tap;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noop_is_zero_sized() {
        assert_eq!(std::mem::size_of::<Noop>(), 0);
    }
}
