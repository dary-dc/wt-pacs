//! Bounded, process-private frame cache — **a lab variant**; nothing in `server/` uses it. A
//! byte budget with LRU eviction, admission by [`Admit`], and fills from bytes the caller
//! already holds. What it is worth: `docs/adr/disk-access.md` §13.

use bytes::{Bytes, BytesMut};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// Bounded too: remembering every index asked once is a slow leak on a large series.
const MAX_SEEN: usize = 1 << 16;

/// Recycled so a churning cache does not pay a minor fault per page on every admission.
const MAX_SPARE: usize = 8;

/// What earns a frame its slot, past the first ask.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Admit {
    SecondAsk,
    /// An ask from a session other than the first asker's; a session's own repeat earns nothing.
    SecondSession,
}

struct Entry {
    bytes: Bytes,
    last_used: u64,
}

#[derive(Default)]
struct Inner {
    resident: HashMap<u32, Entry>,
    /// Asked once, and by which session.
    seen: HashMap<u32, u64>,
    /// In flight, so concurrent sessions asking one frame read it once.
    filling: HashSet<u32>,
    bytes: usize,
    clock: u64,
    spare: Vec<BytesMut>,
}

pub struct FrameCache {
    budget: usize,
    admit: Admit,
    inner: Mutex<Inner>,
}

impl FrameCache {
    /// A hard ceiling on resident frame bytes; zero disables every path here.
    pub fn new(budget: usize, admit: Admit) -> Self {
        Self {
            budget,
            admit,
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

    /// `true` when `session` owns the fill. A first ask only records the index, so one
    /// linear pass over a huge series cannot evict a working set that is being re-asked.
    pub fn claim_fill(&self, index: u32, len: usize, session: u64) -> bool {
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
        match inner.seen.get(&index) {
            None => {
                inner.seen.insert(index, session);
                return false; // first sight: record it, cache nothing
            }
            Some(&first) if self.admit == Admit::SecondSession && first == session => return false,
            Some(_) => {}
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
        let c = FrameCache::new(0, Admit::SecondAsk);
        assert!(!c.enabled());
        assert!(!c.claim_fill(1, 10, 1));
        assert!(!c.claim_fill(1, 10, 1));
        c.admit(1, frame(10, 1));
        assert!(c.get(1).is_none());
        assert_eq!(c.stats(), (0, 0));
    }

    /// B1: the second ask earns the slot, though one session made both.
    #[test]
    fn a_frame_is_admitted_on_the_second_ask_not_the_first() {
        let c = FrameCache::new(1024, Admit::SecondAsk);
        assert!(!c.claim_fill(4, 100, 1), "first ask only records");
        assert!(c.claim_fill(4, 100, 1), "second ask earns the slot");
        assert!(!c.claim_fill(4, 100, 1), "fill already in flight");
        c.admit(4, frame(100, 9));
        assert_eq!(c.get(4).as_deref(), Some(&[9u8; 100][..]));
        assert!(
            !c.claim_fill(4, 100, 1),
            "resident frames are not re-filled"
        );
    }

    /// B1s: however often one session repeats an ask, the frame stays out.
    #[test]
    fn a_sessions_own_repeat_admits_nothing() {
        let c = FrameCache::new(1024, Admit::SecondSession);
        for _ in 0..3 {
            assert!(!c.claim_fill(4, 100, 7), "a repeat by the first asker");
        }
        assert!(c.get(4).is_none());
        assert_eq!(c.stats(), (0, 0));
    }

    /// B1s: the first ask from a second session earns the slot, after any number of the
    /// first session's repeats, and only once.
    #[test]
    fn a_second_sessions_ask_admits_the_frame() {
        let c = FrameCache::new(1024, Admit::SecondSession);
        assert!(!c.claim_fill(4, 100, 7), "first ask only records");
        assert!(!c.claim_fill(4, 100, 7), "the first asker's repeat");
        assert!(
            c.claim_fill(4, 100, 8),
            "another session's ask earns the slot"
        );
        assert!(!c.claim_fill(4, 100, 9), "fill already in flight");
        c.admit(4, frame(100, 9));
        assert_eq!(c.get(4).as_deref(), Some(&[9u8; 100][..]));
    }

    #[test]
    fn a_frame_larger_than_the_budget_is_never_admitted() {
        let c = FrameCache::new(64, Admit::SecondAsk);
        assert!(!c.claim_fill(1, 65, 1));
        assert!(!c.claim_fill(1, 65, 1));
        c.admit(1, frame(65, 1));
        assert!(c.get(1).is_none());
        assert_eq!(c.stats().0, 0);
    }

    #[test]
    fn admission_evicts_least_recently_used_and_holds_the_budget() {
        let c = FrameCache::new(300, Admit::SecondAsk);
        for idx in 0..3u32 {
            assert!(!c.claim_fill(idx, 100, 1));
            assert!(c.claim_fill(idx, 100, 1));
            c.admit(idx, frame(100, idx as u8));
        }
        assert_eq!(c.stats(), (300, 3));

        // Touch 0 and 2 so 1 is the coldest.
        assert!(c.get(0).is_some());
        assert!(c.get(2).is_some());

        assert!(!c.claim_fill(3, 100, 1));
        assert!(c.claim_fill(3, 100, 1));
        c.admit(3, frame(100, 3));

        assert_eq!(c.stats(), (300, 3), "budget held");
        assert!(c.get(1).is_none(), "coldest frame evicted");
        assert!(c.get(0).is_some());
        assert!(c.get(2).is_some());
        assert!(c.get(3).is_some());
    }

    #[test]
    fn an_abandoned_fill_can_be_retried() {
        let c = FrameCache::new(1024, Admit::SecondAsk);
        assert!(!c.claim_fill(2, 10, 1));
        assert!(c.claim_fill(2, 10, 1));
        assert!(!c.claim_fill(2, 10, 1), "claimed");
        c.abandon_fill(2);
        assert!(c.claim_fill(2, 10, 1), "released");
    }

    #[test]
    fn eviction_recycles_the_allocation_for_the_next_fill() {
        let c = FrameCache::new(200, Admit::SecondAsk);
        for idx in 0..2u32 {
            assert!(!c.claim_fill(idx, 100, 1));
            assert!(c.claim_fill(idx, 100, 1));
            let mut buf = c.assembly_buffer(100);
            buf.extend_from_slice(&[idx as u8; 100]);
            c.admit(idx, buf.freeze());
        }
        let before = c.inner.lock().unwrap().spare.len();
        assert_eq!(before, 0, "nothing evicted yet");

        assert!(!c.claim_fill(9, 100, 1));
        assert!(c.claim_fill(9, 100, 1));
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
        let c = FrameCache::new(100, Admit::SecondAsk);
        assert!(!c.claim_fill(1, 100, 1));
        assert!(c.claim_fill(1, 100, 1));
        c.admit(1, frame(100, 1));
        let in_flight = c.get(1).expect("resident");

        assert!(!c.claim_fill(2, 100, 1));
        assert!(c.claim_fill(2, 100, 1));
        c.admit(2, frame(100, 2));

        assert!(c.get(1).is_none(), "evicted");
        assert_eq!(c.inner.lock().unwrap().spare.len(), 0, "still referenced");
        assert_eq!(in_flight.len(), 100, "the in-flight bytes are untouched");
        assert!(in_flight.iter().all(|b| *b == 1));
    }

    #[test]
    fn admission_history_is_bounded() {
        let c = FrameCache::new(1 << 20, Admit::SecondAsk);
        for i in 0..(MAX_SEEN as u32 + 10) {
            c.claim_fill(i, 8, 1);
        }
        let inner = c.inner.lock().unwrap();
        assert!(
            inner.seen.len() <= MAX_SEEN,
            "seen grew to {}",
            inner.seen.len()
        );
    }
}
