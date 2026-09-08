//! Helpers for arms and cell controls the product does not need. The `RWF_NOWAIT` reader is
//! deliberately not among them: the nowait arms call `FrameStore`'s own.

use crate::study_map::host_page_size;
use anyhow::{Context, Result};
use std::fs::File;
use std::os::unix::io::AsRawFd;

/// Faults like a touch loop, so it belongs on a blocking pool. `madvise` rejects an
/// unaligned start and frames begin mid-page, hence the widening.
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

/// A cold cell needs this first: `fadvise(DONTNEED)` will not evict a mapped page.
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

/// A strided reader shows no pattern for read-ahead to see, so every ask misses. Advisory,
/// and it copies nothing. `docs/disk-layout/ACCESS-PATTERNS.md`.
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
