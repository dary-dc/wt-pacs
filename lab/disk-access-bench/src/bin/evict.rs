//! Whole-file page-cache eviction. `docs/disk-access/IMPLEMENTATION.md`.

use anyhow::{bail, Context, Result};
use disk_access_bench::residency::evict_retry;
use std::path::PathBuf;

fn main() -> Result<()> {
    let path = PathBuf::from(
        std::env::args()
            .nth(1)
            .context("usage: evict <study.sbnd>")?,
    );
    let resident = evict_retry(&path)?;
    println!("{resident}");
    if resident.is_nan() || resident > 0.02 {
        bail!("residency {resident} (want < 0.02)");
    }
    Ok(())
}
