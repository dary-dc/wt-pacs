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
