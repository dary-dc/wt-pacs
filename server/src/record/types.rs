//! Small `Copy` enums shared by product loop and Tap — not telemetry-specific.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum LocateOutcome {
    Ok = 0,
    NotFound = 1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum WriteOutcome {
    Sent = 0,
    WriteErr = 1,
    Refused = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Refusal {
    NotFound = 0,
}
