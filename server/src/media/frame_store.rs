//! Server-side SBND reader: one open study mapped for serving.

use anyhow::{bail, Context, Result};
use memmap2::{Advice, Mmap};
use study_bundle::parse_layout;
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::path::Path;

pub struct FrameStore {
    file: File,
    mmap: Mmap,
    frame_count: u32,
    metadata_len: u32,
    data_base: usize,
    index: Vec<(u64, u32)>,
}

impl FrameStore {
    pub fn open(study_path: &Path) -> Result<Self> {
        let file = File::open(study_path)
            .with_context(|| format!("open study bundle {}", study_path.display()))?;
        // SAFETY: `file` keeps the fd open; bundle must not be truncated while mapped.
        let mmap = unsafe { Mmap::map(&file).context("mmap study bundle")? };
        let parsed = parse_layout(&mmap)?;
        Ok(Self {
            file,
            mmap,
            frame_count: parsed.frame_count,
            metadata_len: parsed.metadata_len,
            data_base: parsed.data_base,
            index: parsed.index,
        })
    }

    pub fn frame_count(&self) -> u32 {
        self.frame_count
    }

    pub fn metadata_json(&self) -> Result<&str> {
        let start = self.data_base - self.metadata_len as usize;
        let end = self.data_base;
        std::str::from_utf8(&self.mmap[start..end]).context("metadata JSON is not UTF-8")
    }

    /// Byte offset and length of frame payload in the SBND file.
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

    /// First `max_bytes` of frame `index` (or the whole frame if shorter).
    ///
    /// Lab / progressive-style access: HTJ2K often only needs early bytes for a first layer.
    pub fn frame_prefix_slice(&self, index: u32, max_bytes: usize) -> Result<&[u8]> {
        let full = self.frame_slice(index)?;
        Ok(&full[..full.len().min(max_bytes)])
    }

    /// Fault every page of `index` into the page cache.
    ///
    /// Call this from a **blocking** pool (`spawn_blocking`), not on the async executor: a cold
    /// fault is not an `.await`, so it stalls every task sharing the OS thread. After this returns,
    /// `frame_slice` + `write_all` on the executor should not take major faults for that frame.
    ///
    /// One byte per 4 KiB (plus the last byte). No copy, no second mapping.
    pub fn touch_frame_pages(&self, index: u32) -> Result<()> {
        touch_pages(self.frame_slice(index)?);
        Ok(())
    }

    /// Fault pages covering the first `max_bytes` of `index` (partial / first-layer access).
    pub fn touch_frame_prefix_pages(&self, index: u32, max_bytes: usize) -> Result<()> {
        touch_pages(self.frame_prefix_slice(index, max_bytes)?);
        Ok(())
    }

    /// `true` if every page backing `index` is currently resident (page-cache / RAM).
    ///
    /// Uses `mincore(2)`. Safe to call on the async executor — it does not fault pages in.
    /// On error (unsupported FS, etc.) returns `Ok(false)` so callers take the slow/safe path.
    pub fn frame_pages_resident(&self, index: u32) -> Result<bool> {
        let slice = self.frame_slice(index)?;
        Ok(pages_resident(slice).unwrap_or(false))
    }

    /// `true` if every page covering the first `max_bytes` of `index` is resident.
    pub fn frame_prefix_pages_resident(&self, index: u32, max_bytes: usize) -> Result<bool> {
        let slice = self.frame_prefix_slice(index, max_bytes)?;
        Ok(pages_resident(slice).unwrap_or(false))
    }

    /// Ensure pages for `index` are resident: no-op if `mincore` says hot, else `touch_frame_pages`.
    ///
    /// The touch half must still run on a blocking pool when this returns that work is needed;
    /// use [`Self::frame_pages_resident`] on the executor and only `spawn_blocking` when cold.
    pub fn touch_frame_pages_if_cold(&self, index: u32) -> Result<()> {
        if self.frame_pages_resident(index)? {
            return Ok(());
        }
        self.touch_frame_pages(index)
    }

    /// `madvise(WILLNEED)` for one frame's byte range. Advisory — the kernel may ignore it.
    pub fn advise_frame_willneed(&self, index: u32) -> Result<()> {
        let (offset, length) = self.frame_range(index)?;
        self.mmap
            .advise_range(Advice::WillNeed, offset as usize, length as usize)
            .context("madvise WILLNEED")?;
        Ok(())
    }

    /// Read frame bytes with `pread` into `buf` (must be exactly frame length).
    ///
    /// Always copies into userspace. Safe to call from a blocking pool.
    pub fn pread_frame(&self, index: u32, buf: &mut [u8]) -> Result<()> {
        let (offset, length) = self.frame_range(index)?;
        if buf.len() != length as usize {
            bail!(
                "pread_frame buf len {} != frame {index} len {length}",
                buf.len()
            );
        }
        self.file
            .read_exact_at(buf, offset)
            .with_context(|| format!("pread frame {index} at {offset}"))?;
        Ok(())
    }

    /// `pread` the first `buf.len()` bytes of frame `index` (capped at frame length).
    pub fn pread_frame_prefix(&self, index: u32, buf: &mut [u8]) -> Result<()> {
        let (offset, length) = self.frame_range(index)?;
        let n = buf.len().min(length as usize);
        self.file
            .read_exact_at(&mut buf[..n], offset)
            .with_context(|| format!("pread frame {index} prefix {n} at {offset}"))?;
        Ok(())
    }
}

/// Touch one byte per page so the kernel faults the range now, not during a later read.
pub fn touch_pages(bytes: &[u8]) {
    let mut acc = 0u8;
    for page in bytes.chunks(4096) {
        acc ^= page[0];
    }
    if let Some(last) = bytes.last() {
        acc ^= *last;
    }
    std::hint::black_box(acc);
}

const PAGE_SIZE: usize = 4096;

/// `mincore` over the pages spanning `bytes`. `None` if the syscall fails.
fn pages_resident(bytes: &[u8]) -> Option<bool> {
    if bytes.is_empty() {
        return Some(true);
    }
    let addr = bytes.as_ptr() as usize;
    let end = addr + bytes.len();
    let start = addr & !(PAGE_SIZE - 1);
    let len = end.saturating_sub(start);
    let len = len.div_ceil(PAGE_SIZE) * PAGE_SIZE;
    let n_pages = len / PAGE_SIZE;
    let mut vec = vec![0u8; n_pages];
    // SAFETY: `start`..`start+len` covers mapped pages of `bytes` (mmap region).
    let rc = unsafe { libc::mincore(start as *mut libc::c_void, len, vec.as_mut_ptr()) };
    if rc != 0 {
        return None;
    }
    // LSB set => page resident.
    Some(vec.iter().all(|&b| b & 1 != 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_bundle::write_bundle;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn round_trip_from_writer() -> Result<()> {
        let meta = br#"{"frameCount":2}"#;
        let f0 = b"frame-0";
        let f1 = b"frame-1-longer";
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let path = std::env::temp_dir().join(format!("frame-store-{stamp}.sbnd"));
        write_bundle(&path, meta, &[f0.as_slice(), f1.as_slice()])?;

        let store = FrameStore::open(&path)?;
        assert_eq!(store.frame_count(), 2);
        assert_eq!(store.metadata_json()?, r#"{"frameCount":2}"#);
        assert_eq!(store.frame_slice(0)?, f0);
        assert_eq!(store.frame_slice(1)?, f1);
        store.touch_frame_pages(0)?;
        store.touch_frame_pages(1)?;
        assert!(store.frame_pages_resident(0)?);
        store.touch_frame_pages_if_cold(0)?;
        let mut buf = vec![0u8; f0.len()];
        store.pread_frame(0, &mut buf)?;
        assert_eq!(buf, f0);
        assert_eq!(store.frame_prefix_slice(1, 5)?, &f1[..5]);
        store.touch_frame_prefix_pages(1, 5)?;
        assert!(store.frame_prefix_pages_resident(1, 5)?);
        let mut pref = [0u8; 5];
        store.pread_frame_prefix(1, &mut pref)?;
        assert_eq!(&pref, &f1[..5]);
        store.advise_frame_willneed(1)?;
        let _ = std::fs::remove_file(path);
        Ok(())
    }
}
