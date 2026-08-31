//! Lab-only helpers for arms the product ADR rejected as defaults.
//!
//! Kept here so `exact-server::FrameStore` stays essentialist (mmap + touch + `pread` escape).
//! Restore this crate from git to re-run hybrid / WILLNEED comparisons.

use anyhow::{Context, Result};
use exact_server::media::frame_store::{host_page_size, FrameStore};

/// `mincore` residency probe — safe on the executor (does not fault pages in).
pub fn frame_pages_resident(store: &FrameStore, index: u32) -> Result<bool> {
    let slice = store.frame_slice(index)?;
    Ok(pages_resident(slice).unwrap_or(false))
}

/// `madvise(WILLNEED)` over one frame's mapped range. Advisory; kernel may ignore.
pub fn advise_frame_willneed(store: &FrameStore, index: u32) -> Result<()> {
    let slice = store.frame_slice(index)?;
    if slice.is_empty() {
        return Ok(());
    }
    // SAFETY: `slice` is a live subrange of the study mmap held by `store`.
    let rc = unsafe {
        libc::madvise(
            slice.as_ptr() as *mut libc::c_void,
            slice.len(),
            libc::MADV_WILLNEED,
        )
    };
    if rc != 0 {
        return Err(std::io::Error::last_os_error()).context("madvise WILLNEED");
    }
    Ok(())
}

fn pages_resident(bytes: &[u8]) -> Option<bool> {
    if bytes.is_empty() {
        return Some(true);
    }
    let page = host_page_size();
    let addr = bytes.as_ptr() as usize;
    let end = addr + bytes.len();
    let start = addr & !(page - 1);
    let len = end.saturating_sub(start);
    let len = len.div_ceil(page) * page;
    let n_pages = len / page;
    let mut vec = vec![0u8; n_pages];
    // SAFETY: covers mapped pages of `bytes` within the study mmap.
    let rc = unsafe { libc::mincore(start as *mut libc::c_void, len, vec.as_mut_ptr()) };
    if rc != 0 {
        return None;
    }
    Some(vec.iter().all(|&b| b & 1 != 0))
}

/// No-op if `mincore` says hot, else `touch_frame_pages`.
#[allow(dead_code)]
pub fn touch_frame_pages_if_cold(store: &FrameStore, index: u32) -> Result<()> {
    if frame_pages_resident(store, index)? {
        return Ok(());
    }
    store.touch_frame_pages(index)
}
