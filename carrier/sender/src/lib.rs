//! The sender's package build, kept until stored: docs/adr/pcs-transfer.md §15.
pub mod outbox;
pub mod package;
pub mod tree;

use anyhow::{ensure, Context, Result};
use outbox::{Carried, Outbox};
use package::Plan;
use std::collections::BTreeSet;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

/// Why a call stops before "stored" for an operator, as §15.2's exit codes 3 and 5.
#[derive(Debug)]
pub enum Stop {
    Refused(String),
    Unpackable(String),
}

impl fmt::Display for Stop {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Stop::Refused(why) | Stop::Unpackable(why) => f.write_str(why),
        }
    }
}

impl std::error::Error for Stop {}

pub fn unpackable(why: String) -> anyhow::Error {
    Stop::Unpackable(why).into()
}

/// Steps 2 and 3 of §15.2: the series' next revision built, kept and recorded, if the tree has
/// instances no earlier revision carried.
pub fn next(outbox: &Outbox, exam: &Path, unit: &str, compressed: bool) -> Result<Option<u64>> {
    let series = tree::read(exam, unit)?;
    let revisions = outbox.revisions(unit)?;
    let mut carried = BTreeSet::new();
    for &n in &revisions {
        for group in outbox.carried(unit, n)?.groups {
            if let [_, instance, _] = group.split('/').collect::<Vec<_>>()[..] {
                carried.insert(instance.to_string());
            }
        }
    }
    let mut new = series
        .instances
        .iter()
        .filter(|(instance, _)| !carried.contains(*instance))
        .peekable();
    if !revisions.is_empty() && new.peek().is_none() {
        return Ok(None);
    }
    let mut groups = vec![series.exam_group.clone(), series.series_group.clone()];
    groups.extend(new.flat_map(|(_, groups)| groups.iter().cloned()));
    let n = revisions.last().map_or(1, |n| n + 1);
    let plan = plan(exam, unit, n, Carried { compressed, groups })?;
    outbox.forget(unit, n)?;
    package::build(exam, &plan, outbox.path())?;
    outbox.write_carried(unit, n, &plan.carried)?;
    Ok(Some(n))
}

/// The kept package of a recorded revision, or, when it is gone or fails its own name, the
/// package rebuilt from what it carried (§15.7).
pub fn kept_or_rebuilt(outbox: &Outbox, exam: &Path, unit: &str, n: u64) -> Result<PathBuf> {
    for kept in outbox.kept(unit, n)? {
        if package::intact(&kept)? {
            return Ok(kept);
        }
        fs::remove_file(&kept)?;
    }
    let rebuilt = package::build(
        exam,
        &plan(exam, unit, n, outbox.carried(unit, n)?)?,
        outbox.path(),
    )?;
    if !package::intact(&rebuilt)? {
        let why = format!("{} fails its own name as rebuilt", rebuilt.display());
        return Err(Stop::Refused(why).into());
    }
    Ok(rebuilt)
}

fn plan(exam: &Path, unit: &str, revision: u64, carried: Carried) -> Result<Plan> {
    let study = exam
        .file_name()
        .and_then(|n| n.to_str())
        .context("the exam directory's name")?;
    ensure!(
        tree::is_coded(study),
        unpackable(format!("{study:?} is not a coded study UID"))
    );
    Ok(Plan {
        study: study.to_string(),
        unit: unit.to_string(),
        revision,
        carried,
    })
}
