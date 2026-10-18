//! Server-side SBND reader. Why `pread` and not a memory mapping: `docs/adr/disk-access.md`.

use anyhow::{Context, Result};
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::os::unix::io::AsRawFd;
use std::path::Path;
use series_bundle::read_layout;

/// Where a frame's codestream lives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameSpan {
    pub offset: u64,
    pub len: u32,
}

/// **Open once per series, never per session.** `docs/adr/disk-access.md` §Invariants.
pub struct FrameStore {
    file: File,
    index: Vec<(u64, u32)>,
    nowait: bool,
    #[cfg(test)]
    hooks: TestHooks,
}

impl FrameStore {
    pub fn open(series_path: &Path) -> Result<Self> {
        let file = File::open(series_path)
            .with_context(|| format!("open series bundle {}", series_path.display()))?;
        let layout = read_layout(&file)
            .with_context(|| format!("read layout of {}", series_path.display()))?;
        Ok(Self::with_index(file, layout.index, layout.data_base as u64))
    }

    /// A series whose table another container's parser read: `lab/container-bench`.
    /// Every entry must lie inside `file`; nothing here checks it.
    pub fn with_index(file: File, index: Vec<(u64, u32)>, probe_at: u64) -> Self {
        Self {
            nowait: probe_nowait(&file, probe_at),
            file,
            index,
            #[cfg(test)]
            hooks: TestHooks::default(),
        }
    }

    /// Where this is false every read reports a miss, cached or not, so a caller that
    /// branches on a miss must gate on it — `docs/adr/disk-access.md` §The trap.
    pub fn nowait_supported(&self) -> bool {
        self.nowait
    }

    #[cfg(feature = "uring")]
    pub fn file(&self) -> &File {
        &self.file
    }

    pub fn frame_count(&self) -> u32 {
        self.index.len() as u32
    }

    /// Panics past `frame_count()`: the planner refuses out of range before anything reads.
    pub fn frame_span(&self, index: u32) -> FrameSpan {
        let (offset, len) = self.index[index as usize];
        FrameSpan { offset, len }
    }

    /// Never waits, which is what makes it safe on the executor. A short return means the
    /// rest must be read where blocking is allowed; `0` also means the flag was refused.
    pub fn read_at_nowait(&self, buf: &mut [u8], offset: u64) -> Result<usize> {
        if !self.nowait {
            return Ok(0);
        }
        #[cfg(test)]
        let buf = self.hooks.cap(buf);
        let mut done = 0usize;
        while done < buf.len() {
            match preadv2_nowait(&self.file, &mut buf[done..], offset + done as u64) {
                Ok(0) => return Ok(done), // end of file, or nothing more available without waiting
                Ok(n) => done += n,
                Err(err) => {
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
            }
        }
        Ok(done)
    }

    /// Advisory: ask the kernel to bring `len` bytes from `offset` into the page cache. It
    /// copies nothing and never fails a read, so the result is not checked.
    pub fn advise_ahead(&self, offset: u64, len: u64) {
        #[cfg(test)]
        self.hooks.record_advice(offset, len);
        // SAFETY: `posix_fadvise` reads no user memory; a bad range is an errno, not UB.
        unsafe {
            libc::posix_fadvise(
                self.file.as_raw_fd(),
                offset as libc::off_t,
                len as libc::off_t,
                libc::POSIX_FADV_WILLNEED,
            );
        }
    }

    /// Call from a blocking pool, never the executor.
    pub fn read_at_blocking(&self, buf: &mut [u8], offset: u64) -> Result<()> {
        #[cfg(test)]
        self.hooks.fail_read(buf.len(), offset)?;
        self.file
            .read_exact_at(buf, offset)
            .with_context(|| format!("read {} bytes at {offset}", buf.len()))
    }

    /// Force a miss, as a filesystem refusing the flag does. Eviction is not a lever a test or
    /// a lab run can rely on — CLAUDE.md#measurement. Reachable in a build for `--force-pool-reads`.
    pub fn force_pool_reads(&mut self) {
        self.nowait = false;
    }
}

/// `EAGAIN` counts as support — the flag working on a cold byte. Anything unexpected reads
/// as no fast path, so the serving loop takes the conservative route.
fn probe_nowait(file: &File, offset: u64) -> bool {
    match preadv2_nowait(file, &mut [0u8; 1], offset) {
        Ok(_) => true,
        Err(err) => err.raw_os_error() == Some(libc::EAGAIN),
    }
}

fn preadv2_nowait(file: &File, buf: &mut [u8], offset: u64) -> std::io::Result<usize> {
    let iov = libc::iovec {
        iov_base: buf.as_mut_ptr() as *mut libc::c_void,
        iov_len: buf.len(),
    };
    // SAFETY: `iov` describes `buf`, live and exclusively borrowed for the call.
    let n = unsafe {
        libc::preadv2(file.as_raw_fd(), &iov, 1, offset as libc::off_t, libc::RWF_NOWAIT)
    };
    if n < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(n as usize)
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
use std::sync::{atomic::{AtomicUsize, Ordering}, Mutex};

/// 64 KiB, a size tests make frames span several of. `docs/adr/disk-access.md`.
#[cfg(test)]
pub(crate) const TEST_CHUNK: usize = 64 * 1024;

#[cfg(test)]
#[derive(Default)]
struct TestHooks {
    /// Ceiling on one `read_at_nowait`, for forcing a partial hit.
    nowait_cap: Option<usize>,
    pool_starts: AtomicUsize,
    advised: Mutex<Vec<(u64, u64)>>,
    failing_reads: AtomicUsize,
}

#[cfg(test)]
impl TestHooks {
    fn cap<'b>(&self, buf: &'b mut [u8]) -> &'b mut [u8] {
        let end = self.nowait_cap.unwrap_or(buf.len()).min(buf.len());
        &mut buf[..end]
    }

    fn record_advice(&self, offset: u64, len: u64) {
        self.advised.lock().unwrap().push((offset, len));
    }

    fn fail_read(&self, len: usize, offset: u64) -> Result<()> {
        let fail = |n: usize| n.checked_sub(1);
        if self.failing_reads.fetch_update(Ordering::SeqCst, Ordering::SeqCst, fail).is_ok() {
            anyhow::bail!("read {len} bytes at {offset}: failed by the test lever");
        }
        Ok(())
    }
}

#[cfg(test)]
impl FrameStore {
    /// Force a partial hit: real bytes at the front, a shortfall behind them.
    pub(crate) fn force_short_reads(&mut self, cap: usize) {
        self.hooks.nowait_cap = Some(cap);
    }

    /// Fail the next `n` blocking reads, as a device error does.
    pub(crate) fn fail_blocking_reads(&self, n: usize) {
        self.hooks.failing_reads.store(n, Ordering::SeqCst);
    }

    pub(crate) fn account_pool_start(&self) {
        self.hooks.pool_starts.fetch_add(1, Ordering::SeqCst);
    }

    pub(crate) fn pool_starts(&self) -> usize {
        self.hooks.pool_starts.load(Ordering::SeqCst)
    }

    pub(crate) fn reset_pool_starts(&self) {
        self.hooks.pool_starts.store(0, Ordering::SeqCst);
    }

    pub(crate) fn take_advice(&self) -> Vec<(u64, u64)> {
        std::mem::take(&mut *self.hooks.advised.lock().unwrap())
    }
}

#[cfg(test)]
mod tests;
