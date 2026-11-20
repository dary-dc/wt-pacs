//! `sender --profile FILE EXAM_DIR SERIES...`: docs/adr/pcs-transfer.md §15.2.
use anyhow::{bail, ensure, Context, Result};
use clap::Parser;
use sender::outbox::Outbox;
use sender::Stop;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// The upload is the PCS's script's: docs/ingest/link.md §12.5.
const SEND_PACKAGE: &str = include_str!("../../pcs/send-package.sh");

/// The profile's settings the script reads, and the variable it reads each from.
const SCRIPT_SETTINGS: [(&str, &str); 9] = [
    ("carrier", "CARRIER"),
    ("cert", "CERT"),
    ("key", "KEY"),
    ("cacert", "CACERT"),
    ("stall", "STALL_SECS"),
    ("attempts", "ATTEMPTS"),
    ("backoff", "BACKOFF_SECS"),
    ("poll", "POLL_SECS"),
    ("wait", "WAIT_SECS"),
];

#[derive(Parser)]
struct Args {
    /// The deployment's profile: §15.9.
    #[arg(long)]
    profile: PathBuf,
    /// `[…/<D>]/<E>`, named by the coded study UID.
    exam: PathBuf,
    /// Coded series UIDs, each a directory under EXAM.
    #[arg(required = true)]
    series: Vec<String>,
}

struct Profile {
    outbox: PathBuf,
    compressed: bool,
    script_env: Vec<(&'static str, String)>,
}

impl Profile {
    fn read(path: &Path) -> Result<Profile> {
        let text = fs::read_to_string(path).with_context(|| format!("{}", path.display()))?;
        let (mut outbox, mut compressed, mut script_env) = (None, true, Vec::new());
        for line in text
            .lines()
            .map(|l| l.split('#').next().unwrap_or("").trim())
        {
            if line.is_empty() {
                continue;
            }
            let (key, value) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
            let value = value.trim().to_string();
            match (key, value.as_str()) {
                ("transport", "tcp") => {}
                ("transport", _) => bail!(
                    "transport {value}: this sender uploads with send-package.sh, over TCP only"
                ),
                ("metadata", "zstd" | "plain") => compressed = value == "zstd",
                ("outbox", _) => outbox = Some(PathBuf::from(value)),
                _ => match SCRIPT_SETTINGS.iter().find(|(name, _)| *name == key) {
                    Some((_, var)) => script_env.push((*var, value)),
                    None => bail!("{}: {line:?} is not a setting", path.display()),
                },
            }
        }
        for required in ["CARRIER", "CERT", "KEY", "CACERT"] {
            ensure!(
                script_env.iter().any(|(var, _)| *var == required),
                "the profile sets no {required}"
            );
        }
        Ok(Profile {
            outbox: outbox.context("the profile sets no outbox")?,
            compressed,
            script_env,
        })
    }
}

fn main() -> ExitCode {
    let args = Args::parse();
    let profile = match Profile::read(&args.profile) {
        Ok(profile) => profile,
        Err(err) => {
            eprintln!("sender: {err:#}");
            return ExitCode::from(2);
        }
    };
    let mut code = 0;
    for unit in &args.series {
        let this = series(&profile, &args.exam, unit).unwrap_or_else(|err| {
            eprintln!("sender: {unit}: {err:#}");
            match err.downcast_ref::<Stop>() {
                Some(Stop::Refused(_)) => 3,
                Some(Stop::Unpackable(_)) => 5,
                None => 4,
            }
        });
        if code == 0 {
            code = this;
        }
    }
    ExitCode::from(code)
}

/// §15.2's steps for one series: what is kept is sent first, oldest first, then anything new.
fn series(profile: &Profile, exam: &Path, unit: &str) -> Result<u8> {
    let outbox = Outbox::open(&profile.outbox)?;
    for n in outbox.revisions(unit)? {
        if !outbox.stored(unit, n) {
            match send(profile, &outbox, exam, unit, n)? {
                0 => {}
                code => return Ok(code),
            }
        }
    }
    match sender::next(&outbox, exam, unit, profile.compressed)? {
        Some(n) => send(profile, &outbox, exam, unit, n),
        None => Ok(0),
    }
}

fn send(profile: &Profile, outbox: &Outbox, exam: &Path, unit: &str, n: u64) -> Result<u8> {
    let package = sender::kept_or_rebuilt(outbox, exam, unit, n)?;
    let status = Command::new("sh")
        .args(["-c", SEND_PACKAGE, "send-package.sh"])
        .arg(&package)
        .envs(profile.script_env.iter().cloned())
        .status()?;
    match status.code() {
        Some(0) => {
            outbox.mark_stored(unit, n, &package)?;
            Ok(0)
        }
        Some(3) => Ok(3),
        _ => Ok(4),
    }
}
