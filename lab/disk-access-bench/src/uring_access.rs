//! io_uring reader for the disk-access campaign.
//!
//! Three things make this workload awkward for io_uring, and the arms are shaped around
//! them rather than around io_uring's usual benchmarks:
//!
//! * **Queue depth is 1 per session.** The session loop reads one ask and sends that frame
//!   to completion before reading the next (`docs/adr-reject-server-ordering.md`), so there
//!   is no natural batch. The only batching available inside one ask is the frame's own
//!   windows — which is why `submit_frame` exists.
//! * **`SINGLE_ISSUER` (and therefore `DEFER_TASKRUN`) is unusable.** Tokio's multi-thread
//!   runtime migrates a task between workers across `.await`, so a per-session ring would
//!   see submissions from different threads. Those are io_uring's two biggest throughput
//!   knobs and a work-stealing runtime cannot have them. `COOP_TASKRUN` is kept; `SQPOLL`
//!   is offered as a variant because it tolerates migration.
//! * **Completions must be awaited, not waited on.** Blocking in `io_uring_enter` would
//!   reintroduce exactly the executor stall the whole campaign is about, so the ring
//!   registers an eventfd and the reader awaits it through Tokio's `AsyncFd`.

use anyhow::{bail, Context, Result};
use io_uring::{opcode, types, IoUring};
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use tokio::io::unix::AsyncFd;

/// Registered buffer set plus the ring that reads into it.
///
/// Buffers are owned here so their addresses stay stable for `register_buffers`; the kernel
/// writes into a buffer only between `submit_*` and the matching `complete`, and `buf()`
/// refuses to hand out a slice while that is true.
pub struct UringReader {
    ring: IoUring,
    eventfd: AsyncFd<OwnedFd>,
    bufs: Vec<Box<[u8]>>,
    in_flight: Vec<bool>,
    /// `false` when the file/buffers are not registered (the naive arm).
    fixed: bool,
}

impl UringReader {
    /// `slots` buffers of `buf_len` bytes each. `fixed` registers the file and the buffers;
    /// `sqpoll` starts a kernel submission thread so submits cost no syscall at all.
    pub fn new(
        file: &File,
        slots: usize,
        buf_len: usize,
        fixed: bool,
        sqpoll: bool,
    ) -> Result<Self> {
        let entries = (slots.next_power_of_two() as u32).max(8);
        let mut builder = IoUring::builder();
        if sqpoll {
            // Tolerates task migration where SINGLE_ISSUER does not, at the cost of a
            // kernel thread spinning for `sq_thread_idle` after every submit. The kernel
            // rejects COOP_TASKRUN alongside it (EINVAL) — with a kernel submitter there is
            // no task work to defer — so the two knobs are mutually exclusive.
            builder.setup_sqpoll(200);
        } else {
            builder.setup_coop_taskrun();
        }
        let ring = builder.build(entries).context("io_uring setup")?;

        let bufs: Vec<Box<[u8]>> = (0..slots)
            .map(|_| vec![0u8; buf_len].into_boxed_slice())
            .collect();

        if fixed {
            ring.submitter()
                .register_files(&[file.as_raw_fd()])
                .context("register_files")?;
            let iovecs: Vec<libc::iovec> = bufs
                .iter()
                .map(|b| libc::iovec {
                    iov_base: b.as_ptr() as *mut libc::c_void,
                    iov_len: b.len(),
                })
                .collect();
            // SAFETY: `bufs` outlives the ring and the boxes are never reallocated, so the
            // registered addresses stay valid until `unregister`/drop.
            unsafe { ring.submitter().register_buffers(&iovecs) }.context("register_buffers")?;
        }

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
            in_flight: vec![false; slots],
            bufs,
            fixed,
        })
    }

    pub fn buf(&self, slot: usize) -> &[u8] {
        assert!(
            !self.in_flight[slot],
            "read slot {slot} while the kernel owns it"
        );
        &self.bufs[slot]
    }

    /// Fill part of a slot from outside the ring (the hybrid arm's inline `RWF_NOWAIT`
    /// read). Only legal while the kernel does not own the slot.
    pub fn buf_mut(&mut self, slot: usize) -> &mut [u8] {
        assert!(
            !self.in_flight[slot],
            "write slot {slot} while the kernel owns it"
        );
        &mut self.bufs[slot]
    }

    /// Queue one window read into `slot`. Nothing reaches the kernel until `submit`.
    pub fn push(&mut self, slot: usize, file: &File, offset: u64, len: usize) -> Result<()> {
        self.push_at(slot, 0, file, offset, len)
    }

    /// Queue a read into `slot` starting `at` bytes into the slot's buffer — how the hybrid
    /// arm finishes a window that `RWF_NOWAIT` could only partly fill. A registered buffer
    /// may be read into at any offset inside its registered range.
    pub fn push_at(
        &mut self,
        slot: usize,
        at: usize,
        file: &File,
        offset: u64,
        len: usize,
    ) -> Result<()> {
        assert!(at + len <= self.bufs[slot].len());
        // SAFETY: `at + len` is inside the slot's allocation, checked above.
        let ptr = unsafe { self.bufs[slot].as_mut_ptr().add(at) };
        let entry = if self.fixed {
            opcode::ReadFixed::new(types::Fixed(0), ptr, len as u32, slot as u16)
                .offset(offset)
                .build()
                .user_data(slot as u64)
        } else {
            opcode::Read::new(types::Fd(file.as_raw_fd()), ptr, len as u32)
                .offset(offset)
                .build()
                .user_data(slot as u64)
        };
        // SAFETY: the buffer lives in `self.bufs` and is marked in-flight until reaped, so
        // nothing else reads or moves it while the kernel writes.
        unsafe { self.ring.submission().push(&entry) }
            .map_err(|_| anyhow::anyhow!("io_uring SQ full"))?;
        self.in_flight[slot] = true;
        Ok(())
    }

    /// One `io_uring_enter` for everything queued (zero syscalls under SQPOLL).
    pub fn submit(&mut self) -> Result<()> {
        self.ring.submit().context("io_uring submit")?;
        Ok(())
    }

    /// Await `want` completions. Cached reads are usually already in the CQ when this is
    /// called, so the common path takes no await at all.
    ///
    /// Returns the number of completions that had to wait on the eventfd — the io_uring
    /// equivalent of a `spawn_blocking` hop, and the number the campaign compares.
    pub async fn complete(&mut self, want: usize) -> Result<usize> {
        let mut done = 0usize;
        let mut waited = 0usize;
        while done < want {
            self.ring.completion().sync();
            let mut drained = 0usize;
            while let Some(cqe) = self.ring.completion().next() {
                if cqe.result() < 0 {
                    let e = std::io::Error::from_raw_os_error(-cqe.result());
                    bail!("io_uring read failed: {e}");
                }
                self.in_flight[cqe.user_data() as usize] = false;
                drained += 1;
            }
            done += drained;
            if done >= want {
                break;
            }
            // Nothing ready: the read went to an io-wq worker. Park on the eventfd instead
            // of spinning or blocking in `io_uring_enter`.
            waited += 1;
            let mut guard = self
                .eventfd
                .readable_mut()
                .await
                .context("eventfd readable")?;
            let _ = guard.try_io(|inner| {
                let mut sink = [0u8; 8];
                // SAFETY: 8-byte read from an eventfd into a live local buffer.
                let n = unsafe {
                    libc::read(inner.get_ref().as_raw_fd(), sink.as_mut_ptr() as *mut _, 8)
                };
                if n < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        Ok(waited)
    }
}

#[cfg(test)]
mod tests {
    use io_uring::{opcode, IoUring};

    /// `SINGLE_ISSUER` (and `DEFER_TASKRUN`, which requires it) are io_uring's two biggest
    /// throughput knobs. Tokio's multi-thread runtime migrates a task between workers at
    /// every `.await`, so a per-session ring is submitted from whichever worker resumed the
    /// task. This test pins down what the kernel actually does about that — the campaign
    /// claims the knobs are unavailable to a work-stealing runtime, and that claim should
    /// come from the kernel, not from reading documentation.
    #[test]
    fn single_issuer_and_a_second_submitting_thread() {
        let mut ring: IoUring = IoUring::builder()
            .setup_single_issuer()
            .build(8)
            .expect("ring");
        // SAFETY: a `Nop` carries no buffer.
        unsafe {
            ring.submission()
                .push(&opcode::Nop::new().build().user_data(1))
        }
        .unwrap();
        ring.submit().expect("submit from the creating thread");

        let from_other = std::thread::spawn(move || {
            // SAFETY: as above; the ring moved with the closure and is not shared.
            unsafe {
                ring.submission()
                    .push(&opcode::Nop::new().build().user_data(2))
            }
            .unwrap();
            ring.submit()
                .map(|n| n as i32)
                .map_err(|e| e.raw_os_error())
        })
        .join()
        .unwrap();

        assert_eq!(
            from_other,
            Err(Some(libc::EEXIST)),
            "kernel accepted a second submitting task under SINGLE_ISSUER \
             (got {from_other:?}) — if this ever passes, revisit docs/disk-access/RERUN.md, \
             which rules the flag out for Tokio's work-stealing runtime on the strength of \
             this rejection"
        );
    }
}
