//! `pacs-verify PATH... [--json FILE]`: tools/pacs-verify/README.md.

use clap::Parser;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "pacs-verify",
    about = "Check every .sbnd and study DB under each path, read from disk"
)]
struct Args {
    /// A `.sbnd`, a study directory, or a host's root.
    #[arg(required = true)]
    paths: Vec<PathBuf>,
    /// Also write every finding as a JSON line here.
    #[arg(long)]
    json: Option<PathBuf>,
}

fn main() -> ExitCode {
    let args = Args::parse();
    let mut json = match args.json.as_ref().map(File::create).transpose() {
        Ok(file) => file.map(BufWriter::new),
        Err(e) => {
            eprintln!("pacs-verify: {}: {e}", args.json.unwrap().display());
            return ExitCode::from(2);
        }
    };
    let findings: Vec<_> = args
        .paths
        .iter()
        .flat_map(|p| pacs_verify::verify(p))
        .collect();
    let mut stdout = std::io::stdout().lock();
    match pacs_verify::report(
        &findings,
        &mut stdout,
        json.as_mut().map(|j| j as &mut dyn Write),
    ) {
        Ok(false) => ExitCode::SUCCESS,
        Ok(true) => ExitCode::from(1),
        Err(e) => {
            eprintln!("pacs-verify: writing the report: {e}");
            ExitCode::from(2)
        }
    }
}
