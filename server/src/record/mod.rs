//! Write-only recording — one concrete type, zero-sized unless `feature = "telemetry"`.
//!
//! The product path hands facts in and never reads state back (I2). `Tap` owns the
//! clocks and the sink; `Recorder` is the only thing the session loop knows about.

mod types;

pub use types::{LocateOutcome, Refusal, WriteOutcome};

/// Opaque instant. `()` in default builds, so no clock is read in product code.
#[cfg(feature = "telemetry")]
pub type Stamp = std::time::Instant;
#[cfg(not(feature = "telemetry"))]
pub type Stamp = ();

#[cfg(feature = "telemetry")]
pub mod tap;

/// Zero-sized and fully inlined away in default builds — see `recorder_is_zero_sized`.
#[derive(Default)]
pub struct Recorder {
    #[cfg(feature = "telemetry")]
    tap: Option<tap::Tap>,
}

impl Recorder {
    /// Attaches a `Tap` when `WTPACS_TELEMETRY` is set and the feature is compiled in.
    pub fn for_session() -> Self {
        Self {
            #[cfg(feature = "telemetry")]
            tap: tap::Tap::for_session(),
        }
    }

    #[inline(always)]
    pub fn stamp(&self) -> Stamp {
        #[cfg(feature = "telemetry")]
        {
            std::time::Instant::now()
        }
    }

    /// Ask parsed — ordinal assigned inside `Tap`, not returned (R1).
    #[inline(always)]
    pub fn ask(&mut self, frame_index: u32) {
        #[cfg(feature = "telemetry")]
        if let Some(t) = &mut self.tap {
            t.ask(frame_index);
        }
        #[cfg(not(feature = "telemetry"))]
        let _ = frame_index;
    }

    #[inline(always)]
    pub fn located(&mut self, since: Stamp, outcome: LocateOutcome, byte_len: usize) {
        #[cfg(feature = "telemetry")]
        if let Some(t) = &mut self.tap {
            t.located(since, outcome, byte_len);
        }
        #[cfg(not(feature = "telemetry"))]
        let _ = (since, outcome, byte_len);
    }

    #[inline(always)]
    pub fn wrote(&mut self, since: Stamp, outcome: WriteOutcome, byte_len: usize) {
        #[cfg(feature = "telemetry")]
        if let Some(t) = &mut self.tap {
            t.wrote(since, outcome, byte_len);
        }
        #[cfg(not(feature = "telemetry"))]
        let _ = (since, outcome, byte_len);
    }

    #[inline(always)]
    pub fn refused(&mut self, reason: Refusal) {
        #[cfg(feature = "telemetry")]
        if let Some(t) = &mut self.tap {
            t.refused(reason);
        }
        #[cfg(not(feature = "telemetry"))]
        let _ = reason;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The guarantee the deleted `Record`/`Noop` type parameter used to provide.
    #[cfg(not(feature = "telemetry"))]
    #[test]
    fn recorder_is_zero_sized() {
        assert_eq!(std::mem::size_of::<Recorder>(), 0);
    }
}
