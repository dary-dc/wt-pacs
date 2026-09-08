//! io_uring reader for the campaign. Three properties of this workload shape it rather than
//! io_uring's usual benchmarks — serving depth 1, a task that migrates between workers, and
//! completions awaited rather than waited on. `docs/disk-access/IMPLEMENTATION.md`.

use anyhow::{bail, Context, Result};
use io_uring::{opcode, types, IoUring};
use std::fs::File;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use tokio::io::unix::AsyncFd;
use tokio::io::Interest;

/// What the reactor watches. Both go through `AsyncFd`; neither blocks in `io_uring_enter`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Completion {
    /// Two fds per ring. What the product ships.
    Eventfd,
    /// One fd per ring, and how tokio's own driver parks. Why a `COOP_TASKRUN` ring is
    /// pollable from setup: `docs/disk-access/RESEARCH-io-backends-RESULT.md` §Kernel side.
    RingFd,
}

/// Borrowed, so `AsyncFd` can register it without owning the ring.
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

/// Buffers are owned here so their addresses stay stable for `register_buffers`; `buf()`
/// refuses to hand one out while the kernel owns it.
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
    /// `fixed` registers the file and buffers; `sqpoll` starts a kernel submission thread.
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
            // The kernel rejects COOP_TASKRUN alongside SQPOLL (EINVAL), so the two knobs
            // are mutually exclusive.
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

    /// Sized once for the study's longest frame, so a depth from the frame in hand can
    /// index past it.
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

    /// Only legal while the kernel does not own the slot.
    pub fn buf_mut(&mut self, slot: usize) -> &mut [u8] {
        assert!(
            !self.in_flight[slot],
            "write slot {slot} while the kernel owns it"
        );
        &mut self.bufs[slot]
    }

    /// Nothing reaches the kernel until `submit`.
    pub fn push(&mut self, slot: usize, file: &File, offset: u64, len: usize) -> Result<()> {
        self.push_at(slot, 0, file, offset, len)
    }

    /// How the hybrid arm finishes a window `RWF_NOWAIT` could only partly fill.
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

    /// Awaits one `slot`, draining whatever lands alongside it. Returns **1 if the read did
    /// not complete inline**, not the number of parks, so it compares with a pool hop.
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

    /// Reaps the whole CQ, recording which slots came back.
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

    /// Park until the kernel reports a completion, rather than blocking in `io_uring_enter`.
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
                // Edge-triggered and cleared here. A wake carrying nothing is allowed, and
                // tokio's readiness tick means a CQE posted after the clear is not lost.
                let mut guard = ring.readable_mut().await.context("ring fd readable")?;
                guard.clear_ready();
            }
        }
        Ok(())
    }

    /// One `io_uring_enter` for everything queued; none under SQPOLL.
    pub fn submit(&mut self) -> Result<()> {
        self.ring.submit().context("io_uring submit")?;
        Ok(())
    }

    /// Returns how many had to wait — the campaign's equivalent of a `spawn_blocking` hop.
    /// A cached read is usually already in the CQ, so the common path takes no await.
    pub async fn complete(&mut self, want: usize) -> Result<usize> {
        self.complete_into(want, &mut Vec::new()).await
    }

    /// Reports **which** slots came back, so a caller refills each as it lands; draining in
    /// lockstep would measure its batching rather than the ring.
    pub async fn complete_into(&mut self, want: usize, freed: &mut Vec<usize>) -> Result<usize> {
        let mut done = 0usize;
        let mut waited = 0usize;
        while done < want {
            done += self.drain(freed)?;
            if done >= want {
                break;
            }
            // Nothing ready: the read went to an io-wq worker.
            waited += 1;
            self.park().await?;
        }
        Ok(waited)
    }
}

/// Buffers are registered once, so they must cover the study's **longest** frame, not the
/// first one asked for. Upholds `win <= buf_len` and `windows <= slots` for every frame.
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

    /// The campaign claims io_uring's two biggest throughput knobs are unavailable to a
    /// work-stealing runtime. That claim should come from the kernel, not from reading
    /// documentation, so this submits from a migrated task and records what happens.
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

    /// The geometry must hold for *every* frame in the study, not the first one served: a
    /// ring built from frame 0 panicked on a study of variable-length frames.
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
