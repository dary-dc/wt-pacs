//! Server-side SBND reader: one open study mapped for serving.

use anyhow::{bail, Context, Result};
use bytes::Bytes;
use memmap2::Mmap;
use study_bundle::parse_layout;
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::path::Path;
use std::sync::OnceLock;

pub struct FrameStore {
    file: File,
    /// The whole study, mapped once and held as a refcounted handle.
    ///
    /// `Bytes::from_owner` takes ownership of the `Mmap`, so `slice()` is a refcount
    /// bump — no allocation, no copy — and the send path can hand frame bytes straight
    /// to quinn. It is the *only* mapping on purpose: a second one would have
    /// `touch_frame_pages` faulting pages the send path never reads, doubling both the
    /// fault work and the resident set. See `docs/send-path-copy-costs.md`.
    all: Bytes,
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
        let all = Bytes::from_owner(mmap);
        Ok(Self {
            file,
            all,
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
        std::str::from_utf8(&self.all[start..end]).context("metadata JSON is not UTF-8")
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
        if end > self.all.len() {
            bail!(
                "frame {index} slice out of bounds ({start}..{end}, file {})",
                self.all.len()
            );
        }
        Ok(&self.all[start..end])
    }

    /// Frame payload as a refcounted slice of the mapping — no allocation, no copy.
    ///
    /// The counterpart of `frame_slice` for the chunked send path: `Bytes` can be handed
    /// straight to `quinn::SendStream::write_all_chunks`, which moves it into the
    /// connection's send buffer instead of copying it there.
    pub fn frame_bytes(&self, index: u32) -> Result<Bytes> {
        let (offset, length) = self.frame_range(index)?;
        let start = offset as usize;
        let end = start + length as usize;
        // Explicit, because `Bytes::slice` panics rather than erroring on a short file.
        if end > self.all.len() {
            bail!(
                "frame {index} slice out of bounds ({start}..{end}, file {})",
                self.all.len()
            );
        }
        Ok(self.all.slice(start..end))
    }

    /// Fault every page of `index` into the page cache.
    ///
    /// Call this from a **blocking** pool (`spawn_blocking`), not on the async executor: a cold
    /// fault is not an `.await`, so it stalls every task sharing the OS thread. After this returns,
    /// `frame_slice` + `write_all` on the executor should not take major faults for that frame.
    ///
    /// One byte per host page (plus the last byte). No copy, no second mapping.
    pub fn touch_frame_pages(&self, index: u32) -> Result<()> {
        touch_pages(self.frame_slice(index)?);
        Ok(())
    }

    /// Read frame bytes with `pread` into `buf` (must be exactly frame length).
    ///
    /// Always copies into userspace. Escape hatch when a hard reclaim guarantee outweighs the
    /// extra copy (see `docs/disk-access/adr.md`). Safe to call from a blocking pool.
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

/// Touch one byte per page so the kernel faults the range now, not during a later read.
pub fn touch_pages(bytes: &[u8]) {
    let page = host_page_size();
    let mut acc = 0u8;
    for chunk in bytes.chunks(page) {
        acc ^= chunk[0];
    }
    if let Some(last) = bytes.last() {
        acc ^= *last;
    }
    std::hint::black_box(acc);
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_bundle::write_bundle;
    use std::time::{SystemTime, UNIX_EPOCH};

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
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let path = std::env::temp_dir().join(format!("frame-store-{stamp}.sbnd"));
        write_bundle(&path, meta, &[f0.as_slice(), f1.as_slice()])?;

        let store = FrameStore::open(&path)?;
        assert_eq!(store.frame_count(), 2);
        assert_eq!(store.metadata_json()?, r#"{"frameCount":2}"#);
        assert_eq!(store.frame_slice(0)?, f0);
        assert_eq!(store.frame_slice(1)?, f1);
        assert_eq!(&store.frame_bytes(0)?[..], f0);
        assert_eq!(&store.frame_bytes(1)?[..], f1);
        assert!(store.frame_bytes(99).is_err());
        store.touch_frame_pages(0)?;
        store.touch_frame_pages(1)?;
        let mut buf = vec![0u8; f0.len()];
        store.pread_frame(0, &mut buf)?;
        assert_eq!(buf, f0);
        assert!(store.frame_slice(99).is_err());
        let _ = std::fs::remove_file(path);
        Ok(())
    }
}
