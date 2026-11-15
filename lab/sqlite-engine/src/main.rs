//! rusqlite against Turso for the per-study metadata database: lab/sqlite-engine/README.md.

mod blocking;
mod files;
mod lock;
mod study;
mod two;

use anyhow::{bail, Context, Result};
use std::collections::HashMap;

/// `default`: Turso's default features (mimalloc as the allocator, tantivy); `lean`: neither.
pub const BUILD: &str = if cfg!(feature = "turso-defaults") { "default" } else { "lean" };

pub struct Args(HashMap<String, String>);

impl Args {
    pub fn get<T: std::str::FromStr>(&self, key: &str, default: T) -> T {
        self.0.get(key).and_then(|v| v.parse().ok()).unwrap_or(default)
    }
    pub fn str(&self, key: &str, default: &str) -> String {
        self.0.get(key).cloned().unwrap_or_else(|| default.into())
    }
    pub fn has(&self, key: &str) -> bool {
        self.0.contains_key(key)
    }
}

fn main() -> Result<()> {
    let mut it = std::env::args().skip(1);
    let mode = it.next().context("usage: sqlite-engine blocking|files|two|lock [--flag value]...")?;
    let mut flags = HashMap::new();
    while let Some(flag) = it.next() {
        let key = flag.strip_prefix("--").with_context(|| format!("{flag}: flags start with --"))?;
        flags.insert(key.to_owned(), it.next().unwrap_or_default());
    }
    let args = Args(flags);
    match mode.as_str() {
        "blocking" => blocking::run(&args),
        "files" => files::run(&args),
        "files-child" => files::child(&args),
        "two" => two::run(&args),
        "two-child" => two::child(&args),
        "lock" => lock::run(&args),
        "lock-child" => lock::child(&args),
        _ => bail!("unknown mode {mode}"),
    }
}
