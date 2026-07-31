//! Server-side SBND reader: one open study mapped for serving.

use anyhow::{bail, Context, Result};
use memmap2::Mmap;
use study_bundle::parse_layout;
use std::fs::File;
use std::path::Path;

pub struct FrameStore {
    _file: File,
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
        // SAFETY: `_file` keeps the fd open; bundle must not be truncated while mapped.
        let mmap = unsafe { Mmap::map(&file).context("mmap study bundle")? };
        let parsed = parse_layout(&mmap)?;
        Ok(Self {
            _file: file,
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

    pub fn frame_slice(&self, index: u32) -> Result<&[u8]> {
        let (offset, length) = self
            .index
            .get(index as usize)
