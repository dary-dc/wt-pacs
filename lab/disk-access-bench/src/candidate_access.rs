//! Lab-only helpers for arms and cell controls the product does not need. The `RWF_NOWAIT`
//! reader is deliberately **not** among them — the nowait arms call `FrameStore`'s own, so
//! the lab times the shipped path rather than a second implementation of it.

use crate::study_map::host_page_size;
use anyhow::{Context, Result};
use std::fs::File;
use std::os::unix::io::AsRawFd;

/// One-syscall populate of a mapped range (Linux 5.14+). Faults like a touch loop, so it
/// belongs on a blocking pool. Frames start mid-page and `madvise` rejects an unaligned
/// start, hence the widening.
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

/// Drop this process's page-table entries for a mapped range — the page cache keeps its
/// copy. A cold cell needs this first, because `fadvise(DONTNEED)` will not evict a page
/// that is still mapped: unmap first, evict second.
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

/// Ask the kernel to read ahead on a range it would not have guessed — a strided reader
/// shows no pattern, so every ask misses. Queues the I/O without copying, and is advisory,
/// so it never fails. `docs/disk-layout/ACCESS-PATTERNS.md`.
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
