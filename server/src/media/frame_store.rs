//! Server-side SBND reader. Why `pread` and not a memory mapping: `docs/disk-access/adr.md`.

use anyhow::{Context, Result};
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::os::unix::io::AsRawFd;
use std::path::Path;
use study_bundle::read_layout;

#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

/// A read that *misses* is not bounded by this. Why 64 KiB: `docs/disk-access/adr.md`.
pub const READ_WINDOW: usize = 64 * 1024;

/// Where a frame's codestream lives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameSpan {
    pub offset: u64,
    pub len: u32,
}

/// **Open once per study, never per session.** `docs/disk-access/adr.md` §Invariants.
pub struct FrameStore {
    file: File,
    index: Vec<(u64, u32)>,
    metadata: String,
    nowait: bool,
    /// Test-only ceiling on one `read_at_nowait`, for forcing a partial hit.
    #[cfg(test)]
    nowait_cap: Option<usize>,
    #[cfg(test)]
    pool_starts: AtomicUsize,
}

impl FrameStore {
    pub fn open(study_path: &Path) -> Result<Self> {
        let file = File::open(study_path)
            .with_context(|| format!("open study bundle {}", study_path.display()))?;
        let layout = read_layout(&file)
            .with_context(|| format!("read layout of {}", study_path.display()))?;
        Ok(Self {
            nowait: probe_nowait(&file, layout.data_base as u64),
            file,
            index: layout.index,
            metadata: layout.metadata,
            #[cfg(test)]
            nowait_cap: None,
            #[cfg(test)]
            pool_starts: AtomicUsize::new(0),
        })
    }

    /// Where this is false every read reports a miss, cached or not, so a caller that
    /// branches on a miss must gate on it — `docs/disk-access/IMPLEMENTATION.md` §The trap.
    pub fn nowait_supported(&self) -> bool {
        self.nowait
    }

    pub fn file(&self) -> &File {
        &self.file
    }

    pub fn frame_count(&self) -> u32 {
        self.index.len() as u32
    }

    pub fn metadata_json(&self) -> &str {
        &self.metadata
    }

    /// No I/O, so an out-of-range ask is refused before a stream is opened.
    pub fn frame_span(&self, index: u32) -> Result<FrameSpan> {
        self.index
            .get(index as usize)
            .map(|&(offset, len)| FrameSpan { offset, len })
            .with_context(|| format!("frame index {index} out of range ({})", self.frame_count()))
    }

    /// Never waits, which is what makes it safe on the executor. A short return means the
    /// rest must be read where blocking is allowed; `0` also means the flag was refused.
    pub fn read_at_nowait(&self, buf: &mut [u8], offset: u64) -> Result<usize> {
        if !self.nowait {
            return Ok(0);
        }
        #[cfg(test)]
        let buf = {
            let end = self.nowait_cap.unwrap_or(buf.len()).min(buf.len());
            &mut buf[..end]
        };
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

    /// Call from a blocking pool, never the executor.
    pub fn read_at_blocking(&self, buf: &mut [u8], offset: u64) -> Result<()> {
        self.file
            .read_exact_at(buf, offset)
            .with_context(|| format!("read {} bytes at {offset}", buf.len()))
    }

    /// Force a partial hit: real bytes at the front, a shortfall behind them.
    #[cfg(test)]
    pub(crate) fn force_short_reads(&mut self, cap: usize) {
        self.nowait_cap = Some(cap);
    }

    /// Force a miss, as a filesystem refusing the flag does. Eviction is not a lever a test
    /// can rely on — CLAUDE.md#measurement.
    #[cfg(test)]
    pub(crate) fn force_pool_reads(&mut self) {
        self.nowait = false;
    }

    #[cfg(test)]
    pub(crate) fn account_pool_start(&self) {
        self.pool_starts.fetch_add(1, Ordering::SeqCst);
    }

    #[cfg(test)]
    pub(crate) fn pool_starts(&self) -> usize {
        self.pool_starts.load(Ordering::SeqCst)
    }

    #[cfg(test)]
    pub(crate) fn reset_pool_starts(&self) {
        self.pool_starts.store(0, Ordering::SeqCst);
    }
}

/// `EAGAIN` counts as support — the flag working on a cold byte. Anything unexpected reads
/// as no fast path, so the serving loop takes the conservative route.
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

/// The same probe `FrameStore::open` runs, so `tools/check-fastpath` cannot answer
/// differently from the server. `path` may be a **directory** — support is a property of the
/// mount — in which case a probe file is created inside it and removed.
pub fn nowait_supported_at(path: &Path) -> Result<bool> {
    let meta = std::fs::metadata(path).with_context(|| format!("stat {}", path.display()))?;
    if !meta.is_dir() {
        let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
        return Ok(probe_nowait(&file, 0));
    }
    let probe = path.join(format!(".wtpacs-fastpath-probe.{}", std::process::id()));
    let file = File::options()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&probe)
        .with_context(|| format!("create probe file in {}", path.display()))?;
    let wrote = file.write_at(&[0u8; 4096], 0);
    let answer = wrote.map(|_| probe_nowait(&file, 0));
    drop(file);
    let _ = std::fs::remove_file(&probe);
    answer.with_context(|| format!("write probe file in {}", path.display()))
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

    /// Two frames of different lengths — the smallest case that catches a reader computing
    /// offsets by arithmetic instead of through the index.
    #[test]
    fn round_trip_from_writer() -> Result<()> {
        let f0 = b"frame-0";
        let f1 = b"frame-1-longer";
        let path = scratch("frame-store");
        write_bundle(
            &path,
            br#"{"frameCount":2}"#,
            &[f0.as_slice(), f1.as_slice()],
        )?;

        let store = FrameStore::open(&path)?;
        assert_eq!(store.frame_count(), 2);
        assert_eq!(store.metadata_json(), r#"{"frameCount":2}"#);
        assert!(store.frame_span(99).is_err());

        for (index, want) in [(0u32, f0.as_slice()), (1, f1.as_slice())] {
            let span = store.frame_span(index)?;
            let mut buf = vec![0u8; span.len as usize];
            store.read_at_blocking(&mut buf, span.offset)?;
            assert_eq!(buf, want, "frame {index}");
        }
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    /// `check-fastpath` is only worth running if it answers what the server will decide, so
    /// this pins the agreement rather than trusting the shared `probe_nowait`.
    #[test]
    fn the_standalone_probe_agrees_with_the_store() -> Result<()> {
        let path = scratch("frame-store-probe-agrees");
        write_bundle(&path, br#"{"frameCount":1}"#, &[b"x".as_slice()])?;
        let store = FrameStore::open(&path)?;

        assert_eq!(
            nowait_supported_at(&path)?,
            store.nowait_supported(),
            "check-fastpath would report a different answer than the server acts on"
        );
        // A directory too: that is how the tool is used, before any study is in place.
        let dir = path.parent().expect("scratch dir");
        assert_eq!(
            nowait_supported_at(dir)?,
            store.nowait_supported(),
            "probing the directory disagrees with probing a file on the same mount"
        );
        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    /// The serving path is only correct if `read_at_blocking` can complete a short
    /// `read_at_nowait` at the offset it stopped at.
    #[test]
    fn nowait_and_blocking_compose_into_the_whole_frame() -> Result<()> {
        let body: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let path = scratch("frame-store-nowait");
        write_bundle(&path, br#"{"frameCount":1}"#, &[body.as_slice()])?;
        let store = FrameStore::open(&path)?;
        let span = store.frame_span(0)?;

        let mut out = vec![0u8; span.len as usize];
        let mut pos = 0usize;
        while pos < out.len() {
            let want = READ_WINDOW.min(out.len() - pos);
            let at = span.offset + pos as u64;
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
