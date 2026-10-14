//! Lab only: the lab's `FrameCache`, one per process, in front of both readers. Its budget is
//! `LAB_FRAME_CACHE_BYTES`; `LAB_FRAME_CACHE_MUTATE=stale` hands back the previous frame's entry,
//! for the exactness check to catch. `docs/adr/disk-access.md` §13.

#[allow(dead_code)]
#[path = "../../../lab/disk-access-bench/src/frame_cache.rs"]
mod frame_cache;

use bytes::Bytes;
use frame_cache::FrameCache;
use std::sync::OnceLock;

struct Lab {
    cache: FrameCache,
    stale: bool,
}

fn lab() -> &'static Lab {
    static LAB: OnceLock<Lab> = OnceLock::new();
    LAB.get_or_init(|| {
        let budget = std::env::var("LAB_FRAME_CACHE_BYTES").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
        let stale = std::env::var("LAB_FRAME_CACHE_MUTATE").is_ok_and(|v| v == "stale");
        tracing::info!(budget, stale, "lab frame cache");
        Lab { cache: FrameCache::new(budget), stale }
    })
}

pub fn get(index: u32) -> Option<Bytes> {
    let lab = lab();
    match lab.stale {
        true => lab.cache.get(index.wrapping_sub(1)).or_else(|| lab.cache.get(index)),
        false => lab.cache.get(index),
    }
}

pub fn claim_fill(index: u32, len: usize) -> bool {
    lab().cache.claim_fill(index, len)
}

pub fn admit(index: u32, bytes: Bytes) {
    lab().cache.admit(index, bytes)
}

pub fn abandon_fill(index: u32) {
    lab().cache.abandon_fill(index)
}
