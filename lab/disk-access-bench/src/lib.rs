//! Shared lab machinery for the disk-access campaign.
//!
//! The binaries — `disk-access-bench`, `frame_budget`, `wire_send_bench` — are separate
//! targets that need the same arms, so the arms live here rather than being restated per
//! binary. Nothing in this crate is product code: `server/` does not depend on it, and the
//! shipped read path (`FrameStore::read_at_nowait` / `read_at_blocking`) is called from
//! here rather than reimplemented, so the lab times what the product would run.

pub mod candidate_access;
pub mod frame_cache;
pub mod rejected_access;
pub mod uring_access;
