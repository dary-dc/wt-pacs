//! A row per received group, a table per level (T1).

use super::{hash, set_top, top_page, Change, Package};
use crate::group::{self, PageValues, Record, Tag};
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};

pub const SCHEMA: &str = "
    CREATE TABLE instance (uid TEXT PRIMARY KEY, series TEXT NOT NULL, bytes BLOB NOT NULL, xxh3 INTEGER NOT NULL);
    CREATE INDEX instance_series ON instance (series, uid);
    CREATE TABLE private (uid TEXT PRIMARY KEY, bytes BLOB NOT NULL, xxh3 INTEGER NOT NULL);";

pub fn insert(tx: &Connection, p: &Package) -> Result<()> {
    let mut instance = tx.prepare_cached("INSERT INTO instance VALUES (?1, ?2, ?3, ?4)")?;
    let mut private = tx.prepare_cached("INSERT INTO private VALUES (?1, ?2, ?3)")?;
    for i in &p.instances {
        instance.execute(params![i.uid, p.series_uid, i.group, hash(&i.group)])?;
        if !i.private.is_empty() {
            private.execute(params![i.uid, i.private, hash(&i.private)])?;
        }
    }
    Ok(())
}

pub fn paint(db: &Connection, series: &str) -> Result<Vec<PageValues>> {
    let mut q = db.prepare_cached("SELECT bytes FROM instance WHERE series = ?1 ORDER BY uid")?;
    let mut rows = q.query([series])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(top_page(&group::parse(row.get_ref(0)?.as_blob()?)?));
    }
    Ok(out)
}

pub fn full(db: &Connection, series: &str) -> Result<Vec<Vec<Record>>> {
    let mut q = db.prepare_cached(
        "SELECT i.bytes, p.bytes FROM instance i LEFT JOIN private p USING (uid) WHERE i.series = ?1 ORDER BY i.uid",
    )?;
    let mut rows = q.query([series])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut records = group::parse(row.get_ref(0)?.as_blob()?)?;
        if let Some(private) = row.get_ref(1)?.as_blob_or_null()? {
            records.extend(group::parse(private)?);
        }
        out.push(records);
    }
    Ok(out)
}

/// Sets `tag` in one instance's group, or in every instance's of the series.
pub fn correct(tx: &Connection, series: &str, uid: Option<&str>, tag: Tag, value: &[u8]) -> Result<(Change, Vec<u8>)> {
    let targets: Vec<(String, Vec<u8>)> = match uid {
        Some(uid) => tx
            .query_row("SELECT uid, bytes FROM instance WHERE uid = ?1", [uid], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .into_iter()
            .collect(),
        None => tx
            .prepare_cached("SELECT uid, bytes FROM instance WHERE series = ?1")?
            .query_map([series], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?,
    };
    let mut update = tx.prepare_cached("UPDATE instance SET bytes = ?1, xxh3 = ?2 WHERE uid = ?3")?;
    let mut prior = None;
    for (uid, bytes) in &targets {
        let mut records = group::parse(bytes)?;
        let was = set_top(&mut records, tag, value)?;
        prior.get_or_insert(was);
        let bytes = group::write(&records);
        update.execute(params![bytes, hash(&bytes), uid])?;
    }
    let prior = prior.ok_or_else(|| anyhow::anyhow!("no such instance"))?;
    Ok((Change { rows: targets.len(), shared: None }, prior))
}
