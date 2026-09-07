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

    let mut index = Vec::with_capacity(frame_count as usize);
    for i in 0..frame_count as usize {
        let base = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
        let offset = u64::from_le_bytes(bytes[base..base + 8].try_into()?);
        let length = u32::from_le_bytes(bytes[base + 8..base + 12].try_into()?);
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

/// Read a bundle's layout straight from the file.
///
/// Two reads: the fixed header says how long the rest is, then the whole prefix is taken
/// in one go.
pub fn read_layout(file: &File) -> Result<ParsedLayout> {
    let mut prefix = vec![0u8; HEADER_SIZE];
    file.read_exact_at(&mut prefix, 0).context("read header")?;
    prefix.resize(prefix_len(&prefix)?, 0);
    file.read_exact_at(&mut prefix, 0).context("read index")?;
    parse_layout(&prefix)
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
