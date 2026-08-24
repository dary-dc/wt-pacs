//! Read frame sizes from an on-disk SBND bundle for simulation input.

use anyhow::{Context, Result};
use memmap2::Mmap;
use std::fs::File;
use std::path::Path;
use study_bundle::parse_layout;

pub struct StudyStats {
    pub frame_count: u32,
    pub total_bytes: u64,
    pub mean_frame_bytes: u64,
    pub min_frame_bytes: u32,
    pub max_frame_bytes: u32,
}

pub fn stats_from_sbnd(path: &Path) -> Result<StudyStats> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mmap = unsafe { Mmap::map(&file).context("mmap study")? };
    let parsed = parse_layout(&mmap)?;
    let mut total: u64 = 0;
    let mut min = u32::MAX;
    let mut max = 0u32;
    for (_, len) in &parsed.index {
        total += *len as u64;
        min = min.min(*len);
        max = max.max(*len);
    }
    let n = parsed.frame_count.max(1) as u64;
    Ok(StudyStats {
        frame_count: parsed.frame_count,
        total_bytes: total,
        mean_frame_bytes: total / n,
        min_frame_bytes: if parsed.index.is_empty() { 0 } else { min },
        max_frame_bytes: max,
    })
}
