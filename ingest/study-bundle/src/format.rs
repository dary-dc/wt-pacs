//! Shared SBND layout constants and header/index parser.

use anyhow::{bail, Result};

pub const MAGIC: &[u8; 4] = b"SBND";
pub const VERSION: u32 = 1;

pub const HEADER_SIZE: usize = 16;
pub const INDEX_ENTRY_SIZE: usize = 12;

#[derive(Debug, Clone)]
pub struct ParsedLayout {
    pub frame_count: u32,
    pub metadata_len: u32,
    pub data_base: usize,
    pub index: Vec<(u64, u32)>,
}

pub fn parse_layout(bytes: &[u8]) -> Result<ParsedLayout> {
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
            .filter(|&end| offset >= data_base as u64 && end <= bytes.len() as u64);
        if end.is_none() {
            bail!(
                "frame {i} index entry (offset {offset}, length {length}) lies outside the data \
                 region ({data_base}..{})",
                bytes.len()
            );
        }
        index.push((offset, length));
    }

    Ok(ParsedLayout {
        frame_count,
        metadata_len,
        data_base,
        index,
    })
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
        assert_eq!(layout.frame_count, 2);
        assert_eq!(layout.index[0], (layout.data_base as u64, 3));
        assert_eq!(layout.index[1], (layout.data_base as u64 + 3, 4));
    }

    /// An index entry that points past the end of the file is a corrupt bundle. It must be
    /// refused when the bundle is opened, not discovered frame by frame while serving.
    #[test]
    fn index_entry_past_file_end_is_refused_at_parse() {
        let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
        let len = bytes.len();
        set_entry(&mut bytes, 1, len as u64 - 2, 4);
        assert!(parse_layout(&bytes).is_err(), "frame 1 runs 2 bytes past EOF");

        let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
        set_entry(&mut bytes, 0, u64::MAX - 1, 4);
        assert!(parse_layout(&bytes).is_err(), "offset + length overflows");
    }

    /// Frames live after the metadata; an entry inside the header or index is corrupt too.
    #[test]
    fn index_entry_before_data_base_is_refused_at_parse() {
        let mut bytes = bundle(&[b"aaa", b"bbbb"], b"{}");
        set_entry(&mut bytes, 0, 0, 3);
        assert!(parse_layout(&bytes).is_err(), "frame 0 points at the header");
    }
}
