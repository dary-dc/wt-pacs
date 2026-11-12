//! Streams a `.sbnd` bundle to disk one frame at a time.

use crate::format::{check_frame_len, HEADER_SIZE, INDEX_ENTRY_SIZE, MAGIC, VERSION};
use anyhow::{bail, Context, Result};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

/// Writes `NAME.partial` and renames it over `NAME` in `finish`; dropped unfinished, it removes the partial.
pub struct BundleWriter {
    out: BufWriter<File>,
    lengths: Vec<u32>,
    written: usize,
    partial: PathBuf,
    path: PathBuf,
    finished: bool,
}

impl BundleWriter {
    pub fn create(path: &Path, metadata: &[u8], frame_lengths: &[u32]) -> Result<Self> {
        let frame_count = frame_lengths.len() as u32;
        let metadata_len = metadata.len() as u32;
        let index_bytes = frame_lengths.len() * INDEX_ENTRY_SIZE;
        let data_base = HEADER_SIZE + index_bytes + metadata.len();
        for (i, &length) in frame_lengths.iter().enumerate() {
            check_frame_len(i, length)?;
        }

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("create bundle parent dir")?;
        }
        let mut partial = path.as_os_str().to_owned();
        partial.push(".partial");
        let partial = PathBuf::from(partial);
        let file = File::create(&partial).with_context(|| format!("create {}", partial.display()))?;
        let mut writer = Self {
            out: BufWriter::new(file),
            lengths: frame_lengths.to_vec(),
            written: 0,
            partial,
            path: path.to_path_buf(),
            finished: false,
        };
        let out = &mut writer.out;

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
        Ok(writer)
    }

    pub fn write_frame(&mut self, bytes: &[u8]) -> Result<()> {
        let expected = *self
            .lengths
            .get(self.written)
            .with_context(|| format!("frame {} is past the declared count", self.written))?;
        if bytes.len() as u32 != expected {
            bail!(
                "frame {} length changed after the index was written: declared {expected}, got {}",
                self.written,
                bytes.len()
            );
        }
        self.out.write_all(bytes)?;
        self.written += 1;
        Ok(())
    }

    pub fn finish(mut self) -> Result<()> {
        if self.written != self.lengths.len() {
            bail!(
                "bundle incomplete: {} of {} frames written",
                self.written,
                self.lengths.len()
            );
        }
        self.out.flush().context("flush bundle")?;
        std::fs::rename(&self.partial, &self.path)
            .with_context(|| format!("rename {} to {}", self.partial.display(), self.path.display()))?;
        self.finished = true;
        Ok(())
    }
}

impl Drop for BundleWriter {
    fn drop(&mut self) {
        if !self.finished {
            let _ = std::fs::remove_file(&self.partial);
        }
    }
}

pub fn write_bundle(path: &Path, metadata: &[u8], frames: &[&[u8]]) -> Result<()> {
    let lengths: Vec<u32> = frames.iter().map(|f| f.len() as u32).collect();
    let mut writer = BundleWriter::create(path, metadata, &lengths)?;
    for frame in frames {
        writer.write_frame(frame)?;
    }
    writer.finish()
}

#[cfg(test)]
mod tests;
