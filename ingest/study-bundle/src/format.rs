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

    let mut index = Vec::with_capacity(frame_count as usize);
    for i in 0..frame_count as usize {
        let base = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
        let offset = u64::from_le_bytes(bytes[base..base + 8].try_into()?);
        let length = u32::from_le_bytes(bytes[base + 8..base + 12].try_into()?);
        index.push((offset, length));
    }

    Ok(ParsedLayout {
        frame_count,
        metadata_len,
        data_base,
        index,
    })
}
