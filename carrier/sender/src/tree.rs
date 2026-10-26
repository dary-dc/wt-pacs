//! The allow list: which files of the exam tree a series' package carries (docs/adr/pcs-transfer.md §15.3).
use crate::unpackable;
use anyhow::{bail, Result};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

const CODED: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";

/// Paths relative to the exam directory.
pub struct Series {
    pub exam_group: String,
    pub series_group: String,
    /// By instance UID: its instance group, then its private group if it has one.
    pub instances: BTreeMap<String, Vec<String>>,
}

/// A UID as the parser codes it (contract.md §The coding): two characters for every three.
pub fn is_coded(name: &str) -> bool {
    !name.is_empty() && name.len().is_multiple_of(2) && name.bytes().all(|b| CODED.contains(&b))
}

pub fn read(exam: &Path, unit: &str) -> Result<Series> {
    let series = exam.join(unit);
    if !is_coded(unit) || !fs::symlink_metadata(&series).is_ok_and(|m| m.is_dir()) {
        bail!(unpackable(format!("{unit:?} is not a series directory")));
    }
    let mut instances = BTreeMap::new();
    for entry in fs::read_dir(&series)? {
        let entry = entry?;
        let Some(name) = entry
            .file_name()
            .to_str()
            .filter(|n| is_coded(n))
            .map(String::from)
        else {
            continue;
        };
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            bail!(unpackable(format!("{unit}/{name} is a link")));
        }
        if kind.is_dir() {
            let dir = format!("{unit}/{name}");
            let mut groups = vec![one(&entry.path(), &dir, "----")?];
            let private = groups_in(&entry.path(), &dir, "priv")?;
            if private.len() > 1 {
                bail!(unpackable(format!(
                    "{} private groups in {dir:?}",
                    private.len()
                )));
            }
            groups.extend(private);
            instances.insert(name, groups);
        }
    }
    Ok(Series {
        exam_group: one(exam, "", "--")?,
        series_group: one(&series, unit, "---")?,
        instances,
    })
}

fn one(dir: &Path, rel: &str, marker: &str) -> Result<String> {
    let mut found = groups_in(dir, rel, marker)?;
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => bail!(unpackable(format!("no {marker} group in {rel:?}"))),
        n => bail!(unpackable(format!(
            "{n} {marker} groups in {rel:?}: a correction is an update"
        ))),
    }
}

/// `<marker>.<16 lowercase hex>`; anything else in `dir` is not looked at.
fn groups_in(dir: &Path, rel: &str, marker: &str) -> Result<Vec<String>> {
    let mut found = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((m, hash)) = name.split_once('.') else {
            continue;
        };
        if m != marker
            || hash.len() != 16
            || !hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        {
            continue;
        }
        found.push(if rel.is_empty() {
            name
        } else {
            format!("{rel}/{name}")
        });
    }
    found.sort();
    Ok(found)
}
