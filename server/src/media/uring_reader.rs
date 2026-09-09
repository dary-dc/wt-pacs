//! io_uring for the miss path only; a page-cache hit is served inline.
//!
//! Two constraints are easy to undo by accident: tokio migrates a task between workers, so
//! `SINGLE_ISSUER` and `DEFER_TASKRUN` are unusable, and blocking in `io_uring_enter` would
//! be the stall this exists to prevent. `docs/disk-access/IMPLEMENTATION.md`.
//! Thin wrapper: `docs/disk-access/READ-PATH-DESIGN.md` §11 cut 6.

use anyhow::{bail, Context, Result};
use io_uring::{opcode, types, IoUring};
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use tokio::io::unix::AsyncFd;

/// Test-only: the wait is otherwise unobservable, since a cached read lands before it.
#[cfg(test)]
pub(crate) static DRAINED_ON_DROP: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

pub struct UringReader {
    ring: IoUring,
    eventfd: AsyncFd<OwnedFd>,
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
            in_flight: 0,
        })
    }

    /// # Safety
    /// `buf` stays valid, unmoved and unaliased until `reap` reports `slot` or this reader is
    /// dropped, which waits.
    pub(crate) unsafe fn submit(&mut self, slot: usize, buf: &mut [u8], offset: u64) -> Result<()> {
        let entry = opcode::Read::new(types::Fixed(0), buf.as_mut_ptr(), buf.len() as u32)
            .offset(offset)
            .build()
            .user_data(slot as u64);
        unsafe { self.ring.submission().push(&entry) }
            .map_err(|_| anyhow::anyhow!("io_uring SQ full"))?;
        self.ring.submit().context("io_uring submit")?;
        self.in_flight += 1;
        Ok(())
    }

    /// Every completion landed so far: `(slot, bytes)`. A short read is the caller's to resubmit.
    pub(crate) fn reap(&mut self) -> Result<Vec<(usize, usize)>> {
        self.ring.completion().sync();
        let mut landed = Vec::new();
        for cqe in self.ring.completion() {
            self.in_flight = self.in_flight.saturating_sub(1);
            match cqe.result() {
                n if n > 0 => landed.push((cqe.user_data() as usize, n as usize)),
                0 => bail!("io_uring read hit EOF"),
                e => return Err(std::io::Error::from_raw_os_error(-e)).context("io_uring read"),
            }
        }
        Ok(landed)
    }

    /// Park on the registered eventfd rather than blocking in `io_uring_enter`.
    pub(crate) async fn park(&mut self) -> Result<()> {
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

    /// The one place this file blocks; the alternative is a use-after-free.
    pub(crate) fn drain_in_flight(&mut self) {
        if self.in_flight == 0 {
            return;
        }
        #[cfg(test)]
        DRAINED_ON_DROP.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self
            .ring
            .submitter()
            .submit_and_wait(self.in_flight)
            .is_ok()
        {
            self.ring.completion().sync();
            while self.ring.completion().next().is_some() {}
        }
        self.in_flight = 0;
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
    use crate::media::read_path::WINDOWS;
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

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt");
        let _guard = rt.enter();

        let Ok(mut reader) = UringReader::new(&file, WINDOWS as u32) else {
            eprintln!("skipped: io_uring is unavailable on this host");
            std::fs::remove_dir_all(&dir).ok();
            return;
        };
        let mut buf = vec![0u8; body.len()];
        // SAFETY: `buf` outlives `reader`, which is what `submit` requires of its caller.
        unsafe { reader.submit(0, &mut buf, 0) }.expect("submit");
        assert!(reader.in_flight > 0, "the read was not left in flight");

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

        let Ok(mut reader) = UringReader::new(&file, WINDOWS as u32) else {
            eprintln!("skipped: io_uring is unavailable on this host");
            std::fs::remove_dir_all(&dir).ok();
            return;
        };
        let (first, second) = (0u64, 64 * 1024u64);
        let mut a = vec![0u8; 64 * 1024];
        let mut b = vec![0u8; 64 * 1024];
        let mut filled = [0usize; 2];
        rt.block_on(async {
            // SAFETY: both buffers outlive the reader and are not touched until reaped.
            unsafe { reader.submit(0, &mut a, first) }.expect("start a");
            unsafe { reader.submit(1, &mut b, second) }.expect("start b");
            tokio::time::timeout(std::time::Duration::from_secs(10), async {
                while filled[0] < a.len() || filled[1] < b.len() {
                    for (slot, n) in reader.reap().expect("reap") {
                        filled[slot] += n;
                        if slot == 0 && filled[0] < a.len() {
                            unsafe {
                                reader.submit(0, &mut a[filled[0]..], first + filled[0] as u64)
                            }
                            .expect("resubmit a");
                        }
                        if slot == 1 && filled[1] < b.len() {
                            unsafe {
                                reader.submit(1, &mut b[filled[1]..], second + filled[1] as u64)
                            }
                            .expect("resubmit b");
                        }
                    }
                    if filled[0] < a.len() || filled[1] < b.len() {
                        reader.park().await.expect("park");
                    }
                }
            })
            .await
            .expect("a completion never arrived at the slot that was waiting for it");
        });
        assert_eq!(a, body[..64 * 1024], "slot 0 got the wrong bytes");
        assert_eq!(b, body[64 * 1024..], "slot 1 got the wrong bytes");
        std::fs::remove_dir_all(&dir).ok();
    }
}
