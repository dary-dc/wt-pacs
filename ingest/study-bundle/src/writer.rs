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
