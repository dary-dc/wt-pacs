//! io_uring for the **miss** path, and only the miss path.
//!
//! A page-cache hit never touches this: it is served inline by `preadv2(RWF_NOWAIT)`, which
//! is measurably *faster* per operation than a ring read (561 ns against 852 ns on a warm
//! 4 KiB read, 5 of 5 runs — `docs/disk-access/adr.md`). What the ring removes is the
//! `spawn_blocking` round trip a miss otherwise pays, measured at **24–34 µs on four hosts**.
//!
//! Three constraints shape this, and they are why it looks nothing like a typical io_uring
//! example:
//!
//! * **`SINGLE_ISSUER` and `DEFER_TASKRUN` are unusable.** Tokio's multi-thread runtime
//!   migrates a task between workers across `.await`, so a per-session ring sees submissions
//!   from different threads. Those are io_uring's two biggest throughput knobs, and a
//!   work-stealing runtime cannot have them. `COOP_TASKRUN` is kept.
//! * **Completions are awaited, never waited on.** Blocking in `io_uring_enter` would
//!   reintroduce exactly the executor stall this whole decision exists to prevent, so the
//!   ring registers an eventfd and parks on it through Tokio's `AsyncFd`.
//! * **Buffers are not registered.** The measured arm registered them; this registers the
//!   *file* only and reads into the session's own window. Registering buffers pins pages,
//!   and at thousands of concurrent sessions that is thousands of unreclaimable
//!   frame-sized allocations against `RLIMIT_MEMLOCK`. The difference lives in the
//!   submission path (sub-microsecond) and not the device path (~105 µs for a 64 KiB random
//!   read on the validation host), so it cannot move a miss-path result — but it is
//!   **unmeasured**, and `docs/disk-access/IMPLEMENTATION.md` says to confirm it when the
//!   bench next runs the product path as an arm.
//!
//! ## Cancellation
//!
//! The kernel writes into the caller's buffer between submit and completion, so dropping
//! the future in between would hand the kernel freed memory. Session tasks are
//! `tokio::spawn`ed and are dropped at their await point when the runtime shuts down, so
//! this is reachable, not theoretical — and it is the kind of bug that compiles silently
//! and corrupts memory later. [`UringReader`] therefore drains any in-flight read in
//! `Drop`, which is what makes the `unsafe` in [`read_exact_at`](UringReader::read_exact_at)
//! sound. See the note on field order in [`crate::media::read_path::ReadCtx`]: the ring must
//! be dropped **before** the buffer it is writing into.

use anyhow::{bail, Context, Result};
use io_uring::{opcode, types, IoUring};
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use tokio::io::unix::AsyncFd;

/// How many drops had to wait for the kernel. Test-only: the wait is not otherwise
/// observable, because a read that completes from the page cache lands before anything
/// could notice it had not been waited for.
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
    /// Build a ring against `file`, registering the descriptor so submissions do not have
    /// to resolve it each time.
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

    /// Read `buf.len()` bytes at `offset` into `buf`, awaiting the completion.
    ///
    /// Short completions are re-submitted rather than reported: a caller finishing a frame
    /// needs the whole range, and the loop here is the same one `read_at_blocking` runs for
    /// the pooled path.
    ///
    /// **Cancel-safe.** If this future is dropped mid-read, `Drop` waits for the kernel to
    /// finish with `buf` before the reader goes away — so a caller that owns `buf` beyond
    /// this call must also drop the reader first. See the module header.
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

    /// Submit a read and **do not** complete it, leaving the kernel mid-write.
    ///
    /// The only way to construct the state `Drop` exists for without racing a task abort.
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

    /// Await the outstanding read and return how many bytes it produced.
    ///
    /// A cached read is often already in the completion queue by the time this is called,
    /// in which case it takes no await at all — the ring costs a park only when the read
    /// really did go to the device.
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

    /// Park on the registered eventfd. Never blocks in `io_uring_enter` — doing that would
    /// reintroduce the executor stall this exists to prevent.
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
    /// Without this, dropping the future between submit and completion — which happens
    /// whenever a session task is dropped at its await point — leaves the kernel writing
    /// into memory that is about to be freed. The wait is bounded by one device read, and
    /// it only ever runs on the teardown path: a reader whose reads all completed normally
    /// has nothing in flight and returns immediately.
    ///
    /// Idempotent, so the owner may call it early — [`ReadCtx`](crate::media::read_path)
    /// does, from its own `Drop`, so that the guarantee does not depend on field order.
    pub(crate) fn drain_in_flight(&mut self) {
        if !self.in_flight {
            return;
        }
        #[cfg(test)]
        DRAINED_ON_DROP.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        // Blocking here is the one place this file permits it. The alternative is a
        // use-after-free, and a hung wait means a hung device, which has stalled everything
        // else already.
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
