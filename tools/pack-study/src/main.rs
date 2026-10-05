//! Pack loose frames (`NNN.htj2k`, or `NNN.av1` when the metadata says `"codec": "av1"`) + metadata JSON
//! into a single `.sbnd` bundle.

use anyhow::{Context, Result};
use clap::Parser;
use study_bundle::BundleWriter;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "pack-study")]
struct Args {
    #[arg(long)]
    metadata: PathBuf,
    #[arg(long)]
    frames: PathBuf,
    #[arg(long)]
    output: PathBuf,
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

    let ext = match meta.get("codec").and_then(|v| v.as_str()) {
        None | Some("htj2k") => "htj2k",
        Some("av1") => "av1",
        Some(other) => anyhow::bail!("unknown codec {other:?} in metadata"),
    };
    let frame_paths: Vec<PathBuf> = (0..frame_count)
        .map(|i| args.frames.join(format!("{i:03}.{ext}")))
        .collect();
    let mut lengths: Vec<u32> = Vec::with_capacity(frame_count);
    for path in &frame_paths {
        let len = std::fs::metadata(path)
            .with_context(|| format!("stat {}", path.display()))?
            .len();
        lengths.push(
            u32::try_from(len).with_context(|| format!("{} exceeds 4 GiB", path.display()))?,
        );
    }

    let mut writer = BundleWriter::create(&args.output, &metadata, &lengths)
        .with_context(|| format!("create {}", args.output.display()))?;
    for path in &frame_paths {
        let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
        writer
            .write_frame(&bytes)
            .with_context(|| format!("write frame from {}", path.display()))?;
    }
    writer
        .finish()
        .with_context(|| format!("finish {}", args.output.display()))?;

    println!(
        "wrote {} ({} frames, {} bytes)",
        args.output.display(),
        frame_count,
        std::fs::metadata(&args.output)?.len()
    );
    Ok(())
}
