//! io_uring for the miss path, and only the miss path — a page-cache hit is served inline.
//!
//! Two constraints shape this and are easy to undo by accident: tokio migrates a task
//! between workers across `.await`, so `SINGLE_ISSUER` and `DEFER_TASKRUN` are unusable; and
//! blocking in `io_uring_enter` would be the executor stall the design exists to prevent, so
//! completions are awaited on a registered eventfd. `docs/disk-access/IMPLEMENTATION.md`.

use anyhow::{bail, Context, Result};
use io_uring::{opcode, types, IoUring};
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use tokio::io::unix::AsyncFd;

/// Counts the drops that had to wait for the kernel — the only way that wait is observable.
#[cfg(test)]
pub(crate) static DRAINED_ON_DROP: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// Reads a session may have in flight at once: the frame being served, and the one being
/// read ahead. Two, not *n* — `docs/adr-frame-framing-and-loop-shape.md` §Serving depth.
pub const SLOTS: usize = 2;

/// A submitted read: the range the kernel is writing into, and how much of it is done.
///
/// The buffer is held as an address rather than a pointer so the reader stays `Send` — the
/// session task owning both may move between workers. What keeps the address valid is the
/// caller's contract on [`UringReader::start`], not its type.
struct Pending {
    addr: usize,
    len: usize,
    done: usize,
    offset: u64,
    /// The kernel owns `addr + done .. addr + len` right now.
    submitted: bool,
}

/// One session's ring, carrying at most [`SLOTS`] reads at a time.
pub struct UringReader {
    ring: IoUring,
    eventfd: AsyncFd<OwnedFd>,
    slots: [Option<Pending>; SLOTS],
}

impl UringReader {
    /// Register `file` with the ring so submissions do not have to resolve it each time.
    pub fn new(file: &File) -> Result<Self> {
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
            slots: [const { None }; SLOTS],
        })
    }

    /// Submit a read of `buf` into `slot` and return without waiting for it.
    ///
    /// # Safety
    /// `buf` must stay valid, allocated where it is, and unaliased until the matching
    /// [`finish`](Self::finish) returns — or until this reader is dropped, which waits.
    /// Growing the buffer behind it is the way to break this.
    pub(crate) unsafe fn start(&mut self, slot: usize, buf: &mut [u8], offset: u64) -> Result<()> {
        debug_assert!(self.slots[slot].is_none(), "slot {slot} already has a read");
        self.slots[slot] = Some(Pending {
            addr: buf.as_mut_ptr() as usize,
            len: buf.len(),
            done: 0,
            offset,
            submitted: false,
        });
        self.submit(slot)
    }

    /// Await the read in `slot`, re-submitting until its whole range is read.
    pub(crate) async fn finish(&mut self, slot: usize) -> Result<()> {
        loop {
            self.reap()?;
            let Some(pending) = &self.slots[slot] else {
                return Ok(());
            };
            if pending.done == pending.len {
                self.slots[slot] = None;
                return Ok(());
            }
            if pending.submitted {
                self.park().await?;
            } else {
                self.submit(slot)?;
            }
        }
    }

    /// Hand the unread remainder of `slot` to the kernel.
    fn submit(&mut self, slot: usize) -> Result<()> {
        let (addr, len, done, offset) = {
            let pending = self.slots[slot].as_ref().expect("submit without a read");
            (pending.addr, pending.len, pending.done, pending.offset)
        };
        let entry = opcode::Read::new(types::Fixed(0), (addr + done) as *mut u8, (len - done) as u32)
            .offset(offset + done as u64)
            .build()
            .user_data(slot as u64);
        // SAFETY: the buffer stays valid and unaliased until `finish` reaps this completion
        // or `Drop` waits for it — the contract `start` places on its caller.
        unsafe { self.ring.submission().push(&entry) }
            .map_err(|_| anyhow::anyhow!("io_uring SQ full"))?;
        self.ring.submit().context("io_uring submit")?;
        self.slots[slot].as_mut().expect("still pending").submitted = true;
        Ok(())
    }

    /// Take every completion the kernel has posted, crediting each to its own slot.
    ///
    /// Reads for both slots complete into the same queue, so a wait for one reaps the other
    /// as a side effect; that is what lets the read ahead land while the frame in hand is
    /// still being waited on.
    fn reap(&mut self) -> Result<()> {
        self.ring.completion().sync();
        while let Some(cqe) = self.ring.completion().next() {
            let Some(pending) = self
                .slots
                .get_mut(cqe.user_data() as usize)
                .and_then(Option::as_mut)
            else {
                continue;
            };
            pending.submitted = false;
            if cqe.result() < 0 {
                let err = std::io::Error::from_raw_os_error(-cqe.result());
                return Err(err).context("io_uring read");
            }
            if cqe.result() == 0 {
                bail!(
                    "io_uring read hit EOF {} of {} bytes at {}",
                    pending.done,
                    pending.len,
                    pending.offset
                );
            }
            pending.done += cqe.result() as usize;
        }
        Ok(())
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
    /// Wait for the kernel to finish with every buffer it holds, without which a drop
    /// between submit and completion leaves it writing into freed memory.
    ///
    /// Idempotent, so an owner may call it early — [`ReadCtx`](crate::media::read_path)
    /// does, from its own `Drop`, so the guarantee does not depend on field order.
    pub(crate) fn drain_in_flight(&mut self) {
        let outstanding = self
            .slots
            .iter()
            .filter(|slot| slot.as_ref().is_some_and(|p| p.submitted))
            .count();
        if outstanding == 0 {
            self.slots = [const { None }; SLOTS];
            return;
        }
        #[cfg(test)]
        DRAINED_ON_DROP.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        // The one place this file blocks; the alternative is a use-after-free.
        if self.ring.submitter().submit_and_wait(outstanding).is_ok() {
            self.ring.completion().sync();
            while self.ring.completion().next().is_some() {}
        }
        self.slots = [const { None }; SLOTS];
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

    fn blob(dir: &std::path::Path, len: usize) -> (std::fs::File, Vec<u8>) {
        std::fs::create_dir_all(dir).expect("tmpdir");
        let body: Vec<u8> = (0..len as u32).map(|i| (i % 251) as u8).collect();
        let path = dir.join("blob");
        let mut f = std::fs::File::create(&path).expect("create");
        f.write_all(&body).unwrap();
        f.sync_all().unwrap();
        (std::fs::File::open(&path).expect("open"), body)
    }

    /// The mid-flight state is built directly rather than by racing `task.abort()`, which
    /// cannot reach it: a ring read that completes inline never yields for the abort to land
    /// on. Without a sanitiser the wait itself is the only observable, hence
    /// [`DRAINED_ON_DROP`]. `docs/disk-access/IMPLEMENTATION.md` §Test plan.
    #[test]
    fn dropping_a_reader_mid_read_waits_for_the_kernel() {
        let dir = std::env::temp_dir().join(format!("wtpacs-ring-drop-{}", std::process::id()));
        let (file, body) = blob(&dir, 64 * 1024);

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
        // `buf` is declared before `reader`, so it drops after it — the ordering that makes
        // the wait meaningful.
        let mut buf = vec![0u8; body.len()];
        // SAFETY: `buf` outlives `reader`, which is what `start` requires of its caller.
        unsafe { reader.start(0, &mut buf, 0) }.expect("submit");
        assert!(reader.slots[0].is_some(), "the read was not left in flight");

        let before = DRAINED_ON_DROP.load(std::sync::atomic::Ordering::SeqCst);
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

    /// **The read-ahead invariant.** Two reads are submitted before either is awaited, and
    /// each has to come back into its own buffer — a completion credited to the wrong slot
    /// would serve one frame's bytes as another's.
    #[test]
    fn two_reads_in_flight_land_in_their_own_slots() {
        let dir = std::env::temp_dir().join(format!("wtpacs-ring-two-{}", std::process::id()));
        let (file, body) = blob(&dir, 128 * 1024);
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
        let (first, second) = (0u64, 64 * 1024u64);
        let mut a = vec![0u8; 64 * 1024];
        let mut b = vec![0u8; 64 * 1024];
        // Timed, because the way this breaks is a completion credited to the wrong slot,
        // and the symptom of that is a wait that never ends.
        rt.block_on(async {
            // SAFETY: both buffers outlive the reader and are not touched until `finish`.
            unsafe { reader.start(0, &mut a, first) }.expect("start a");
            unsafe { reader.start(1, &mut b, second) }.expect("start b");
            tokio::time::timeout(std::time::Duration::from_secs(10), async {
                reader.finish(1).await.expect("finish b");
                reader.finish(0).await.expect("finish a");
            })
            .await
            .expect("a completion never arrived at the slot that was waiting for it");
        });
        assert_eq!(a, body[..64 * 1024], "slot 0 got the wrong bytes");
        assert_eq!(b, body[64 * 1024..], "slot 1 got the wrong bytes");
        std::fs::remove_dir_all(&dir).ok();
    }
}
