//! Frame buffers handed to quinn whole and reclaimed when it drops them after acknowledgement,
//! so a frame is copied once (page cache → buffer), not twice. `docs/disk-access/adr.md` §5.

use bytes::Bytes;
use std::cell::RefCell;
use std::mem;

/// Buffers kept per thread; a per-core runtime drops on the thread that read.
const POOL_CAP: usize = 64;

thread_local! {
    static POOL: RefCell<Vec<Vec<u8>>> = const { RefCell::new(Vec::new()) };
}

/// A buffer to read the next frame into: one quinn gave back, or a new one.
pub fn take() -> Vec<u8> {
    POOL.with(|pool| pool.borrow_mut().pop()).unwrap_or_default()
}

/// The first `len` bytes of `buf` as the frame quinn will send; `buf` returns to the pool
/// when quinn drops the last view of it.
pub fn hand_off(buf: Vec<u8>, len: usize) -> Bytes {
    Bytes::from_owner(Pooled(buf)).slice(..len)
}

#[cfg(test)]
pub(crate) fn pooled() -> usize {
    POOL.with(|pool| pool.borrow().len())
}

struct Pooled(Vec<u8>);

impl AsRef<[u8]> for Pooled {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for Pooled {
    fn drop(&mut self) {
        let buf = mem::take(&mut self.0);
        POOL.with(|pool| {
            let mut pool = pool.borrow_mut();
            if pool.len() < POOL_CAP {
                pool.push(buf);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **Zero copy, then reuse.** The bytes quinn sees are the buffer that was read into, and
    /// dropping them puts that buffer back for the next read.
    #[test]
    fn a_handed_off_frame_is_the_buffer_itself_and_comes_back_when_dropped() {
        let mut buf = take();
        buf.resize(1000, 7);
        let ptr = buf.as_ptr();
        let before = pooled();
        let frame = hand_off(buf, 600);
        assert_eq!(frame.len(), 600);
        assert_eq!(frame.as_ptr(), ptr, "the frame was copied on hand-off");
        assert_eq!(pooled(), before, "the buffer came back while quinn still held it");
        drop(frame);
        assert_eq!(pooled(), before + 1, "the buffer did not come back when quinn dropped it");
        let again = take();
        assert_eq!(again.as_ptr(), ptr, "take() did not reuse the returned buffer");
    }
}
