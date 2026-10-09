//! A series, plus the memory mapping the rejected mmap variants need. It lives here and not in
//! `server/` because mmap lost: `docs/adr/disk-access.md`.

use anyhow::{bail, Context, Result};
use series_server::media::frame_store::FrameStore;
use memmap2::Mmap;
use std::ops::Deref;
use std::path::Path;
use std::sync::OnceLock;

/// A `FrameStore` with a mapping over the same file. `Deref`s to the store, so a `pread`
/// variant calls it exactly as the product does and only the mmap variants reach for `frame_slice`.
pub struct SeriesMap {
    store: FrameStore,
    mmap: Mmap,
}

impl SeriesMap {
    pub fn open(path: &Path) -> Result<Self> {
        let store = FrameStore::open(path)?;
        let file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
        // SAFETY: `file` is a series bundle, which is immutable once written; the mapping is
        // only read.
        let mmap = unsafe { Mmap::map(&file) }.context("mmap series bundle")?;
        Ok(Self { store, mmap })
    }

    /// The frame's bytes, straight from the mapping — a major fault where they are cold.
    pub fn frame_slice(&self, index: u32) -> Result<&[u8]> {
        let span = self.store.frame_span(index)?;
        let start = span.offset as usize;
        let end = start + span.len as usize;
        if end > self.mmap.len() {
            bail!(
                "frame {index} runs past the mapping ({start}..{end}, file {})",
                self.mmap.len()
            );
        }
        Ok(&self.mmap[start..end])
    }

    /// The whole data region, for variants that unmap or advise the series as a unit.
    pub fn data_span(&self) -> Result<&[u8]> {
        let first = self.store.frame_span(0)?;
        Ok(&self.mmap[first.offset as usize..])
    }
}

impl Deref for SeriesMap {
    type Target = FrameStore;

    fn deref(&self) -> &FrameStore {
        &self.store
    }
}

/// Host page size from `sysconf(_SC_PAGESIZE)`, fallback 4096. Only the mmap variants need it.
pub fn host_page_size() -> usize {
    static PAGE: OnceLock<usize> = OnceLock::new();
    *PAGE.get_or_init(|| {
        // SAFETY: `sysconf` takes an int and returns a long; no pointers involved.
        let n = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if n > 0 {
            n as usize
        } else {
            4096
        }
    })
}
