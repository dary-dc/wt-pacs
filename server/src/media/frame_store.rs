//! Server-side SBND reader: one open study mapped for serving.

use anyhow::{bail, Context, Result};
use memmap2::Mmap;
use study_bundle::parse_layout;
use std::fs::File;
use std::path::Path;

pub struct FrameStore {
    _file: File,
