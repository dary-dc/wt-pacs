//! The study DB: a table per level, a group's bytes and XXH3 keyed by its coded UID, and an audit
//! table (docs/adr/pacs-receiver.md §4).

use crate::disk::drop_cache;
use crate::package::{hex, Group, Header, Kind, Level};
use anyhow::{bail, ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::collections::BTreeMap;
use std::fs::File;
use std::path::Path;
use xxhash_rust::xxh3::xxh3_64;

pub const FILE: &str = "study.db";

/// `series` is the group's series: NULL for the exam group, its own UID for a series group.
const SCHEMA: &str = "
CREATE TABLE exam (uid TEXT PRIMARY KEY, series TEXT, xxh3 TEXT NOT NULL, bytes BLOB NOT NULL) STRICT;
CREATE TABLE series (uid TEXT PRIMARY KEY, series TEXT, xxh3 TEXT NOT NULL, bytes BLOB NOT NULL) STRICT;
CREATE TABLE instance (uid TEXT PRIMARY KEY, series TEXT, xxh3 TEXT NOT NULL, bytes BLOB NOT NULL) STRICT;
CREATE TABLE private (uid TEXT PRIMARY KEY, series TEXT, xxh3 TEXT NOT NULL, bytes BLOB NOT NULL) STRICT;
CREATE INDEX instance_series ON instance (series);
CREATE INDEX private_series ON private (series);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, package TEXT NOT NULL, kind TEXT NOT NULL,
  unit TEXT NOT NULL, revision INTEGER NOT NULL, xxh3 TEXT NOT NULL, changes TEXT NOT NULL,
  UNIQUE (unit, revision)
) STRICT;
";

#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub level: Level,
    pub uid: String,
    pub series: Option<String>,
    pub hash: u64,
    pub bytes: Vec<u8>,
}

impl Row {
    fn of(group: &Group) -> Self {
        let series = match group.level {
            Level::Exam => None,
            Level::Series => Some(group.uid.clone()),
            Level::Instance | Level::Private => group.series.clone(),
        };
        Row {
            level: group.level,
            uid: group.uid.clone(),
            series,
            hash: group.hash,
            bytes: group.bytes.clone(),
        }
    }
}

/// What one transaction did, enough to check it from disk and to undo it.
#[derive(Debug, Default)]
pub struct Change {
    pub prior: Vec<Row>,
    pub written: Vec<Row>,
    pub removed: Vec<(Level, String)>,
    pub unit: String,
    pub revision: u32,
    /// False when the package was already recorded: nothing to undo.
    pub recorded: bool,
}

/// Where a package's (unit, revision) stands against what the study DB holds.
#[derive(Debug, PartialEq)]
pub enum Seen {
    New { last: u32 },
    Stored { hash: u64, latest: bool },
}

pub fn create(path: &Path) -> Result<()> {
    let db = open(path)?;
    db.execute_batch(SCHEMA).context("create the study DB")?;
    Ok(())
}

pub fn open(path: &Path) -> Result<Connection> {
    let db = Connection::open(path).with_context(|| format!("open {}", path.display()))?;
    db.pragma_update(None, "journal_mode", "WAL")?;
    db.pragma_update(None, "synchronous", "FULL")?;
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(db)
}

pub fn seen(db: &Connection, unit: &str, revision: u32) -> Result<Seen> {
    let last: Option<u32> = db.query_row(
        "SELECT max(revision) FROM audit WHERE unit = ?1",
        [unit],
        |r| r.get(0),
    )?;
    let hash: Option<String> = db
        .query_row(
            "SELECT xxh3 FROM audit WHERE unit = ?1 AND revision = ?2",
            params![unit, revision],
            |r| r.get(0),
        )
        .optional()?;
    Ok(match hash {
        Some(hash) => Seen::Stored {
            hash: u64::from_str_radix(&hash, 16)?,
            latest: last == Some(revision),
        },
        None => Seen::New {
            last: last.unwrap_or(0),
        },
    })
}

/// Step 7, in one transaction. A series package replaces its series' rows whole; an update replaces
/// rows that exist. The same (unit, revision, hash) already recorded writes nothing.
pub fn record(
    db: &mut Connection,
    header: &Header,
    package: &str,
    hash: u64,
    groups: &[Group],
) -> Result<Change> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let written: Vec<Row> = groups.iter().map(Row::of).collect();
    let mut change = Change {
        unit: header.unit.clone(),
        revision: header.revision,
        ..Change::default()
    };
    match seen(&tx, &header.unit, header.revision)? {
        Seen::Stored { hash: stored, .. } if stored == hash => {
            change.written = written;
            return Ok(change);
        }
        Seen::New { last } if last + 1 == header.revision => change.recorded = true,
        other => bail!(
            "revision {} of {} against {other:?}",
            header.revision,
            header.unit
        ),
    }
    let mut prior = BTreeMap::new();
    for row in &written {
        if let Some(old) = current(&tx, row.level, &row.uid)? {
            prior.insert((row.level.table(), row.uid.clone()), old);
        } else if header.kind == Kind::Update {
            bail!("no current {} {} to update", row.level.table(), row.uid);
        }
    }
    if header.kind == Kind::Series {
        for level in [Level::Instance, Level::Private] {
            for old in in_series(&tx, level, &header.unit)? {
                prior.entry((level.table(), old.uid.clone())).or_insert(old);
            }
            tx.execute(
                &format!("DELETE FROM {} WHERE series = ?1", level.table()),
                [&header.unit],
            )?;
        }
    }
    for row in &written {
        if let Some(old) = prior.get(&(row.level.table(), row.uid.clone())) {
            ensure!(
                old.series == row.series,
                "{} {} belongs to series {:?}, not {:?}",
                row.level.table(),
                row.uid,
                old.series,
                row.series
            );
        }
        upsert(&tx, row)?;
    }
    let mut lines = Vec::new();
    for row in &written {
        let old = prior
            .get(&(row.level.table(), row.uid.clone()))
            .map(|o| hex(o.hash));
        if old.as_deref() != Some(&hex(row.hash)) {
            lines.push(format!(
                "{} {} {} {}",
                row.level.table(),
                row.uid,
                old.as_deref().unwrap_or("-"),
                hex(row.hash)
            ));
        }
    }
    for ((table, uid), old) in &prior {
        if !written
            .iter()
            .any(|w| w.level == old.level && &w.uid == uid)
        {
            lines.push(format!("{table} {uid} {} -", hex(old.hash)));
            change.removed.push((old.level, uid.clone()));
        }
    }
    let kind = match header.kind {
        Kind::Series => "series",
        Kind::Update => "update",
    };
    tx.execute(
        "INSERT INTO audit (at, package, kind, unit, revision, xxh3, changes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![unix_now(), package, kind, header.unit, header.revision, hex(hash), lines.join("\n")],
    )?;
    tx.commit().context("commit")?;
    change.prior = prior.into_values().collect();
    change.written = written;
    Ok(change)
}

/// Step 8: the file's cached pages dropped, a new connection, every row the change wrote re-hashed.
pub fn verify(path: &Path, change: &Change) -> Result<()> {
    drop_db_cache(path)?;
    let db = open(path)?;
    let check: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    ensure!(check == "ok", "integrity_check: {check}");
    for row in &change.written {
        let got = current(&db, row.level, &row.uid)?
            .with_context(|| format!("{} {} is not in the study DB", row.level.table(), row.uid))?;
        ensure!(
            got.hash == row.hash && xxh3_64(&got.bytes) == row.hash && got.series == row.series,
            "{} {} reads back as {} with bytes hashing to {}, not {}",
            row.level.table(),
            row.uid,
            hex(got.hash),
            hex(xxh3_64(&got.bytes)),
            hex(row.hash)
        );
    }
    for (level, uid) in &change.removed {
        ensure!(
            current(&db, *level, uid)?.is_none(),
            "{} {uid} was removed and reads back",
            level.table()
        );
    }
    Ok(())
}

/// R after step 7: the rows as they were, and no audit record of the package.
pub fn restore(path: &Path, change: &Change) -> Result<()> {
    if !change.recorded {
        return Ok(());
    }
    let mut db = open(path)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for row in &change.written {
        tx.execute(
            &format!("DELETE FROM {} WHERE uid = ?1", row.level.table()),
            [&row.uid],
        )?;
    }
    for row in &change.prior {
        upsert(&tx, row)?;
    }
    tx.execute(
        "DELETE FROM audit WHERE unit = ?1 AND revision = ?2",
        params![change.unit, change.revision],
    )?;
    tx.commit().context("commit the restore")
}

pub fn drop_db_cache(path: &Path) -> Result<()> {
    let mut wal = path.as_os_str().to_owned();
    wal.push("-wal");
    for file in [path.as_os_str(), wal.as_os_str()] {
        match File::open(file) {
            Ok(f) => drop_cache(&f)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e).context("open the study DB to drop its pages"),
        }
    }
    Ok(())
}

pub fn current(db: &Connection, level: Level, uid: &str) -> Result<Option<Row>> {
    db.query_row(
        &format!(
            "SELECT uid, series, xxh3, bytes FROM {} WHERE uid = ?1",
            level.table()
        ),
        [uid],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get(1)?,
                r.get::<_, String>(2)?,
                r.get(3)?,
            ))
        },
    )
    .optional()?
    .map(|(uid, series, hash, bytes)| {
        Ok(Row {
            level,
            uid,
            series,
            hash: u64::from_str_radix(&hash, 16)?,
            bytes,
        })
    })
    .transpose()
}

fn in_series(tx: &Transaction, level: Level, series: &str) -> Result<Vec<Row>> {
    let mut uids = tx.prepare(&format!(
        "SELECT uid FROM {} WHERE series = ?1",
        level.table()
    ))?;
    let uids: Vec<String> = uids
        .query_map([series], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    uids.iter()
        .map(|uid| current(tx, level, uid)?.context("a row vanished inside its transaction"))
        .collect()
}

fn upsert(tx: &Transaction, row: &Row) -> Result<()> {
    tx.execute(
        &format!(
            "INSERT OR REPLACE INTO {} (uid, series, xxh3, bytes) VALUES (?1, ?2, ?3, ?4)",
            row.level.table()
        ),
        params![row.uid, row.series, hex(row.hash), row.bytes],
    )?;
    Ok(())
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{device_reads, scratch};

    /// Step 8 reads the study DB from the device, not the page cache: right after the write that
    /// cached it, the verification has the whole row read from the device again.
    #[test]
    fn the_study_db_is_verified_from_the_device() {
        let path = scratch("db-from-disk").join(FILE);
        create(&path).unwrap();
        let bytes = vec![1u8; 256 * 1024];
        let hash = xxh3_64(&bytes);
        let db = open(&path).unwrap();
        db.execute(
            "INSERT INTO exam VALUES ('TO', NULL, ?1, ?2)",
            params![hex(hash), bytes],
        )
        .unwrap();
        let row = current(&db, Level::Exam, "TO").unwrap().unwrap();
        let change = Change {
            written: vec![row],
            ..Change::default()
        };
        let before = device_reads();
        verify(&path, &change).unwrap();
        assert!(
            device_reads() - before >= bytes.len() as u64,
            "the row was read from the cache"
        );
    }
}
