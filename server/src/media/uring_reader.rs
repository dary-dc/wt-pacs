//! io_uring for the miss path only; a page-cache hit is served inline.
//!
//! Two constraints are easy to undo by accident: tokio migrates a task between workers, so
//! `SINGLE_ISSUER` and `DEFER_TASKRUN` are unusable, and blocking in `io_uring_enter` would
//! be the stall this exists to prevent. `docs/adr/disk-access.md`.

use anyhow::{anyhow, Context, Result};
use io_uring::{opcode, types, IoUring};
use std::fs::File;
use std::os::fd::{AsRawFd, RawFd};
use tokio::io::unix::AsyncFd;
use tokio::io::Interest;

pub struct UringReader {
    /// Declared before `ring`, so it leaves the reactor before the ring's fd closes.
    ring_fd: AsyncFd<RawFd>,
    ring: IoUring,
    in_flight: usize,
}

impl UringReader {
    /// Registers `file`, so a submission does not have to resolve it.
    pub fn new(file: &File, entries: u32) -> Result<Self> {
        let ring = IoUring::builder()
            .setup_coop_taskrun()
            .build(entries)
            .context("io_uring setup")?;
        ring.submitter()
            .register_files(&[file.as_raw_fd()])
            .context("register_files")?;
        // SAFETY: `ring` owns this fd, is never replaced, and drops after `ring_fd` (field order).
        let ring_fd =
            unsafe { AsyncFd::register_with_interest(ring.as_raw_fd(), Interest::READABLE) }
                .context("AsyncFd(ring)")?;
        Ok(Self {
            ring_fd,
            ring,
            in_flight: 0,
        })
    }

    /// # Safety
    /// `buf` stays valid, unmoved and unaliased until `reap` reports `slot` or `drain_in_flight`
    /// returns true; once it has returned false, for ever.
    pub(crate) unsafe fn submit(&mut self, slot: usize, buf: &mut [u8], offset: u64) -> Result<()> {
        let entry = opcode::Read::new(types::Fixed(0), buf.as_mut_ptr(), buf.len() as u32)
            .offset(offset)
            .build()
            .user_data(slot as u64);
        unsafe { self.ring.submission().push(&entry) }
            .map_err(|_| anyhow!("io_uring SQ full"))?;
        // Counted once queued: a failed `submit` leaves the entry for the next one to send.
        self.in_flight += 1;
        self.submit_and_wait(0).context("io_uring submit")?;
        Ok(())
    }

    /// Every completion landed so far: `(slot, bytes)`, a failed read among them. A short read is
    /// the caller's to resubmit.
    pub(crate) fn reap(&mut self) -> Vec<(usize, Result<usize>)> {
        self.ring.completion().sync();
        let mut landed = Vec::new();
        for cqe in self.ring.completion() {
            self.in_flight = self.in_flight.saturating_sub(1);
            let read = match cqe.result() {
                n if n > 0 => Ok(n as usize),
                0 => Err(anyhow!("io_uring read hit EOF")),
                e => Err(std::io::Error::from_raw_os_error(-e)).context("io_uring read"),
            };
            landed.push((cqe.user_data() as usize, read));
        }
        landed
    }

    /// Park on the ring's own fd, never waiting in `io_uring_enter`. A wake may carry nothing.
    pub(crate) async fn park(&mut self) -> Result<()> {
        // An entry a failed submit left queued reaches the kernel only on the next entry into it.
        if !self.ring.submission().is_empty() {
            self.submit_and_wait(0).context("io_uring resubmit")?;
        }
        let mut guard = self.ring_fd.readable().await.context("ring fd readable")?;
        guard.clear_ready();
        Ok(())
    }

    /// The one place this file blocks; the alternative is a use-after-free. False when the ring
    /// failed with reads still in flight: their buffers must then be leaked, never freed.
    #[must_use]
    pub(crate) fn drain_in_flight(&mut self) -> bool {
        if self.in_flight == 0 {
            return true;
        }
        #[cfg(test)]
        DRAINED_ON_DROP.set(DRAINED_ON_DROP.get() + 1);
        while self.in_flight > 0 {
            match self.submit_and_wait(self.in_flight) {
                Ok(_) => {}
                // Interrupted, or the CQ overflowed, which the reap below clears.
                Err(e) if matches!(e.raw_os_error(), Some(libc::EINTR | libc::EBUSY)) => {}
                Err(_) => return false,
            }
            let landed = self.ring.completion().count();
            self.in_flight = self.in_flight.saturating_sub(landed);
        }
        true
    }

    fn submit_and_wait(&mut self, want: usize) -> std::io::Result<usize> {
        #[cfg(test)]
        injected_failure()?;
        self.ring.submitter().submit_and_wait(want)
    }
}

impl Drop for UringReader {
    fn drop(&mut self) {
        let _ = self.drain_in_flight();
    }
}

#[cfg(test)]
thread_local! {
    /// The wait is otherwise unobservable, since a cached read lands before it.
    pub(crate) static DRAINED_ON_DROP: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    /// Errnos the next submits and waits on this thread return instead of entering.
    pub(crate) static FAILED_WAITS: std::cell::RefCell<Vec<i32>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// The next errno a test queued in `FAILED_WAITS`, as the kernel's own answer.
#[cfg(test)]
fn injected_failure() -> std::io::Result<()> {
    match FAILED_WAITS.with(|f| f.borrow_mut().pop()) {
        Some(errno) => Err(std::io::Error::from_raw_os_error(errno)),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests;
