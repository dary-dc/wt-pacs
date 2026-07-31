//! Shared SBND layout constants and header/index parser.

use anyhow::{bail, Result};

pub const MAGIC: &[u8; 4] = b"SBND";
pub const VERSION: u32 = 1;

pub const HEADER_SIZE: usize = 16;
pub const INDEX_ENTRY_SIZE: usize = 12;
