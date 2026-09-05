//! Lab-only helpers for arms and cell controls the product does not need.
//!
//! The `RWF_NOWAIT` reader itself is **not** here: the nowait arms call
//! `FrameStore::read_at_nowait` / `read_at_blocking`, so the lab times the shipped product
//! path rather than a second implementation of it.

use anyhow::{Context, Result};
use exact_server::media::frame_store::host_page_size;
use std::fs::File;
use std::os::unix::io::AsRawFd;

/// One-syscall populate of a mapped range (Linux 5.14+). Faults like a byte-per-page touch
/// loop, so it belongs on a blocking pool, but spends no user time walking the range.
///
/// `madvise` rejects an unaligned start with `EINVAL`, and frames start mid-page, so the
/// range is widened to whole pages — the same rounding `mincore` needs.
pub fn populate_read(bytes: &[u8]) -> Result<()> {
    if bytes.is_empty() {
        return Ok(());
    }
    let page = host_page_size();
    let addr = bytes.as_ptr() as usize;
    let start = addr & !(page - 1);
    let len = (addr + bytes.len() - start).div_ceil(page) * page;
    // SAFETY: `bytes` is a live subrange of the study mmap; widening to page bounds stays
    // inside the mapping because the mapping itself starts and ends on page boundaries.
    let rc = unsafe { libc::madvise(start as *mut libc::c_void, len, libc::MADV_POPULATE_READ) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error()).context("madvise POPULATE_READ");
    }
    Ok(())
}

/// Drop this process's page-table entries for a mapped range (`MADV_DONTNEED` on a private
/// file mapping does not touch the page cache, only our mapping of it).
///
/// Needed to make a cold cell honest: `fadvise(DONTNEED)` refuses to evict page-cache pages
/// that are still mapped, and parsing the SBND header drags read-ahead into the first
/// frames. Unmap first, evict second.
pub fn unmap_pages(bytes: &[u8]) -> Result<()> {
    if bytes.is_empty() {
        return Ok(());
    }
    let page = host_page_size();
    let addr = bytes.as_ptr() as usize;
    let start = (addr + page - 1) & !(page - 1);
    let end = (addr + bytes.len()) & !(page - 1);
    if end <= start {
        return Ok(());
    }
    // SAFETY: whole pages inside a live subrange of the caller's study mmap. The mapping is
    // private and read-only, so re-access simply refaults from the file.
    let rc = unsafe { libc::madvise(start as *mut libc::c_void, end - start, libc::MADV_DONTNEED) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error()).context("madvise DONTNEED");
    }
    Ok(())
}

/// Ask the kernel to start read-ahead on a byte range it would not have guessed.
///
/// The `RWF_NOWAIT` fast path is only fast because kernel read-ahead has already pulled the
/// next pages in, and read-ahead only fires on a pattern it can see. A reader taking the
/// first *N* bytes of each frame and skipping the rest presents no such pattern, so every
/// ask misses. `POSIX_FADV_WILLNEED` states the pattern instead of implying it: it queues
/// the I/O and returns without copying anything, so it is safe on the executor.
///
/// **Layout-independent by construction.** It works on whatever order the bytes are already
/// in, which is the point — a packer that groups related bytes would make it unnecessary,
/// and until that exists this is the only lever that does not need one.
///
/// Advisory: the kernel may ignore it, and a hint issued too late is simply a wasted
/// syscall. Never an error the caller must handle.
pub fn hint_willneed(file: &File, offset: u64, len: usize) {
    if len == 0 {
        return;
    }
    // SAFETY: `posix_fadvise` reads no user memory; a bad range is reported, not undefined.
    unsafe {
        libc::posix_fadvise(
            file.as_raw_fd(),
            offset as libc::off_t,
            len as libc::off_t,
            libc::POSIX_FADV_WILLNEED,
        );
    }
}
