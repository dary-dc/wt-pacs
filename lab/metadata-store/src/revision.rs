//! A study kept as its received inputs, each update a new revision directory named by `CURRENT`: the receiver
//! draft's design.md §12.5 (a), with the T1 + V1 file of pair.rs as the revision's one file.

use crate::group::{self, PageValues, Record};
use crate::pair::{self, RESCALE_INTERCEPT};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OpenFlags};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const SERIES: i64 = 1;

fn sync_dir(dir: &Path) -> Result<()> {
    File::open(dir)?.sync_all()?;
    Ok(())
}

fn write_durable(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut f = OpenOptions::new().write(true).create_new(true).open(path)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

/// Lays out `study` with the received series as its first input, and publishes revision 1.
pub fn create(study: &Path, series: &[Record], instances: &[Vec<Record>]) -> Result<()> {
    fs::create_dir_all(study.join("inputs"))?;
    fs::create_dir_all(study.join("store"))?;
    let mut archive = Vec::new();
    for g in std::iter::once(series).chain(instances.iter().map(Vec::as_slice)) {
        let bytes = group::write(g);
        archive.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        archive.extend_from_slice(&bytes);
    }
    write_durable(&study.join("inputs/000001.series"), &archive)?;
    sync_dir(&study.join("inputs"))?;
    publish(study, 1)
}

/// One correction: `instance`'s rescale intercept becomes `value`, kept as a new input, then a new revision built
/// from every input and published.
pub fn update(study: &Path, instance: u32, value: &[u8]) -> Result<()> {
    let inputs = study.join("inputs");
    let next = fs::read_dir(&inputs)?.count() + 1;
    write_durable(&inputs.join(format!("{next:06}.correction")), &[&instance.to_le_bytes()[..], value].concat())?;
    sync_dir(&inputs)?;
    publish(study, live(study)? + 1)
}

/// The study's groups after every input, in order: the series, then each instance with its received group and,
/// if corrected, its latest group and how many corrections it took.
struct Resolved {
    series: Vec<u8>,
    received: Vec<Vec<u8>>,
    corrected: Vec<Option<(Vec<Record>, i64)>>,
}

fn resolve(study: &Path) -> Result<Resolved> {
    let mut names: Vec<PathBuf> = fs::read_dir(study.join("inputs"))?.map(|e| e.map(|e| e.path())).collect::<Result<_, _>>()?;
    names.sort();
    let mut archive = &fs::read(&names[0])?[..];
    let mut groups = Vec::new();
    while !archive.is_empty() {
        let len = u32::from_le_bytes(archive[..4].try_into()?) as usize;
        groups.push(archive[4..4 + len].to_vec());
        archive = &archive[4 + len..];
    }
    let series = groups.remove(0);
    let mut corrected: Vec<Option<(Vec<Record>, i64)>> = vec![None; groups.len()];
    for name in &names[1..] {
        let c = fs::read(name)?;
        let i = u32::from_le_bytes(c[..4].try_into()?) as usize - 1;
        let (mut records, n) = corrected[i].take().map_or_else(|| group::parse(&groups[i]).map(|r| (r, 0)), Ok)?;
        records.iter_mut().find(|r| r.tag() == RESCALE_INTERCEPT).context("no rescale intercept")?.value = c[4..].to_vec();
        corrected[i] = Some((records, n + 1));
    }
    Ok(Resolved { series, received: groups, corrected })
}

fn build(path: &Path, study: &Resolved, revision: u64) -> Result<()> {
    let mut db = Connection::open(path)?;
    db.execute_batch(
        "PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
         CREATE TABLE grp (instance INTEGER, revision INTEGER, bytes BLOB, blake3 BLOB, PRIMARY KEY (instance, revision));
         CREATE TABLE page (series INTEGER PRIMARY KEY, revision INTEGER, document BLOB);",
    )?;
    let tx = db.transaction()?;
    let mut page: Vec<PageValues> = Vec::with_capacity(study.received.len());
    {
        let mut insert = tx.prepare("INSERT INTO grp VALUES (?1, ?2, ?3, ?4)")?;
        insert.execute(params![0, 0, study.series, blake3::hash(&study.series).as_bytes()])?;
        for (i, (bytes, corrected)) in study.received.iter().zip(&study.corrected).enumerate() {
            let instance = i as i64 + 1;
            insert.execute(params![instance, 0, bytes, blake3::hash(bytes).as_bytes()])?;
            let records = match corrected {
                Some((records, n)) => {
                    let b = group::write(records);
                    insert.execute(params![instance, n, b, blake3::hash(&b).as_bytes()])?;
                    records.clone()
                }
                None => group::parse(bytes)?,
            };
            page.push(group::page_values(records.into_iter().map(|r| (r.tag(), r.value))));
        }
    }
    tx.execute("INSERT INTO page VALUES (?1, ?2, ?3)", params![SERIES, revision as i64, pair::document(&page)])?;
    tx.commit()?;
    Ok(())
}

/// Builds revision `n` into `store/n.partial/`, makes it durable, renames it to `store/n` and points `CURRENT` at it.
fn publish(study: &Path, n: u64) -> Result<()> {
    let store = study.join("store");
    let partial = store.join(format!("{n}.partial"));
    fs::create_dir(&partial)?;
    build(&partial.join("study.db"), &resolve(study)?, n)?;
    File::open(partial.join("study.db"))?.sync_all()?;
    sync_dir(&partial)?;
    fs::rename(&partial, store.join(n.to_string()))?;
    sync_dir(&store)?;
    let lock = store.join("CURRENT.lock");
    write_durable(&lock, format!("{n}\n").as_bytes())?;
    fs::rename(&lock, store.join("CURRENT"))?;
    sync_dir(&store)
}

/// The revision `CURRENT` names.
pub fn live(study: &Path) -> Result<u64> {
    Ok(fs::read_to_string(study.join("store/CURRENT"))?.trim().parse()?)
}

/// Removes every revision older than the one before the live one; a reader holding one keeps reading it.
pub fn tidy(study: &Path) -> Result<()> {
    let n = live(study)?;
    for e in fs::read_dir(study.join("store"))? {
        let path = e?.path();
        if let Some(r) = path.file_name().and_then(|s| s.to_str()).and_then(|s| s.parse::<u64>().ok()) {
            if r + 1 < n {
                fs::remove_dir_all(path)?;
            }
        }
    }
    Ok(())
}

/// Opens the revision `CURRENT` names, read-only and `immutable=1`.
pub fn open_live(study: &Path) -> Result<Connection> {
    let path = study.join(format!("store/{}/study.db", live(study)?));
    ensure!(path.exists(), "revision gone");
    let uri = format!("file:{}?immutable=1", path.display());
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    Ok(Connection::open_with_flags(uri, flags)?)
}

/// A page open: the live revision's page row, `CURRENT` read again if its revision was removed meanwhile; returns
/// the document and how many times it read again.
pub fn read_live(study: &Path) -> Result<(Vec<u8>, u32)> {
    let mut again = 0;
    loop {
        match open_live(study).and_then(|db| pair::read_page(&db)) {
            Ok(doc) => return Ok((doc, again)),
            Err(e) if again >= 3 => return Err(e),
            Err(_) => again += 1,
        }
    }
}
