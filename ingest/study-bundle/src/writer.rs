//! Streams a `.sbnd` bundle to disk one frame at a time.

use crate::format::{check_frame_len, HEADER_SIZE, INDEX_ENTRY_SIZE, MAGIC, VERSION};
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
        for (i, &length) in frame_lengths.iter().enumerate() {
            check_frame_len(i, length)?;
        }

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
        Ok(())
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
mod tests {
    use super::*;
    use crate::format::bundle;

    /// The writer lays a bundle out byte for byte as the format does: header, index of offset
    /// then length, metadata, frames.
    #[test]
    fn the_writer_lays_out_the_format_byte_for_byte() -> Result<()> {
        let meta = br#"{"frameCount":3}"#;
        let frames: [&[u8]; 3] = [b"aaa", b"bbbb", b"cc"];
        let path = std::env::temp_dir().join(format!("sbnd-writer-{}.sbnd", std::process::id()));
        write_bundle(&path, meta, &frames)?;
        let written = std::fs::read(&path)?;
        let _ = std::fs::remove_file(&path);
        assert_eq!(written, bundle(&frames, meta));
        Ok(())
    }

    /// A study with a frame no client would read is refused before anything is written.
    #[test]
    fn the_writer_refuses_an_oversized_frame_naming_it() {
        let path = std::env::temp_dir().join(format!("sbnd-writer-big-{}.sbnd", std::process::id()));
        let too_big = frame_envelope::MAX_CODESTREAM_LEN as u32 + 1;
        let err = BundleWriter::create(&path, b"{}", &[3, too_big]).err().expect("accepted");
        assert!(format!("{err:#}").contains("frame 1 "), "the refusal does not name the frame: {err:#}");
        assert!(!path.exists(), "the refused study was written anyway");
    }
}
