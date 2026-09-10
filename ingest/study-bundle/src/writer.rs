//! Streams a `.sbnd` bundle to disk one frame at a time.

use crate::format::{aligned_frame_starts, HEADER_SIZE, INDEX_ENTRY_SIZE, MAGIC, VERSION};
use anyhow::{bail, Context, Result};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

pub struct BundleWriter {
    out: BufWriter<File>,
    lengths: Vec<u32>,
    starts: Vec<u64>,
    written: usize,
}

fn write_pad(out: &mut BufWriter<File>, n: u64) -> Result<()> {
    const Z: &[u8] = &[0u8; 4096];
    let mut left = n;
    while left > 0 {
        let chunk = usize::try_from(left.min(Z.len() as u64)).expect("chunk ≤ 4096");
        out.write_all(&Z[..chunk])?;
        left -= chunk as u64;
    }
    Ok(())
}

impl BundleWriter {
    pub fn create(path: &Path, metadata: &[u8], frame_lengths: &[u32]) -> Result<Self> {
        let frame_count = frame_lengths.len() as u32;
        let metadata_len = metadata.len() as u32;
        let index_bytes = frame_lengths.len() * INDEX_ENTRY_SIZE;
        let data_base = (HEADER_SIZE + index_bytes + metadata.len()) as u64;
        let starts = aligned_frame_starts(data_base, frame_lengths);

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("create bundle parent dir")?;
        }
        let file = File::create(path).with_context(|| format!("create {}", path.display()))?;
        let mut out = BufWriter::new(file);

        out.write_all(MAGIC)?;
        out.write_all(&VERSION.to_le_bytes())?;
        out.write_all(&metadata_len.to_le_bytes())?;
        out.write_all(&frame_count.to_le_bytes())?;

        for (&offset, &length) in starts.iter().zip(frame_lengths) {
            out.write_all(&offset.to_le_bytes())?;
            out.write_all(&length.to_le_bytes())?;
        }

        out.write_all(metadata)?;
        if let Some(&first) = starts.first() {
            write_pad(&mut out, first - data_base)?;
        }

        Ok(Self {
            out,
            lengths: frame_lengths.to_vec(),
            starts,
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
        if let Some(&next) = self.starts.get(self.written) {
            let end = self.starts[self.written - 1] + u64::from(expected);
            write_pad(&mut self.out, next - end)?;
        }
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
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn streamed_write_matches_buffered_write() -> Result<()> {
        let meta = br#"{"frameCount":3}"#;
        let frames: [&[u8]; 3] = [b"aaa", b"bbbb", b"cc"];
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let a = std::env::temp_dir().join(format!("sbnd-buffered-{stamp}.sbnd"));
        let b = std::env::temp_dir().join(format!("sbnd-streamed-{stamp}.sbnd"));

        write_bundle(&a, meta, &frames)?;

        let lengths: Vec<u32> = frames.iter().map(|f| f.len() as u32).collect();
        let mut w = BundleWriter::create(&b, meta, &lengths)?;
        for frame in frames {
            w.write_frame(frame)?;
        }
        w.finish()?;

        assert_eq!(std::fs::read(&a)?, std::fs::read(&b)?);
        let _ = std::fs::remove_file(a);
        let _ = std::fs::remove_file(b);
        Ok(())
    }

    /// A miss is billed in pages. New packs start every frame on one so the extra page at
    /// an unaligned start is not paid; the index length stays the codestream, not the pad.
    #[test]
    fn a_new_bundle_starts_every_frame_on_a_page() -> Result<()> {
        use crate::format::{read_layout, FRAME_ALIGN};
        use std::os::unix::fs::FileExt;

        let meta = br#"{"frameCount":3}"#;
        let frames: [&[u8]; 3] = [b"aaa", b"bbbb-longer", &(0u8..200).collect::<Vec<_>>()];
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let path = std::env::temp_dir().join(format!("sbnd-aligned-{stamp}.sbnd"));
        write_bundle(&path, meta, &frames)?;

        let file = File::open(&path)?;
        let layout = read_layout(&file)?;
        assert_eq!(layout.frame_count(), 3);
        for (i, &(offset, len)) in layout.index.iter().enumerate() {
            assert_eq!(
                offset % FRAME_ALIGN,
                0,
                "frame {i} starts mid-page at {offset}"
            );
            assert_eq!(
                len as usize,
                frames[i].len(),
                "frame {i} length includes pad"
            );
            let mut buf = vec![0u8; len as usize];
            file.read_exact_at(&mut buf, offset)?;
            assert_eq!(buf, frames[i], "frame {i} bytes");
        }
        let _ = std::fs::remove_file(path);
        Ok(())
    }
}
