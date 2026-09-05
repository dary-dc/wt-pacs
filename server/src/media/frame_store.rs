//! Server-side SBND reader: one open study mapped for layout, read for serving.
//!
//! Frame bytes reach the executor through `read_at_nowait` (page-cache hit, no fault, no
//! hop) with `read_at_blocking` on a blocking pool for the miss. See
//! `docs/disk-access/adr.md` — the mapping is kept for the header/index and for the lab's
//! mmap arms; the serving path never touches it.
//!
//! A frame that is asked more than once can skip that path entirely: see `FrameCache`,
//! which is off unless the server is given a byte budget.

use crate::media::frame_cache::FrameCache;
use anyhow::{bail, Context, Result};
use bytes::Bytes;
use memmap2::Mmap;
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::os::unix::io::AsRawFd;
use std::path::Path;
use std::sync::OnceLock;
use study_bundle::parse_layout;

/// Bytes read per `read_at_nowait` call on the serving path.
///
/// The window bounds two things at once: how long the executor copies without yielding,
/// and how much memory a session holds. 64 KiB measured best on the validation host —
/// 256 KiB (whole frame, one call) cut per-frame latency by ~10 µs but quadrupled the
/// worst co-tenant gap; 16 KiB paid more syscalls for no further gap reduction.
pub const READ_WINDOW: usize = 64 * 1024;

pub struct FrameStore {
    file: File,
    mmap: Mmap,
    frame_count: u32,
    metadata_len: u32,
    data_base: usize,
    index: Vec<(u64, u32)>,
    nowait: bool,
    cache: FrameCache,
}

impl FrameStore {
    /// No frame cache. Every ask reads.
    pub fn open(study_path: &Path) -> Result<Self> {
        Self::open_with_cache(study_path, 0)
    }

    /// `cache_budget` bytes of process-private frame cache; `0` disables it.
    pub fn open_with_cache(study_path: &Path, cache_budget: usize) -> Result<Self> {
        let file = File::open(study_path)
            .with_context(|| format!("open study bundle {}", study_path.display()))?;
        // SAFETY: `file` keeps the fd open; bundle must not be truncated while mapped.
        let mmap = unsafe { Mmap::map(&file).context("mmap study bundle")? };
        let parsed = parse_layout(&mmap)?;
        let nowait = probe_nowait(&file, parsed.data_base as u64);
        Ok(Self {
            file,
            mmap,
            frame_count: parsed.frame_count,
            metadata_len: parsed.metadata_len,
            data_base: parsed.data_base,
            index: parsed.index,
            nowait,
            cache: FrameCache::new(cache_budget),
        })
    }

    /// Whether this study's filesystem honours `RWF_NOWAIT`.
    ///
    /// ext4 does; **overlayfs and tmpfs answer `EOPNOTSUPP`** — measured, not assumed. On
    /// those, `read_at_nowait` always reports a miss, so the caller must read whole frames
    /// on the pool (one round trip) instead of streaming windows (one round trip *each*).
    /// See `read_window`.
    pub fn nowait_supported(&self) -> bool {
        self.nowait
    }

    /// Bytes to read per round of the serving loop for a frame of `frame_len`.
    ///
    /// `READ_WINDOW` where the fast path exists; the whole frame where it does not, so an
    /// unsupporting filesystem degrades to exactly one pooled `pread` per frame — the
    /// hard-guarantee escape hatch — rather than one per window.
    pub fn read_window(&self, frame_len: u32) -> usize {
        if self.nowait {
            READ_WINDOW.min(frame_len as usize).max(1)
        } else {
            (frame_len as usize).max(1)
        }
    }

    pub fn frame_count(&self) -> u32 {
        self.frame_count
    }

    pub fn metadata_json(&self) -> Result<&str> {
        let start = self.data_base - self.metadata_len as usize;
        let end = self.data_base;
        std::str::from_utf8(&self.mmap[start..end]).context("metadata JSON is not UTF-8")
    }

    /// Byte offset and length of frame payload in the SBND file. No I/O — a refusal for an
    /// out-of-range ask costs nothing and happens before any stream is opened.
    pub fn frame_range(&self, index: u32) -> Result<(u64, u32)> {
        self.index
            .get(index as usize)
            .copied()
            .with_context(|| format!("frame index {index} out of range ({})", self.frame_count))
    }

    pub fn frame_slice(&self, index: u32) -> Result<&[u8]> {
        let (offset, length) = self.frame_range(index)?;
        let start = offset as usize;
        let end = start + length as usize;
        if end > self.mmap.len() {
            bail!(
                "frame {index} slice out of bounds ({start}..{end}, file {})",
                self.mmap.len()
            );
        }
        Ok(&self.mmap[start..end])
    }

    /// Bytes copied into `buf` **without ever waiting on I/O** — `preadv2(RWF_NOWAIT)`.
    ///
    /// Safe on the Tokio executor: where an mmap read would take a major fault (which is
    /// not an `.await`, so it freezes every task on the thread), this returns short
    /// instead. A return of `n < buf.len()` means the rest is not in the page cache and
    /// must be read where blocking is allowed — see `read_at_blocking`.
    ///
    /// Returns `0` rather than an error when the filesystem has no `RWF_NOWAIT` support,
    /// so such a host degrades to "always read on the pool" instead of failing asks.
    pub fn read_at_nowait(&self, buf: &mut [u8], offset: u64) -> Result<usize> {
        if !self.nowait {
            return Ok(0);
        }
        let mut done = 0usize;
        while done < buf.len() {
            let iov = libc::iovec {
                iov_base: buf[done..].as_mut_ptr() as *mut libc::c_void,
                iov_len: buf.len() - done,
            };
            // SAFETY: `iov` describes a live, exclusively borrowed subrange of `buf`.
            let n = unsafe {
                libc::preadv2(
                    self.file.as_raw_fd(),
                    &iov,
                    1,
                    (offset + done as u64) as libc::off_t,
                    libc::RWF_NOWAIT,
                )
            };
            if n < 0 {
                let err = std::io::Error::last_os_error();
                return match err.raw_os_error() {
                    Some(libc::EAGAIN) => Ok(done),
                    Some(libc::EOPNOTSUPP) | Some(libc::ENOSYS) | Some(libc::EINVAL)
                        if done == 0 =>
                    {
                        Ok(0)
                    }
                    _ => Err(err).context("preadv2 RWF_NOWAIT"),
                };
            }
            if n == 0 {
                return Ok(done); // end of file, or nothing more available without waiting
            }
            done += n as usize;
        }
        Ok(done)
    }

    /// Read exactly `buf.len()` bytes at `offset`, waiting on I/O if it must.
    ///
    /// Call from a **blocking** pool (`spawn_blocking`), never the executor.
    pub fn read_at_blocking(&self, buf: &mut [u8], offset: u64) -> Result<()> {
        self.file
            .read_exact_at(buf, offset)
            .with_context(|| format!("read {} bytes at {offset}", buf.len()))
    }

    /// Cached frame bytes, if this frame is resident. A hit costs a refcount bump: no
    /// syscall, nothing to copy into the connection, and the bytes are process-private.
    pub fn cached_frame(&self, index: u32) -> Option<Bytes> {
        self.cache.get(index)
    }

    /// `true` when this ask earned `index` a cache slot and the caller owns the fill.
    /// Second ask, not the first — see `FrameCache`.
    pub fn claim_fill(&self, index: u32) -> bool {
        match self.frame_range(index) {
            Ok((_, len)) => self.cache.claim_fill(index, len as usize),
            Err(_) => false,
        }
    }

    /// A buffer to assemble a frame into before admitting it. See `FrameCache`.
    pub fn assembly_buffer(&self, len: usize) -> bytes::BytesMut {
        self.cache.assembly_buffer(len)
    }

    pub fn admit(&self, index: u32, bytes: Bytes) {
        self.cache.admit(index, bytes);
    }

    pub fn abandon_fill(&self, index: u32) {
        self.cache.abandon_fill(index);
    }

    /// Resident cache bytes and frame count.
    pub fn cache_stats(&self) -> (usize, usize) {
        self.cache.stats()
    }

    pub fn cache_enabled(&self) -> bool {
        self.cache.enabled()
    }
}

/// One `RWF_NOWAIT` read at `offset` to learn whether the filesystem supports the flag.
///
/// `EAGAIN` counts as support — it is the flag working on a cold byte. Only an outright
/// refusal (`EOPNOTSUPP` on overlayfs and tmpfs, `EINVAL`/`ENOSYS` on kernels without
/// `preadv2`) means the fast path does not exist here. Anything else unexpected is read as
/// "no fast path" so the serving loop takes the conservative route.
fn probe_nowait(file: &File, offset: u64) -> bool {
    let mut byte = [0u8; 1];
    let iov = libc::iovec {
        iov_base: byte.as_mut_ptr() as *mut libc::c_void,
        iov_len: 1,
    };
    // SAFETY: `iov` describes a live, exclusively borrowed one-byte buffer.
    let n = unsafe {
        libc::preadv2(
            file.as_raw_fd(),
            &iov,
            1,
            offset as libc::off_t,
            libc::RWF_NOWAIT,
        )
    };
    if n >= 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EAGAIN)
}

/// Host page size from `sysconf(_SC_PAGESIZE)` (fallback 4096).
pub fn host_page_size() -> usize {
    static PAGE: OnceLock<usize> = OnceLock::new();
    *PAGE.get_or_init(|| {
        let n = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if n > 0 {
            n as usize
        } else {
            4096
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use study_bundle::write_bundle;

    fn scratch(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("{name}-{stamp}.sbnd"))
    }

    #[test]
    fn host_page_size_is_power_of_two() {
        let p = host_page_size();
        assert!(p >= 4096, "page size {p}");
        assert!(p.is_power_of_two(), "page size {p}");
    }

    #[test]
    fn round_trip_from_writer() -> Result<()> {
        let meta = br#"{"frameCount":2}"#;
        let f0 = b"frame-0";
        let f1 = b"frame-1-longer";
        let path = scratch("frame-store");
        write_bundle(&path, meta, &[f0.as_slice(), f1.as_slice()])?;

        let store = FrameStore::open(&path)?;
        assert_eq!(store.frame_count(), 2);
        assert_eq!(store.metadata_json()?, r#"{"frameCount":2}"#);
        assert_eq!(store.frame_slice(0)?, f0);
        assert_eq!(store.frame_slice(1)?, f1);
        assert!(store.frame_slice(99).is_err());
        assert!(store.frame_range(99).is_err());

        let (offset, len) = store.frame_range(1)?;
        let mut buf = vec![0u8; len as usize];
        store.read_at_blocking(&mut buf, offset)?;
        assert_eq!(buf, f1);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    /// A store whose filesystem refuses `RWF_NOWAIT` must ask for whole frames, so the
    /// serving loop pays one pool round trip per frame instead of one per window.
    #[test]
    fn read_window_collapses_to_the_frame_without_nowait() -> Result<()> {
        let body = vec![7u8; 200_000];
        let path = scratch("frame-store-window");
        write_bundle(&path, br#"{"frameCount":1}"#, &[body.as_slice()])?;
        let mut store = FrameStore::open(&path)?;

        store.nowait = true;
        assert_eq!(store.read_window(200_000), READ_WINDOW);
        assert_eq!(
            store.read_window(1_000),
            1_000,
            "never over-read a short frame"
        );

        store.nowait = false;
        assert_eq!(store.read_window(200_000), 200_000);
        assert_eq!(
            store.read_at_nowait(&mut [0u8; 16], 0)?,
            0,
            "no syscall, all miss"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    /// The serving path is only correct if a short `read_at_nowait` can be completed by
    /// `read_at_blocking` at the offset it stopped at.
    #[test]
    fn nowait_and_blocking_compose_into_the_whole_frame() -> Result<()> {
        let body: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let path = scratch("frame-store-nowait");
        write_bundle(&path, br#"{"frameCount":1}"#, &[body.as_slice()])?;
        let store = FrameStore::open(&path)?;
        let (offset, len) = store.frame_range(0)?;

        let mut out = vec![0u8; len as usize];
        let mut pos = 0usize;
        while pos < out.len() {
            let want = store.read_window(len).min(out.len() - pos);
            let at = offset + pos as u64;
            let got = store.read_at_nowait(&mut out[pos..pos + want], at)?;
            assert!(got <= want, "nowait overran the window: {got} > {want}");
            if got < want {
                store.read_at_blocking(&mut out[pos + got..pos + want], at + got as u64)?;
            }
            pos += want;
        }
        assert_eq!(out, body);
        let _ = std::fs::remove_file(path);
        Ok(())
    }
}
