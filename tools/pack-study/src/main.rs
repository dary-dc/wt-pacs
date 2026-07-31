//! Pack loose HTJ2K frames + metadata JSON into a single `.sbnd` bundle.

use anyhow::{Context, Result};
use clap::Parser;
use study_bundle::BundleWriter;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "pack-study")]
struct Args {
    #[arg(long)]
