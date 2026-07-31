//! Pack loose HTJ2K frames + metadata JSON into a single `.sbnd` bundle.

use anyhow::{Context, Result};
use clap::Parser;
use study_bundle::BundleWriter;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "pack-study")]
struct Args {
    #[arg(long)]
    metadata: PathBuf,
    #[arg(long)]
    frames: PathBuf,
    #[arg(long)]
    output: PathBuf,
    #[arg(long)]
    sidecar: Option<PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let metadata = std::fs::read(&args.metadata)
        .with_context(|| format!("read {}", args.metadata.display()))?;
    let meta: serde_json::Value =
        serde_json::from_slice(&metadata).context("parse metadata JSON")?;
    let frame_count = meta
        .get("frameCount")
        .and_then(|v| v.as_u64())
        .context("frameCount missing in metadata")? as usize;

    let frame_paths: Vec<PathBuf> = (0..frame_count)
        .map(|i| args.frames.join(format!("{i:03}.htj2k")))
