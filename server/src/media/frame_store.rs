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
