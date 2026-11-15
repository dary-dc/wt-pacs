//! One zstd blob per series holding every instance's groups.

use super::{hash, set_top, top_page, Change, Instance, Package};
use crate::group::{self, PageValues, Record, Tag};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection};

pub const SCHEMA: &str = "CREATE TABLE blob (series TEXT PRIMARY KEY, bytes BLOB NOT NULL, xxh3 INTEGER NOT NULL);";
const LEVEL: i32 = 3;

/// Per instance `[u8 UID length][UID][u32 LE group length][group][u32 LE private length][private]`, then zstd.
fn encode(instances: &[Instance]) -> Result<Vec<u8>> {
    let mut raw = Vec::new();
    for i in instances {
        raw.push(i.uid.len() as u8);
        raw.extend_from_slice(i.uid.as_bytes());
        for part in [&i.group, &i.private] {
            raw.extend_from_slice(&(part.len() as u32).to_le_bytes());
            raw.extend_from_slice(part);
        }
    }
    Ok(zstd::bulk::compress(&raw, LEVEL)?)
}

fn take<'a>(rest: &mut &'a [u8], n: usize) -> Result<&'a [u8]> {
    ensure!(n <= rest.len(), "blob cut short");
    let (head, tail) = rest.split_at(n);
    *rest = tail;
    Ok(head)
}

fn decode(bytes: &[u8]) -> Result<Vec<Instance>> {
    let raw = zstd::stream::decode_all(bytes)?;
    let mut rest = raw.as_slice();
    let length = |rest: &mut &[u8]| -> Result<usize> { Ok(u32::from_le_bytes(take(rest, 4)?.try_into()?) as usize) };
    let mut out = Vec::new();
    while !rest.is_empty() {
        let n = take(&mut rest, 1)?[0] as usize;
        let uid = String::from_utf8(take(&mut rest, n)?.to_vec())?;
        let n = length(&mut rest)?;
        let group = take(&mut rest, n)?.to_vec();
        let n = length(&mut rest)?;
        out.push(Instance { uid, group, private: take(&mut rest, n)?.to_vec() });
    }
    Ok(out)
}

pub fn insert(tx: &Connection, p: &Package) -> Result<()> {
    let bytes = encode(&p.instances)?;
    tx.execute("INSERT INTO blob VALUES (?1, ?2, ?3)", params![p.series_uid, bytes, hash(&bytes)])?;
    Ok(())
}

fn load(db: &Connection, series: &str) -> Result<Vec<Instance>> {
    let mut q = db.prepare_cached("SELECT bytes FROM blob WHERE series = ?1")?;
    q.query_row([series], |r| Ok(decode(r.get_ref(0)?.as_blob()?)))?
}

pub fn paint(db: &Connection, series: &str) -> Result<Vec<PageValues>> {
    load(db, series)?.iter().map(|i| Ok(top_page(&group::parse(&i.group)?))).collect()
}

pub fn full(db: &Connection, series: &str) -> Result<Vec<Vec<Record>>> {
    load(db, series)?
        .iter()
        .map(|i| Ok([group::parse(&i.group)?, group::parse(&i.private)?].concat()))
        .collect()
}

pub fn correct(tx: &Connection, series: &str, uid: Option<&str>, tag: Tag, value: &[u8]) -> Result<(Change, Vec<u8>)> {
    let mut instances = load(tx, series)?;
    let mut prior = None;
    for i in instances.iter_mut().filter(|i| uid.is_none_or(|u| u == i.uid)) {
        let mut records = group::parse(&i.group)?;
        prior.get_or_insert(set_top(&mut records, tag, value)?);
        i.group = group::write(&records);
    }
    let bytes = encode(&instances)?;
    tx.execute("UPDATE blob SET bytes = ?1, xxh3 = ?2 WHERE series = ?3", params![bytes, hash(&bytes), series])?;
    Ok((Change { rows: 1, shared: None }, prior.context("no such instance")?))
}
