//! Bounded, process-private frame cache — **a lab arm**; nothing in `server/` uses it. A
//! byte budget with LRU eviction, admission on the *second* ask, and fills from bytes the
//! caller already holds. What it is worth: `docs/disk-access/adr.md` §Levers.

use bytes::{Bytes, BytesMut};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// Bounded too: remembering every index asked once is a slow leak on a large study.
const MAX_SEEN: usize = 1 << 16;

/// Recycled so a churning cache does not pay a minor fault per page on every admission.
const MAX_SPARE: usize = 8;

struct Entry {
    bytes: Bytes,
    last_used: u64,
}

#[derive(Default)]
struct Inner {
    resident: HashMap<u32, Entry>,
    /// Asked once. The second ask earns a slot.
    seen: HashSet<u32>,
    /// In flight, so concurrent sessions asking one frame read it once.
    filling: HashSet<u32>,
    bytes: usize,
    clock: u64,
    spare: Vec<BytesMut>,
}

pub struct FrameCache {
    budget: usize,
    inner: Mutex<Inner>,
}

impl FrameCache {
    /// A hard ceiling on resident frame bytes; zero disables every path here.
    pub fn new(budget: usize) -> Self {
        Self {
            budget,
            inner: Mutex::new(Inner::default()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.budget > 0
    }

    /// A hit is a refcount bump — no syscall, no copy.
    pub fn get(&self, index: u32) -> Option<Bytes> {
        if !self.enabled() {
            return None;
        }
        let mut inner = self.inner.lock().ok()?;
        inner.clock += 1;
        let clock = inner.clock;
        let entry = inner.resident.get_mut(&index)?;
        entry.last_used = clock;
        Some(entry.bytes.clone())
    }

    /// `true` when this caller owns the fill. A first ask only records the index, so one
    /// linear pass over a huge study cannot evict a working set that is being re-asked.
    pub fn claim_fill(&self, index: u32, len: usize) -> bool {
        if !self.enabled() || len > self.budget {
            return false;
        }
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        if inner.resident.contains_key(&index) || inner.filling.contains(&index) {
            return false;
        }
        if inner.seen.len() >= MAX_SEEN {
            inner.seen.clear();
        }
        if inner.seen.insert(index) {
            return false; // first sight: record it, cache nothing
        }
        inner.filling.insert(index);
        true
    }

    /// Empty, with capacity for at least `len`. A caller that fills fewer bytes than it
    /// asked for must not admit the result.
    pub fn assembly_buffer(&self, len: usize) -> BytesMut {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(pos) = inner.spare.iter().position(|b| b.capacity() >= len) {
                let mut buf = inner.spare.swap_remove(pos);
                buf.clear();
                return buf;
            }
        }
        BytesMut::with_capacity(len)
    }

    /// Evicts least-recently-used entries to stay inside budget.
    pub fn admit(&self, index: u32, bytes: Bytes) {
        if !self.enabled() {
            return;
        }
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.filling.remove(&index);
        let len = bytes.len();
        if len > self.budget || inner.resident.contains_key(&index) {
            return;
        }
        while inner.bytes + len > self.budget {
            let Some(victim) = inner
                .resident
                .iter()
                .min_by_key(|(_, e)| e.last_used)
                .map(|(k, _)| *k)
            else {
                return; // budget smaller than this frame, and nothing left to evict
            };
            if let Some(e) = inner.resident.remove(&victim) {
                inner.bytes -= e.bytes.len();
                // Nobody is still streaming it → keep the allocation for the next fill.
                if inner.spare.len() < MAX_SPARE {
                    if let Ok(buf) = e.bytes.try_into_mut() {
                        inner.spare.push(buf);
                    }
                }
            }
        }
        inner.clock += 1;
        let last_used = inner.clock;
        inner.bytes += len;
        inner.resident.insert(index, Entry { bytes, last_used });
    }

    /// Releases the claim so a later ask can try again.
    pub fn abandon_fill(&self, index: u32) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.filling.remove(&index);
        }
    }

    /// Recycled buffers are not counted: they are the cache's own working memory.
    pub fn stats(&self) -> (usize, usize) {
        match self.inner.lock() {
            Ok(inner) => (inner.bytes, inner.resident.len()),
            Err(_) => (0, 0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(n: usize, fill: u8) -> Bytes {
        Bytes::from(vec![fill; n])
    }

    #[test]
    fn zero_budget_caches_nothing() {
        let c = FrameCache::new(0);
        assert!(!c.enabled());
        assert!(!c.claim_fill(1, 10));
        assert!(!c.claim_fill(1, 10));
        c.admit(1, frame(10, 1));
        assert!(c.get(1).is_none());
        assert_eq!(c.stats(), (0, 0));
    }

    #[test]
    fn a_frame_is_admitted_on_the_second_ask_not_the_first() {
        let c = FrameCache::new(1024);
        assert!(!c.claim_fill(4, 100), "first ask only records");
        assert!(c.claim_fill(4, 100), "second ask earns the slot");
        assert!(!c.claim_fill(4, 100), "fill already in flight");
        c.admit(4, frame(100, 9));
        assert_eq!(c.get(4).as_deref(), Some(&[9u8; 100][..]));
        assert!(!c.claim_fill(4, 100), "resident frames are not re-filled");
    }

    #[test]
    fn a_frame_larger_than_the_budget_is_never_admitted() {
        let c = FrameCache::new(64);
        assert!(!c.claim_fill(1, 65));
        assert!(!c.claim_fill(1, 65));
        c.admit(1, frame(65, 1));
        assert!(c.get(1).is_none());
        assert_eq!(c.stats().0, 0);
    }

    #[test]
    fn admission_evicts_least_recently_used_and_holds_the_budget() {
        let c = FrameCache::new(300);
        for idx in 0..3u32 {
            assert!(!c.claim_fill(idx, 100));
            assert!(c.claim_fill(idx, 100));
            c.admit(idx, frame(100, idx as u8));
        }
        assert_eq!(c.stats(), (300, 3));

        // Touch 0 and 2 so 1 is the coldest.
        assert!(c.get(0).is_some());
        assert!(c.get(2).is_some());

        assert!(!c.claim_fill(3, 100));
        assert!(c.claim_fill(3, 100));
        c.admit(3, frame(100, 3));

        assert_eq!(c.stats(), (300, 3), "budget held");
        assert!(c.get(1).is_none(), "coldest frame evicted");
        assert!(c.get(0).is_some());
        assert!(c.get(2).is_some());
        assert!(c.get(3).is_some());
    }

    #[test]
    fn an_abandoned_fill_can_be_retried() {
        let c = FrameCache::new(1024);
        assert!(!c.claim_fill(2, 10));
        assert!(c.claim_fill(2, 10));
        assert!(!c.claim_fill(2, 10), "claimed");
        c.abandon_fill(2);
        assert!(c.claim_fill(2, 10), "released");
    }

    #[test]
    fn eviction_recycles_the_allocation_for_the_next_fill() {
        let c = FrameCache::new(200);
        for idx in 0..2u32 {
            assert!(!c.claim_fill(idx, 100));
            assert!(c.claim_fill(idx, 100));
            let mut buf = c.assembly_buffer(100);
            buf.extend_from_slice(&[idx as u8; 100]);
            c.admit(idx, buf.freeze());
        }
        let before = c.inner.lock().unwrap().spare.len();
        assert_eq!(before, 0, "nothing evicted yet");

        assert!(!c.claim_fill(9, 100));
        assert!(c.claim_fill(9, 100));
        let mut buf = c.assembly_buffer(100);
        assert!(buf.capacity() >= 100);
        buf.extend_from_slice(&[9u8; 100]);
        c.admit(9, buf.freeze());

        assert_eq!(
            c.inner.lock().unwrap().spare.len(),
            1,
            "the evicted frame's allocation was kept"
        );
        // And the next assembly reuses it rather than allocating.
        let reused = c.assembly_buffer(100);
        assert!(reused.is_empty() && reused.capacity() >= 100);
        assert_eq!(c.inner.lock().unwrap().spare.len(), 0);
    }

    /// A frame still on the wire must not be recycled underneath the connection.
    #[test]
    fn an_evicted_frame_still_in_flight_is_not_recycled() {
        let c = FrameCache::new(100);
        assert!(!c.claim_fill(1, 100));
        assert!(c.claim_fill(1, 100));
        c.admit(1, frame(100, 1));
        let in_flight = c.get(1).expect("resident");

        assert!(!c.claim_fill(2, 100));
        assert!(c.claim_fill(2, 100));
        c.admit(2, frame(100, 2));

        assert!(c.get(1).is_none(), "evicted");
        assert_eq!(c.inner.lock().unwrap().spare.len(), 0, "still referenced");
        assert_eq!(in_flight.len(), 100, "the in-flight bytes are untouched");
        assert!(in_flight.iter().all(|b| *b == 1));
    }

    #[test]
    fn admission_history_is_bounded() {
        let c = FrameCache::new(1 << 20);
        for i in 0..(MAX_SEEN as u32 + 10) {
            c.claim_fill(i, 8);
        }
        let inner = c.inner.lock().unwrap();
        assert!(
            inner.seen.len() <= MAX_SEEN,
            "seen grew to {}",
            inner.seen.len()
        );
    }
}
