//! A study, plus the memory mapping the rejected mmap arms need.
//!
//! `server/` reads with `pread` and has no mapping, which is the decision
//! `docs/disk-access/adr.md` records. The mmap arms are the comparison that produced that
//! decision, so the mapping lives here — in the lab — where re-running the comparison is
//! still possible without putting an unused mapping in the product.

use anyhow::{bail, Context, Result};
use exact_server::media::frame_store::FrameStore;
use memmap2::Mmap;
use std::ops::Deref;
use std::path::Path;
use std::sync::OnceLock;

/// A `FrameStore` with a mapping over the same file.
///
/// `Deref`s to the store, so every `pread` arm calls it exactly as the product does and
/// only the mmap arms reach for `frame_slice`.
pub struct StudyMap {
    store: FrameStore,
    mmap: Mmap,
}

impl StudyMap {
    pub fn open(path: &Path) -> Result<Self> {
        let store = FrameStore::open(path)?;
        let file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
        // SAFETY: `file` is a study bundle, which is immutable once written; the mapping is
        // only read.
        let mmap = unsafe { Mmap::map(&file) }.context("mmap study bundle")?;
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

    /// The whole data region, for arms that unmap or advise the study as a unit.
    pub fn data_span(&self) -> Result<&[u8]> {
        let first = self.store.frame_span(0)?;
        Ok(&self.mmap[first.offset as usize..])
    }
}

impl Deref for StudyMap {
    type Target = FrameStore;

    fn deref(&self) -> &FrameStore {
        &self.store
    }
}

/// Host page size from `sysconf(_SC_PAGESIZE)`, fallback 4096.
///
/// Only the mmap arms need it — page alignment for `madvise`, `mincore` and friends.
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
