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
//!   registers an eventfd and the reader awaits it through Tokio's `AsyncFd` — or, under
//!   [`Completion::RingFd`], awaits the ring's own fd, which the kernel reports readable
//!   whenever its CQ has entries. One fd per ring instead of two; the `x14` arms.

use anyhow::{bail, Context, Result};
use io_uring::{opcode, types, IoUring};
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use tokio::io::unix::AsyncFd;
use tokio::io::Interest;

/// Registered buffer set plus the ring that reads into it.
///
/// Buffers are owned here so their addresses stay stable for `register_buffers`; the kernel
/// writes into a buffer only between `submit_*` and the matching `complete`, and `buf()`
/// refuses to hand out a slice while that is true.
/// How a parked reader learns that a completion landed. Both are awaited through Tokio's
/// `AsyncFd`, so neither blocks in `io_uring_enter`; they differ in what the reactor watches.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Completion {
    /// A registered eventfd. Two fds per ring. What the product ships.
    Eventfd,
    /// The ring's own fd. One fd per ring. `io_uring_poll` reports the ring readable whenever
    /// its CQ has entries, and every CQ post wakes the poll queue (`io_cqring_wake` →
    /// `io_poll_wq_wake`, `io_uring/io_uring.c`, 6.18). For a ring without `DEFER_TASKRUN`
    /// that queue is active from setup (`io_ring_ctx_alloc`: `if (!ctx->task_complete)
    /// ctx->poll_activated = true`). Tokio's own io_uring driver parks this way — it
    /// registers the ring fd with mio (`runtime/io/driver/uring.rs`).
    RingFd,
}

/// The ring's descriptor, borrowed so `AsyncFd` can register it without owning the ring.
struct RingFd(RawFd);

impl AsRawFd for RingFd {
    fn as_raw_fd(&self) -> RawFd {
        self.0
    }
}

enum Parker {
    Eventfd(AsyncFd<OwnedFd>),
    RingFd(AsyncFd<RingFd>),
}

pub struct UringReader {
    /// Declared before `ring` so it deregisters from the reactor before the ring fd closes.
    parker: Parker,
    ring: IoUring,
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
        Self::with_completion(file, slots, buf_len, fixed, sqpoll, Completion::Eventfd)
    }

    /// As [`new`](Self::new), choosing how a parked reader is woken.
    pub fn with_completion(
        file: &File,
        slots: usize,
        buf_len: usize,
        fixed: bool,
        sqpoll: bool,
        completion: Completion,
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

        let parker = match completion {
            Completion::Eventfd => {
                // SAFETY: `eventfd` returns an owned fd or -1.
                let raw: RawFd =
                    unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
                if raw < 0 {
                    return Err(std::io::Error::last_os_error()).context("eventfd");
                }
                // SAFETY: `raw` is a fresh fd owned by nobody else.
                let owned = unsafe { OwnedFd::from_raw_fd(raw) };
                ring.submitter()
                    .register_eventfd(owned.as_raw_fd())
                    .context("register_eventfd")?;
                Parker::Eventfd(AsyncFd::new(owned).context("AsyncFd(eventfd)")?)
            }
            // Readable interest only: a ring is also "writable" whenever its SQ has room,
            // which is always here, and registering that would wake the reactor for nothing.
            Completion::RingFd => Parker::RingFd(
                AsyncFd::with_interest(RingFd(ring.as_raw_fd()), Interest::READABLE)
                    .context("AsyncFd(ring)")?,
            ),
        };

        Ok(Self {
            parker,
            ring,
            in_flight: vec![false; slots],
            bufs,
            fixed,
        })
    }

    /// How many slots this ring was built with. The pipelined arm needs it: the ring is
    /// sized once, for the study's longest frame, and a depth taken from the frame in hand
    /// could index past it.
    pub fn slots(&self) -> usize {
        self.bufs.len()
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

    /// Await the completion for one specific `slot`, draining anything else that lands
    /// alongside it.
    ///
    /// `complete(n)` counts completions without caring which; that is enough for an arm
    /// with one read outstanding, and wrong for one that submits a whole frame and wants
    /// to write window 0 the moment window 0 arrives.
    ///
    /// Returns **1 if this read did not complete inline**, not the number of times it
    /// parked — one read can take two trips round the eventfd before its CQE is visible,
    /// and counting those would not compare with a `spawn_blocking` round trip, which is
    /// what the campaign's hop column means.
    pub async fn complete_slot(&mut self, slot: usize) -> Result<usize> {
        let mut parked = false;
        let mut freed = Vec::new();
        while self.in_flight[slot] {
            self.drain(&mut freed)?;
            if !self.in_flight[slot] {
                break;
            }
            parked = true;
            self.park().await?;
        }
        Ok(usize::from(parked))
    }

    /// Reap every completion currently in the CQ, recording which slots came back.
    fn drain(&mut self, freed: &mut Vec<usize>) -> Result<usize> {
        self.ring.completion().sync();
        let mut drained = 0usize;
        while let Some(cqe) = self.ring.completion().next() {
            if cqe.result() < 0 {
                let e = std::io::Error::from_raw_os_error(-cqe.result());
                bail!("io_uring read failed: {e}");
            }
            let slot = cqe.user_data() as usize;
            self.in_flight[slot] = false;
            freed.push(slot);
            drained += 1;
        }
        Ok(drained)
    }

    /// Park until the kernel reports a completion. Never blocks in `io_uring_enter` — doing
    /// that would reintroduce the executor stall the whole campaign is about.
    async fn park(&mut self) -> Result<()> {
        match &mut self.parker {
            Parker::Eventfd(eventfd) => {
                let mut guard = eventfd.readable_mut().await.context("eventfd readable")?;
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
            Parker::RingFd(ring) => {
                // Readiness is edge-triggered and cleared here; the caller drains the CQ next
                // and parks again if the wake carried nothing, which `io_uring_poll` allows.
                // Tokio's readiness tick means a CQE posted after this clear is never lost.
                let mut guard = ring.readable_mut().await.context("ring fd readable")?;
                guard.clear_ready();
            }
        }
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
        self.complete_into(want, &mut Vec::new()).await
    }

    /// As [`complete`](Self::complete), but reports **which** slots came back.
    ///
    /// A caller holding several reads in flight needs this to refill a slot the moment its
    /// read lands, instead of waiting for the whole batch. Draining in lockstep would make
    /// every read in a batch appear to take as long as the slowest one, which measures the
    /// caller's batching rather than the ring.
    pub async fn complete_into(&mut self, want: usize, freed: &mut Vec<usize>) -> Result<usize> {
        let mut done = 0usize;
        let mut waited = 0usize;
        while done < want {
            done += self.drain(freed)?;
            if done >= want {
                break;
            }
            // Nothing ready: the read went to an io-wq worker. Park on the eventfd instead
            // of spinning or blocking in `io_uring_enter`.
            waited += 1;
            self.park().await?;
        }
        Ok(waited)
    }
}

/// Registered-buffer geometry for a study whose frames vary in length.
///
/// The buffers are allocated and registered once and then reused for every ask, so they
/// have to cover the study's **longest** frame. Sizing them from whichever frame was asked
/// for first reads past the buffer the moment a longer frame arrives — HTJ2K frames are
/// variable length, so that is a matter of when, not whether. The campaign fixture is
/// fixed-size (320 x 250 000 B), which is exactly why it never surfaced there.
///
/// Returns `(buf_len, slots)` for a frame batched window-by-window. Per frame the caller
/// still computes `win = read_chunk.min(len).max(1)` and `windows = len.div_ceil(win)`;
/// this upholds `win <= buf_len` and `windows <= slots` for every `len <= max_len`.
pub fn ring_geometry(read_chunk: usize, max_len: usize) -> (usize, usize) {
    let buf_len = read_chunk.min(max_len).max(1);
    (buf_len, max_len.div_ceil(buf_len))
}

#[cfg(test)]
mod tests {
    use io_uring::{opcode, IoUring};
    use std::os::fd::FromRawFd;

    /// The `x14` arms rest on one kernel fact: a reader parked on the ring's **own** fd is
    /// woken when a CQE lands, exactly as one parked on a registered eventfd is. This pins
    /// it down deterministically — the read is from a pipe nobody has written to yet, so it
    /// cannot complete inline, and the writer only writes after the reader has parked.
    #[test]
    fn ring_fd_completion_wakes_a_parked_reader() {
        let mut fds = [0i32; 2];
        // SAFETY: `pipe` fills two fds or fails.
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0, "pipe");
        // SAFETY: fresh fds, owned here and nowhere else.
        let (rd, wr) = unsafe {
            (
                std::fs::File::from_raw_fd(fds[0]),
                std::fs::File::from_raw_fd(fds[1]),
            )
        };
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("runtime");
        let waited = rt.block_on(async move {
            let mut r = super::UringReader::with_completion(
                &rd,
                1,
                64,
                true,
                false,
                super::Completion::RingFd,
            )
            .expect("ring on the pipe");
            r.push(0, &rd, 0, 64).expect("push");
            r.submit().expect("submit");
            let writer = std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(50));
                use std::io::Write;
                (&wr).write_all(&[0x5A; 64]).expect("write");
            });
            let waited = r.complete(1).await.expect("complete");
            writer.join().unwrap();
            assert!(r.buf(0).iter().all(|&b| b == 0x5A), "pipe bytes");
            waited
        });
        assert!(
            waited >= 1,
            "the read completed without parking — the test proved nothing"
        );
    }

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

    /// Ring buffers are sized once and reused, so the geometry must hold for *every* frame
    /// in the study, not the first one served. A study of variable-length frames (real
    /// HTJ2K; `lab/fixtures/queue_large` runs 41 000-61 000 B) used to panic here —
    /// `range end index 52000 out of range for slice of length 48000` — because the ring
    /// was built from frame 0. This asserts the invariant the fix restores.
    #[test]
    fn ring_geometry_covers_every_frame_not_just_the_first() {
        for &read_chunk in &[1usize, 4096, 65536, 1 << 20] {
            for &max_len in &[1usize, 41_000, 61_000, 250_000, 1 << 21] {
                let (buf_len, slots) = super::ring_geometry(read_chunk, max_len);
                assert!(buf_len > 0 && slots > 0, "degenerate geometry");
                for &len in &[1usize, 41_000, 48_000, 52_000, 61_000, 250_000] {
                    if len > max_len {
                        continue;
                    }
                    let win = read_chunk.min(len).max(1);
                    let windows = len.div_ceil(win);
                    assert!(
                        win <= buf_len,
                        "window {win} overruns the {buf_len}-byte registered buffer \
                         (read_chunk={read_chunk}, len={len}, max_len={max_len})"
                    );
                    assert!(
                        windows <= slots,
                        "{windows} windows need more than {slots} registered slots \
                         (read_chunk={read_chunk}, len={len}, max_len={max_len})"
                    );
                }
            }
        }
    }
}
