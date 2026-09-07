//! io_uring for the miss path, and only the miss path.
//!
//! A page-cache hit never reaches here — it is served inline, and faster than a ring read
//! would serve it. What the ring removes is the thread-pool round trip a *miss* would
//! otherwise pay. The measurements, and why the buffers are deliberately not registered:
//! `docs/disk-access/IMPLEMENTATION.md`.
//!
//! Two constraints explain why this looks nothing like a typical io_uring example:
//!
//! * **`SINGLE_ISSUER` and `DEFER_TASKRUN` are unusable.** Tokio migrates a task between
//!   workers across `.await`, so a per-session ring sees submissions from several threads.
//! * **Completions are awaited, never waited on.** Blocking in `io_uring_enter` would be
//!   the executor stall this whole design exists to prevent, so the ring registers an
//!   eventfd and parks on it.

use anyhow::{bail, Context, Result};
use io_uring::{opcode, types, IoUring};
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use tokio::io::unix::AsyncFd;

/// How many drops had to wait for the kernel.
///
/// Test-only, and the only way the wait is observable: a read served from the page cache
/// lands before a missing wait could be noticed.
#[cfg(test)]
pub(crate) static DRAINED_ON_DROP: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// One session's ring. Exactly one read is ever in flight: the session loop serves a frame
/// to completion before reading the next ask, so there is no deeper queue to fill.
pub struct UringReader {
    ring: IoUring,
    eventfd: AsyncFd<OwnedFd>,
    in_flight: bool,
}

impl UringReader {
    /// Register `file` with the ring so submissions do not have to resolve it each time.
    pub fn new(file: &File) -> Result<Self> {
        // Eight entries is the smallest the kernel will round to and seven more than this
        // ever needs; the SQ is not where the memory goes.
        let ring = IoUring::builder()
            .setup_coop_taskrun()
            .build(8)
            .context("io_uring setup")?;
        ring.submitter()
            .register_files(&[file.as_raw_fd()])
            .context("register_files")?;

        // SAFETY: `eventfd` returns an owned fd or -1.
        let raw: RawFd = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
        if raw < 0 {
            return Err(std::io::Error::last_os_error()).context("eventfd");
        }
        // SAFETY: `raw` is a fresh fd owned by nobody else.
        let owned = unsafe { OwnedFd::from_raw_fd(raw) };
        ring.submitter()
            .register_eventfd(owned.as_raw_fd())
            .context("register_eventfd")?;

        Ok(Self {
            ring,
            eventfd: AsyncFd::new(owned).context("AsyncFd(eventfd)")?,
            in_flight: false,
        })
    }

    /// Read `buf.len()` bytes at `offset`, re-submitting until the range is complete.
    ///
    /// **Cancel-safe.** Dropping this future mid-read is safe because `Drop` waits for the
    /// kernel to finish with `buf` — so a caller that owns `buf` beyond this call must drop
    /// the reader before the buffer.
    pub async fn read_exact_at(&mut self, buf: &mut [u8], offset: u64) -> Result<()> {
        let mut done = 0usize;
        while done < buf.len() {
            // SAFETY: `done <= buf.len()`, so the pointer is inside `buf`. `buf` is
            // exclusively borrowed for the whole call, and the kernel's window on it ends
            // before the borrow does: either `complete` reaps the CQE, or — if this future
            // is dropped first — `Drop` waits for it.
            let n = unsafe {
                self.submit_at(
                    buf.as_mut_ptr().add(done),
                    buf.len() - done,
                    offset + done as u64,
                )
            };
            n?;
            let got = self.complete().await?;
            if got == 0 {
                bail!(
                    "io_uring read hit EOF {done} of {} bytes into the frame at {offset}",
                    buf.len()
                );
            }
            done += got;
        }
        Ok(())
    }

    /// Submit a read and do not complete it, leaving the kernel mid-write — the state
    /// `Drop` exists for, without racing a task abort to reach it.
    ///
    /// # Safety
    /// Same contract as [`read_exact_at`](Self::read_exact_at): `buf` must outlive this
    /// reader, because only the reader's `Drop` ends the kernel's window on it.
    #[cfg(test)]
    pub(crate) unsafe fn submit_without_completing(
        &mut self,
        buf: &mut [u8],
        offset: u64,
    ) -> Result<()> {
        // SAFETY: forwarded to the caller by this function's own contract.
        unsafe { self.submit_at(buf.as_mut_ptr(), buf.len(), offset) }
    }

    /// Queue one read and hand it to the kernel.
    ///
    /// # Safety
    /// `ptr` must be valid for writes of `len` bytes, and must stay valid and unaliased
    /// until the matching [`complete`](Self::complete) returns.
    unsafe fn submit_at(&mut self, ptr: *mut u8, len: usize, offset: u64) -> Result<()> {
        debug_assert!(!self.in_flight, "submitted with a read already in flight");
        let entry = opcode::Read::new(types::Fixed(0), ptr, len as u32)
            .offset(offset)
            .build()
            .user_data(0);
        // SAFETY: the caller's contract above keeps the buffer alive and unaliased until
        // the completion is reaped.
        self.ring
            .submission()
            .push(&entry)
            .map_err(|_| anyhow::anyhow!("io_uring SQ full"))?;
        self.in_flight = true;
        self.ring.submit().context("io_uring submit")?;
        Ok(())
    }

    /// Await the outstanding read and return how many bytes it produced. A read already in
    /// the completion queue takes no await at all.
    async fn complete(&mut self) -> Result<usize> {
        loop {
            self.ring.completion().sync();
            if let Some(cqe) = self.ring.completion().next() {
                self.in_flight = false;
                if cqe.result() < 0 {
                    let e = std::io::Error::from_raw_os_error(-cqe.result());
                    return Err(e).context("io_uring read");
                }
                return Ok(cqe.result() as usize);
            }
            self.park().await?;
        }
    }

    /// Park on the registered eventfd rather than blocking in `io_uring_enter`.
    async fn park(&mut self) -> Result<()> {
        let mut guard = self
            .eventfd
            .readable_mut()
            .await
            .context("eventfd readable")?;
        let _ = guard.try_io(|inner| {
            let mut sink = [0u8; 8];
            // SAFETY: an 8-byte read from an eventfd into a live local buffer.
            let n =
                unsafe { libc::read(inner.get_ref().as_raw_fd(), sink.as_mut_ptr() as *mut _, 8) };
            if n < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
        Ok(())
    }
}

impl UringReader {
    /// Wait for the kernel to finish with the caller's buffer.
    ///
    /// Without this, dropping the future between submit and completion leaves the kernel
    /// writing into memory about to be freed. Bounded by one device read, and only ever on
    /// the teardown path: a reader that completed its reads has nothing in flight.
    ///
    /// Idempotent, so an owner may call it early — [`ReadCtx`](crate::media::read_path)
    /// does, from its own `Drop`, so the guarantee does not depend on field order.
    pub(crate) fn drain_in_flight(&mut self) {
        if !self.in_flight {
            return;
        }
        #[cfg(test)]
        DRAINED_ON_DROP.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        // The one place this file blocks. The alternative is a use-after-free, and a hung
        // wait means a hung device, which has stalled everything else already.
        if self.ring.submitter().submit_and_wait(1).is_ok() {
            self.ring.completion().sync();
            while self.ring.completion().next().is_some() {}
        }
        self.in_flight = false;
    }
}

impl Drop for UringReader {
    fn drop(&mut self) {
        self.drain_in_flight();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// **The cancellation hazard, deterministically.** A session dropped between submit and
    /// completion must not leave the kernel writing into memory that is about to be freed.
    ///
    /// Racing a `task.abort()` cannot test this reliably — and an earlier attempt did not
    /// even terminate, because a ring read that completes inline never reaches a yield point
    /// for the abort to land on. So the mid-flight state is built directly instead.
    ///
    /// Without a sanitiser this cannot *prove* the absence of a use-after-free — a read
    /// served from the page cache lands before anything could observe the missing wait. So
    /// the wait is made observable instead: [`DRAINED_ON_DROP`] counts the drops that had to
    /// perform one, and this asserts the count moved. Under
    /// `RUSTFLAGS="-Zsanitizer=address"` on nightly it becomes a memory check as well.
    #[test]
    fn dropping_a_reader_mid_read_waits_for_the_kernel() {
        let dir = std::env::temp_dir().join(format!("wtpacs-ring-drop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let path = dir.join("blob");
        let body: Vec<u8> = (0..64u32 * 1024).map(|i| (i % 251) as u8).collect();
        {
            let mut f = std::fs::File::create(&path).expect("create");
            f.write_all(&body).unwrap();
            f.sync_all().unwrap();
        }
        let file = std::fs::File::open(&path).expect("open");

        // `AsyncFd` needs a reactor, and so does dropping one — the guard covers both.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt");
        let _guard = rt.enter();

        let Ok(mut reader) = UringReader::new(&file) else {
            eprintln!("skipped: io_uring is unavailable on this host");
            std::fs::remove_dir_all(&dir).ok();
            return;
        };
        // `buf` is declared before `reader` in this scope, so it drops *after* it — the
        // same ordering `ReadCtx` gets by field declaration order, and the ordering that
        // makes `Drop`'s wait meaningful.
        let mut buf = vec![0u8; body.len()];
        // SAFETY: `buf` outlives `reader`, which is what this function's contract requires.
        unsafe { reader.submit_without_completing(&mut buf, 0) }.expect("submit");
        assert!(reader.in_flight, "the read was not left in flight");

        let before = DRAINED_ON_DROP.load(std::sync::atomic::Ordering::SeqCst);
        // The wait happens here. If it hangs or panics, this test does not finish.
        drop(reader);
        assert_eq!(
            DRAINED_ON_DROP.load(std::sync::atomic::Ordering::SeqCst),
            before + 1,
            "Drop returned without waiting for the outstanding read"
        );
        assert_eq!(
            buf, body,
            "the kernel's write did not land before the wait returned"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
