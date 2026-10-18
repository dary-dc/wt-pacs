//! Frame buffers handed to quinn whole and reclaimed when it drops them after acknowledgement,
//! so a frame is copied once (page cache → buffer), not twice. `docs/adr/disk-access.md` §5.

use bytes::Bytes;
use std::mem;
use std::sync::{Mutex, MutexGuard};

/// Buffers kept in hand. The pool is shared across the runtime's workers, not thread-local:
/// tokio may drop a frame on a thread other than the one that read it.
const POOL_CAP: usize = 64;

/// The process's frame buffers. A test that counts them makes its own.
struct Pool(Mutex<Vec<Vec<u8>>>);

static POOL: Pool = Pool::new();

#[cfg(test)]
thread_local! {
    /// Test-only: buffers given back to a pool on this thread.
    pub(crate) static RETURNED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// A buffer to read the next frame into: one quinn gave back, or a new one.
pub fn take() -> Vec<u8> {
    POOL.take()
}

/// The first `len` bytes of `buf` as the frame quinn will send; `buf` returns to the pool
/// when quinn drops the last view of it.
pub fn hand_off(buf: Vec<u8>, len: usize) -> Bytes {
    POOL.hand_off(buf, len)
}

pub fn put_back(buf: Vec<u8>) {
    POOL.put_back(buf)
}

impl Pool {
    const fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }

    /// A poisoned pool holds nothing but spare buffers, so recovering beats failing a send.
    fn buffers(&self) -> MutexGuard<'_, Vec<Vec<u8>>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn take(&self) -> Vec<u8> {
        self.buffers().pop().unwrap_or_default()
    }

    fn hand_off(&'static self, buf: Vec<u8>, len: usize) -> Bytes {
        Bytes::from_owner(Pooled(buf, self)).slice(..len)
    }

    fn put_back(&self, buf: Vec<u8>) {
        if buf.capacity() == 0 {
            return;
        }
        #[cfg(test)]
        RETURNED.set(RETURNED.get() + 1);
        let mut pool = self.buffers();
        if pool.len() < POOL_CAP {
            pool.push(buf);
        }
    }

    #[cfg(test)]
    fn pooled(&self) -> usize {
        self.buffers().len()
    }
}

struct Pooled(Vec<u8>, &'static Pool);

impl AsRef<[u8]> for Pooled {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for Pooled {
    fn drop(&mut self) {
        self.1.put_back(mem::take(&mut self.0));
    }
}

#[cfg(test)]
mod tests;
