//! Bounded, process-private frame cache — **a lab arm, not product code**.
//!
//! `docs/disk-access/adr.md` decided *how* to bring frame bytes in; this measures *whether
//! bringing them in again is worth avoiding*. On the wire the whole read path (four
//! `preadv2` calls plus the copy into the connection) is ~19% of a frame's server CPU — see
//! `docs/disk-access/SEND-BUDGET.md`. A hit removes all of it: no syscall, no copy into
//! quinn, no pool hop, and the bytes are already process-private, which is the guarantee
//! the ADR streams windows to obtain.
//!
//! It lives here because a client that caches every increment it receives sends each frame
//! once per user (`later.md`), which leaves this paying only where several users read one
//! study at once — a case no cell here has measured. Nothing in `server/` depends on it.
//!
//! Three properties keep it safe on a study that exceeds RAM:
//!
//! * **Bounded.** A byte budget, enforced on admission by LRU eviction. Zero disables it.
//! * **Admission on the second ask.** A single linear pass over a huge study never
//!   populates the cache; a cine loop or a scrub — where the same frames are asked over and
//!   over — populates it immediately.
//! * **Filled from bytes already in hand.** The ask that earns a slot assembles the frame
//!   from the windows it is streaming anyway — one extra copy, no extra read, no pool hop,
//!   and evicted allocations are recycled so the copy does not drag page faults with it.

use bytes::{Bytes, BytesMut};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// Admission history is bounded too: a study can have far more frames than the cache can
/// ever hold, and remembering every index asked once is a slow leak. Clearing it costs at
/// most one extra ask before a hot frame is admitted again.
const MAX_SEEN: usize = 1 << 16;

/// Evicted allocations kept for the next admission. A cached frame has to own its memory,
/// and fresh anonymous memory costs a minor fault per page on first touch — ~61 of them
/// for a 250 KB frame, which is more than the copy that fills it. Recycling evicted
/// buffers keeps those pages mapped, so a cache that is churning does not pay for new
/// memory on every admission.
const MAX_SPARE: usize = 8;

struct Entry {
    bytes: Bytes,
    last_used: u64,
}

#[derive(Default)]
struct Inner {
    resident: HashMap<u32, Entry>,
    /// Asked at least once. Second ask is what earns a slot.
    seen: HashSet<u32>,
    /// Fills in flight, so concurrent sessions asking the same frame read it once.
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
    /// `budget` is a hard ceiling on resident frame bytes. Zero disables every path here.
    pub fn new(budget: usize) -> Self {
        Self {
            budget,
            inner: Mutex::new(Inner::default()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.budget > 0
    }

    /// Frame bytes if resident. A hit is a refcount bump — no syscall, no copy.
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

    /// `true` when this ask earned `index` a slot and this caller owns the fill.
    ///
    /// The first ask for a frame only records it. That is what keeps one linear pass over a
    /// study larger than the budget from evicting a working set that is actually being
    /// re-asked.
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

    /// A buffer to assemble a frame into — an evicted allocation where one is free.
    ///
    /// Returned buffers are empty with capacity for at least `len`; a caller that fills
    /// fewer bytes than it asked for must not admit the result.
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

    /// Store a filled frame, evicting least-recently-used entries to stay inside budget.
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

    /// A fill that failed: release the claim so a later ask can try again.
    pub fn abandon_fill(&self, index: u32) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.filling.remove(&index);
        }
    }

    /// Resident bytes and frame count — for logs and tests, not for the serving path.
    ///
    /// Recycled buffers are not counted: they are the cache's own working memory, bounded
    /// by `MAX_SPARE` frames.
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
