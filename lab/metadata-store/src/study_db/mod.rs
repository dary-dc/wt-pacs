//! One study DB in three layouts, each built from a series' package: lab/metadata-store/README.md §The study DB.

mod blob;
mod rows;
pub mod run;
pub mod shared;
#[cfg(test)]
mod tests;

use crate::group::{self, PageValues, Record, Tag};
use crate::pair;
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection};
use std::io::Read;
use std::path::Path;
use xxhash_rust::xxh3::xxh3_64;

pub const PATIENT_NAME: Tag = [0x00, 0x10, 0x00, 0x10];
pub const SLICE_THICKNESS: Tag = [0x00, 0x18, 0x00, 0x50];
const MODALITY: Tag = [0x00, 0x08, 0x00, 0x60];

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Layout {
    Rows,
    Shared,
    Blob,
}

impl Layout {
    pub fn name(self) -> &'static str {
        match self {
            Layout::Rows => "row per group",
            Layout::Shared => "shared + per-frame",
            Layout::Blob => "blob per series",
        }
    }

    fn tables(self) -> &'static [&'static str] {
        match self {
            Layout::Rows => &["instance", "private"],
            Layout::Shared => &["shared", "frame"],
            Layout::Blob => &["blob"],
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Instance {
    pub uid: String,
    pub group: Vec<u8>,
    pub private: Vec<u8>,
}

pub struct Package {
    pub exam_uid: String,
    pub exam: Vec<u8>,
    pub series_uid: String,
    pub series: Vec<u8>,
    pub modality: String,
    pub instances: Vec<Instance>,
}

/// A series package: the parser's group files at their tree paths, `<D>/<exam>/<series>/<instance>/<kind>.<hash>`.
pub fn unpack(tar_bytes: &[u8]) -> Result<Package> {
    let mut p = Package {
        exam_uid: String::new(),
        exam: Vec::new(),
        series_uid: String::new(),
        series: Vec::new(),
        modality: String::new(),
        instances: Vec::new(),
    };
    for entry in tar::Archive::new(tar_bytes).entries()? {
        let mut entry = entry?;
        let path = entry.path()?.to_string_lossy().into_owned();
        let parts: Vec<&str> = path.split('/').collect();
        let kind = parts.last().and_then(|n| n.split('.').next()).unwrap_or_default().to_string();
        let owner = parts.get(parts.len().wrapping_sub(2)).copied().unwrap_or_default().to_string();
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes)?;
        match kind.as_str() {
            "--" if p.exam.is_empty() => (p.exam_uid, p.exam) = (owner, bytes),
            "---" if p.series.is_empty() => (p.series_uid, p.series) = (owner, bytes),
            "----" => p.instances.push(Instance { uid: owner, group: bytes, private: Vec::new() }),
            "priv" => {
                let last = p.instances.last_mut().filter(|i| i.uid == owner).context("a private group before its instance")?;
                last.private = bytes;
            }
            "--" | "---" => {}
            _ => anyhow::bail!("{path}: not a group file"),
        }
    }
    ensure!(!p.exam.is_empty() && !p.series.is_empty() && !p.instances.is_empty(), "a package lacks a level");
    let series = group::parse(&p.series)?;
    let modality = series.iter().find(|r| r.key.len() == 8 && r.tag() == MODALITY).context("no modality")?;
    p.modality = String::from_utf8_lossy(&modality.value).trim().to_string();
    Ok(p)
}

pub fn hash(bytes: &[u8]) -> i64 {
    xxh3_64(bytes) as i64
}

/// The paint values of one instance from its top-level records.
fn top_page(records: &[Record]) -> PageValues {
    group::page_values(records.iter().filter(|r| r.key.len() == 8).map(|r| (r.tag(), r.value.clone())))
}

/// Sets a top-level attribute; returns its prior value.
fn set_top(records: &mut [Record], tag: Tag, value: &[u8]) -> Result<Vec<u8>> {
    let r = records.iter_mut().find(|r| r.key.len() == 8 && r.tag() == tag).context("no such top-level attribute")?;
    Ok(std::mem::replace(&mut r.value, value.to_vec()))
}

pub fn build(layout: Layout, path: &Path, tar_bytes: &[u8]) -> Result<Connection> {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
    let p = unpack(tar_bytes)?;
    let mut db = pair::writable(path)?;
    db.execute_batch(
        "CREATE TABLE exam (uid TEXT PRIMARY KEY, bytes BLOB NOT NULL, xxh3 INTEGER NOT NULL);
         CREATE TABLE series (uid TEXT PRIMARY KEY, exam TEXT NOT NULL, bytes BLOB NOT NULL, xxh3 INTEGER NOT NULL);
         CREATE TABLE audit (at INTEGER, who TEXT, scope TEXT, tag BLOB, prior BLOB, value BLOB);",
    )?;
    db.execute_batch(match layout {
        Layout::Rows => rows::SCHEMA,
        Layout::Shared => shared::SCHEMA,
        Layout::Blob => blob::SCHEMA,
    })?;
    let tx = db.transaction()?;
    tx.execute("INSERT INTO exam VALUES (?1, ?2, ?3)", params![p.exam_uid, p.exam, hash(&p.exam)])?;
    tx.execute(
        "INSERT INTO series VALUES (?1, ?2, ?3, ?4)",
        params![p.series_uid, p.exam_uid, p.series, hash(&p.series)],
    )?;
    match layout {
        Layout::Rows => rows::insert(&tx, &p)?,
        Layout::Shared => shared::insert(&tx, &p)?,
        Layout::Blob => blob::insert(&tx, &p)?,
    }
    tx.commit()?;
    Ok(db)
}

/// Each instance's paint values, in the order of its UID.
pub fn paint(layout: Layout, db: &Connection, series: &str) -> Result<Vec<PageValues>> {
    match layout {
        Layout::Rows => rows::paint(db, series),
        Layout::Shared => shared::paint(db, series),
        Layout::Blob => blob::paint(db, series),
    }
}

/// Every stored record of the series, as the layout keeps it: `shared` once (empty but in shared + per-frame), then
/// each instance's own.
#[derive(Debug, PartialEq)]
pub struct Full {
    pub exam: Vec<Record>,
    pub series: Vec<Record>,
    pub shared: Vec<Record>,
    pub instances: Vec<Vec<Record>>,
}

pub fn full(layout: Layout, db: &Connection, series: &str) -> Result<Full> {
    let (exam, own): (Vec<u8>, Vec<u8>) = db.query_row(
        "SELECT e.bytes, s.bytes FROM series s JOIN exam e ON e.uid = s.exam WHERE s.uid = ?1",
        [series],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let (shared, instances) = match layout {
        Layout::Rows => (Vec::new(), rows::full(db, series)?),
        Layout::Shared => shared::full(db, series)?,
        Layout::Blob => (Vec::new(), blob::full(db, series)?),
    };
    Ok(Full { exam: group::parse(&exam)?, series: group::parse(&own)?, shared, instances })
}

#[derive(Clone, Copy)]
pub enum Scope<'a> {
    Exam,
    Instance(&'a str),
    Series,
}

/// What a correction wrote: rows rewritten and, in shared + per-frame, whether the attribute ends in the shared row.
#[derive(Debug, PartialEq)]
pub struct Change {
    pub rows: usize,
    pub shared: Option<bool>,
}

/// One correction in one commit, in place, with its audit record.
pub fn correct(layout: Layout, db: &mut Connection, series: &str, scope: Scope, tag: Tag, value: &[u8]) -> Result<Change> {
    let tx = db.transaction()?;
    let (label, change, prior) = match scope {
        Scope::Exam => {
            let (uid, bytes): (String, Vec<u8>) = tx.query_row(
                "SELECT e.uid, e.bytes FROM series s JOIN exam e ON e.uid = s.exam WHERE s.uid = ?1",
                [series],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let mut records = group::parse(&bytes)?;
            let prior = set_top(&mut records, tag, value)?;
            let bytes = group::write(&records);
            tx.execute("UPDATE exam SET bytes = ?1, xxh3 = ?2 WHERE uid = ?3", params![bytes, hash(&bytes), uid])?;
            (uid, Change { rows: 1, shared: None }, prior)
        }
        Scope::Instance(uid) => {
            let (change, prior) = match layout {
                Layout::Rows => rows::correct(&tx, series, Some(uid), tag, value)?,
                Layout::Shared => shared::correct(&tx, series, Some(uid), tag, value)?,
                Layout::Blob => blob::correct(&tx, series, Some(uid), tag, value)?,
            };
            (uid.to_string(), change, prior)
        }
        Scope::Series => {
            let (change, prior) = match layout {
                Layout::Rows => rows::correct(&tx, series, None, tag, value)?,
                Layout::Shared => shared::correct(&tx, series, None, tag, value)?,
                Layout::Blob => blob::correct(&tx, series, None, tag, value)?,
            };
            (series.to_string(), change, prior)
        }
    };
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos() as i64;
    tx.execute(
        "INSERT INTO audit VALUES (?1, 'lab', ?2, ?3, ?4, ?5)",
        params![at, label, tag.as_slice(), prior, value],
    )?;
    tx.commit()?;
    Ok(change)
}

/// Every stored row's bytes against its XXH3; returns the rows checked.
pub fn check(layout: Layout, db: &Connection) -> Result<usize> {
    let mut checked = 0;
    for table in ["exam", "series"].iter().chain(layout.tables()) {
        let mut q = db.prepare_cached(&format!("SELECT bytes, xxh3 FROM {table}"))?;
        let mut rows = q.query([])?;
        while let Some(row) = rows.next()? {
            ensure!(hash(row.get_ref(0)?.as_blob()?) == row.get::<_, i64>(1)?, "a row of {table} fails its XXH3");
            checked += 1;
        }
    }
    Ok(checked)
}

/// Every stored byte but the audit's, in a fixed order: two stores with the same state give the same bytes.
pub fn state(layout: Layout, db: &Connection) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    for table in ["exam", "series"].iter().chain(layout.tables()) {
        let mut q = db.prepare(&format!("SELECT bytes FROM {table} ORDER BY rowid"))?;
        let mut rows = q.query([])?;
        while let Some(row) = rows.next()? {
            out.extend_from_slice(row.get_ref(0)?.as_blob()?);
        }
    }
    Ok(out)
}
