//! Shared SBND layout constants and header/index parser.

use anyhow::{bail, Context, Result};
use std::fs::File;
use std::os::unix::fs::FileExt;

pub const MAGIC: &[u8; 4] = b"SBND";
pub const VERSION: u32 = 1;

pub const HEADER_SIZE: usize = 16;
pub const INDEX_ENTRY_SIZE: usize = 12;

/// Everything before the first frame: where each frame lives, and the study metadata.
#[derive(Debug, Clone)]
pub struct ParsedLayout {
    /// Byte offset and length of each frame, in frame order.
    pub index: Vec<(u64, u32)>,
    pub metadata: String,
    /// Offset of the first frame — where the header, index and metadata end.
    pub data_base: usize,
}

impl ParsedLayout {
    pub fn frame_count(&self) -> u32 {
        self.index.len() as u32
    }
}

/// Parse a layout from bytes that already contain the prefix (header, index, metadata).
///
/// `file_len` is the study file's size. Index entries are checked against that, not
/// `bytes.len()`, so `read_layout` can pass only the prefix.
fn parse_layout_checked(bytes: &[u8], file_len: u64) -> Result<ParsedLayout> {
    if bytes.len() < HEADER_SIZE {
        bail!("bundle too small");
    }
    if &bytes[0..4] != MAGIC {
        bail!("invalid magic (expected SBND)");
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into()?);
    if version != VERSION {
        bail!("unsupported bundle version {version}");
    }
    let metadata_len = u32::from_le_bytes(bytes[8..12].try_into()?);
    let frame_count = u32::from_le_bytes(bytes[12..16].try_into()?);
    let index_bytes = frame_count as usize * INDEX_ENTRY_SIZE;
    let header_bytes = HEADER_SIZE + index_bytes;
    let data_base = header_bytes + metadata_len as usize;
    if data_base > bytes.len() {
        bail!("bundle header/metadata extends past file end");
    }

    // Every frame must lie inside the data region. Checked once here so a corrupt bundle is
    // refused when it is opened, not discovered frame by frame while it is being served.
    let mut index = Vec::with_capacity(frame_count as usize);
    for i in 0..frame_count as usize {
        let base = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
        let offset = u64::from_le_bytes(bytes[base..base + 8].try_into()?);
        let length = u32::from_le_bytes(bytes[base + 8..base + 12].try_into()?);
        let end = offset
            .checked_add(u64::from(length))
            .filter(|&end| offset >= data_base as u64 && end <= file_len);
        if end.is_none() {
            bail!(
                "frame {i} index entry (offset {offset}, length {length}) lies outside the data \
                 region ({data_base}..{file_len})"
            );
        }
        index.push((offset, length));
    }

    let metadata = std::str::from_utf8(&bytes[header_bytes..data_base])
        .context("metadata is not UTF-8")?
        .to_owned();

    Ok(ParsedLayout {
        index,
        metadata,
        data_base,
    })
}

pub fn parse_layout(bytes: &[u8]) -> Result<ParsedLayout> {
    parse_layout_checked(bytes, bytes.len() as u64)
}

/// Read a bundle's layout straight from the file.
///
/// Two reads: the fixed header says how long the rest is, then the whole prefix is taken
/// in one go. Index entries are checked against the file's length, not the prefix.
pub fn read_layout(file: &File) -> Result<ParsedLayout> {
    let file_len = file.metadata().context("stat bundle")?.len();
    let mut prefix = vec![0u8; HEADER_SIZE];
    file.read_exact_at(&mut prefix, 0).context("read header")?;
    prefix.resize(prefix_len(&prefix)?, 0);
    file.read_exact_at(&mut prefix, 0).context("read index")?;
    parse_layout_checked(&prefix, file_len)
}

/// Bytes from the start of the file up to the first frame, read off the fixed header.
fn prefix_len(header: &[u8]) -> Result<usize> {
    if header.len() < HEADER_SIZE {
        bail!("bundle too small");
    }
    let metadata_len = u32::from_le_bytes(header[8..12].try_into()?) as usize;
    let frame_count = u32::from_le_bytes(header[12..16].try_into()?) as usize;
    Ok(HEADER_SIZE + frame_count * INDEX_ENTRY_SIZE + metadata_len)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A two-frame bundle in memory, laid out exactly as `BundleWriter` writes it.
    fn bundle(frames: &[&[u8]], metadata: &[u8]) -> Vec<u8> {
        let data_base = HEADER_SIZE + frames.len() * INDEX_ENTRY_SIZE + metadata.len();
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&VERSION.to_le_bytes());
        out.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        out.extend_from_slice(&(frames.len() as u32).to_le_bytes());
        let mut offset = data_base as u64;
        for frame in frames {
            out.extend_from_slice(&offset.to_le_bytes());
            out.extend_from_slice(&(frame.len() as u32).to_le_bytes());
            offset += frame.len() as u64;
        }
        out.extend_from_slice(metadata);
        for frame in frames {
            out.extend_from_slice(frame);
        }
        out
    }

    fn set_entry(bytes: &mut [u8], i: usize, offset: u64, length: u32) {
        let base = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
        bytes[base..base + 8].copy_from_slice(&offset.to_le_bytes());
        bytes[base + 8..base + 12].copy_from_slice(&length.to_le_bytes());
    }

    #[test]
    fn well_formed_bundle_parses() {
        let bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
        let layout = parse_layout(&bytes).unwrap();
        assert_eq!(layout.frame_count(), 2);
        assert_eq!(layout.index[0], (layout.data_base as u64, 3));
        assert_eq!(layout.index[1], (layout.data_base as u64 + 3, 4));
        assert_eq!(layout.metadata, "{}");
    }

    /// An index entry that points past the end of the file is a corrupt bundle. It must be
    /// refused when the bundle is opened, not discovered frame by frame while serving.
    #[test]
    fn index_entry_past_file_end_is_refused_at_parse() {
        let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
        let len = bytes.len();
        set_entry(&mut bytes, 1, len as u64 - 2, 4);
        assert!(
            parse_layout(&bytes).is_err(),
            "frame 1 runs 2 bytes past EOF"
        );

        let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
        set_entry(&mut bytes, 0, u64::MAX - 1, 4);
        assert!(parse_layout(&bytes).is_err(), "offset + length overflows");
    }

    /// Frames live after the metadata; an entry inside the header or index is corrupt too.
    #[test]
    fn index_entry_before_data_base_is_refused_at_parse() {
        let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
        set_entry(&mut bytes, 0, 0, 3);
        assert!(
            parse_layout(&bytes).is_err(),
            "frame 0 points at the header"
        );
    }
}
