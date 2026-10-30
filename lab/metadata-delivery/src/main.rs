//! The ways a viewer can get a series' metadata, each built minimally, and what each costs: README.md.
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;
use clap::{Parser, Subcommand};

mod consistency;
mod doc;
mod host;
mod prepare;
mod serve;

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// ROOT/studies/sNNN from fixture/build.py's template: study DB, ready rows, B's and C's files.
    Prepare {
        fixture: PathBuf,
        root: PathBuf,
        #[arg(long, default_value_t = 1)]
        studies: usize,
        #[arg(long, default_value = "wal")]
        journal: String,
    },
    /// The serving process: the metadata endpoint (A1) for nginx, and WebTransport (A2's message, every arm's frame).
    Serve {
        root: PathBuf,
        #[arg(long, default_value = "127.0.0.1:8081")]
        http: SocketAddr,
        #[arg(long, default_value = "0.0.0.0:4433")]
        wt: SocketAddr,
        #[arg(long)]
        cert: PathBuf,
        #[arg(long)]
        key: PathBuf,
    },
    /// H1: one open's metadata work in process, every variant interleaved.
    Cost {
        root: PathBuf,
        #[arg(long, default_value_t = 300)]
        rounds: usize,
    },
    /// H4: study DB connections held after one read, one per viewer or one per study.
    Hold {
        root: PathBuf,
        #[arg(long)]
        viewers: usize,
        #[arg(long)]
        studies: usize,
        #[arg(long)]
        per_study: bool,
        #[arg(long, default_value = "instances")]
        from: String,
        #[arg(long, default_value = "ct")]
        series: String,
    },
    /// The receiver applying updates to one study in a loop, a line per revision.
    Receive {
        root: PathBuf,
        #[arg(long, default_value = "s000")]
        study: String,
        #[arg(long, default_value_t = 10)]
        seconds: u64,
        #[arg(long, default_value_t = 2)]
        gap_ms: u64,
    },
    /// Readers, one thread per arm, a line per read.
    Read {
        root: PathBuf,
        #[arg(long, default_value = "s000")]
        study: String,
        #[arg(long, default_value_t = 10)]
        seconds: u64,
    },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Prepare { fixture, root, studies, journal } => prepare::run(&fixture, &root, studies, &journal),
        Command::Serve { root, http, wt, cert, key } => {
            tokio::runtime::Runtime::new()?.block_on(serve::run(root, http, wt, &cert, &key))
        }
        Command::Cost { root, rounds } => host::cost(&root, rounds),
        Command::Hold { root, viewers, studies, per_study, from, series } => {
            let source = doc::Source::parse(&from).ok_or_else(|| anyhow::anyhow!("--from instances|ready"))?;
            host::hold(&root, viewers, studies, !per_study, source, &series)
        }
        Command::Receive { root, study, seconds, gap_ms } => {
            consistency::receive(&root, &study, seconds, Duration::from_millis(gap_ms))
        }
        Command::Read { root, study, seconds } => consistency::read(&root, &study, seconds),
    }
}
