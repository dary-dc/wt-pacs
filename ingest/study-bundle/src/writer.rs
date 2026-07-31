//! Streams a `.sbnd` bundle to disk one frame at a time.

use crate::format::{HEADER_SIZE, INDEX_ENTRY_SIZE, MAGIC, VERSION};
use anyhow::{bail, Context, Result};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

pub struct BundleWriter {
    out: BufWriter<File>,
    lengths: Vec<u32>,
    written: usize,
}

impl BundleWriter {
    pub fn create(path: &Path, metadata: &[u8], frame_lengths: &[u32]) -> Result<Self> {
        let frame_count = frame_lengths.len() as u32;
        let metadata_len = metadata.len() as u32;
        let index_bytes = frame_lengths.len() * INDEX_ENTRY_SIZE;
        let data_base = HEADER_SIZE + index_bytes + metadata.len();

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("create bundle parent dir")?;
        }
        let file = File::create(path).with_context(|| format!("create {}", path.display()))?;
        let mut out = BufWriter::new(file);

        out.write_all(MAGIC)?;
        out.write_all(&VERSION.to_le_bytes())?;
        out.write_all(&metadata_len.to_le_bytes())?;
        out.write_all(&frame_count.to_le_bytes())?;

        let mut offset = data_base as u64;
        for &length in frame_lengths {
            out.write_all(&offset.to_le_bytes())?;
            out.write_all(&length.to_le_bytes())?;
            offset += u64::from(length);
        }

        out.write_all(metadata)?;

        Ok(Self {
            out,
            lengths: frame_lengths.to_vec(),
            written: 0,
        })
    }

    pub fn write_frame(&mut self, bytes: &[u8]) -> Result<()> {
        let expected = *self
