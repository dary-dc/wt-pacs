//! The recommended pair and its runner-up, each one SQLite file: docs/ingest/metadata-draft.md §2.
//! T1: the truth as a row per received group; T2: a row per attribute. Both carry V1, a page row per series.

use crate::group::{self, PageValues, Record, Tag};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::path::Path;

pub const RESCALE_INTERCEPT: Tag = [0x00, 0x28, 0x10, 0x52];
const SERIES: i64 = 1;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Truth {
    Groups,
    Attributes,
}

/// The page's document, as it would be sent: each instance's page values in instance order.
pub fn document(page: &[PageValues]) -> Vec<u8> {
    serde_json::to_vec(&page.iter().map(entry).collect::<Vec<_>>()).unwrap()
}

type Entry = Vec<Option<String>>;

fn entry(values: &PageValues) -> Entry {
    values.iter().map(|x| x.as_ref().map(|b| String::from_utf8_lossy(b).into_owned())).collect()
}

fn tagged(records: &[Record]) -> PageValues {
    group::page_values(records.iter().map(|r| (r.tag(), r.value.clone())))
}

/// DECK's `sSSiIIFF` prefix, as in stores.rs, then the record's key, then the revision.
fn attribute_key(instance: i64, record_key: &[u8], revision: u32) -> Vec<u8> {
    let i = instance as u16;
    let p = [1, 0, SERIES as u8, (i > 0) as u8, (i >> 8) as u8, i as u8, 0, 0];
    [p.as_slice(), record_key, &revision.to_be_bytes()].concat()
}

pub fn writable(path: &Path) -> Result<Connection> {
    let db = Connection::open(path)?;
    db.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;")?;
    Ok(db)
}

pub fn open(path: &Path) -> Result<Connection> {
    Ok(Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?)
}

pub fn build(truth: Truth, path: &Path, series: &[Record], instances: &[Vec<Record>]) -> Result<Connection> {
    let mut db = writable(path)?;
    db.execute_batch(match truth {
        Truth::Groups => {
            "CREATE TABLE grp (instance INTEGER, revision INTEGER, bytes BLOB, blake3 BLOB,
                               PRIMARY KEY (instance, revision));"
        }
        Truth::Attributes => {
            "CREATE TABLE kv (key BLOB PRIMARY KEY, value BLOB) WITHOUT ROWID;
             CREATE TABLE received (instance INTEGER PRIMARY KEY, blake3 BLOB);"
        }
    })?;
    db.execute_batch("CREATE TABLE page (series INTEGER PRIMARY KEY, revision INTEGER, document BLOB);")?;
    let tx = db.transaction()?;
    for (i, records) in std::iter::once(series).chain(instances.iter().map(Vec::as_slice)).enumerate() {
        let bytes = group::write(records);
        let hash = blake3::hash(&bytes);
        match truth {
            Truth::Groups => {
                tx.execute("INSERT INTO grp VALUES (?1, 0, ?2, ?3)", params![i as i64, bytes, hash.as_bytes()])?;
            }
            Truth::Attributes => {
                tx.execute("INSERT INTO received VALUES (?1, ?2)", params![i as i64, hash.as_bytes()])?;
                let mut insert = tx.prepare_cached("INSERT INTO kv VALUES (?1, ?2)")?;
                for r in records {
                    insert.execute(params![attribute_key(i as i64, &r.key, 0), r.value])?;
                }
            }
        }
    }
    let doc = document(&rebuild(truth, &tx)?);
    tx.execute("INSERT INTO page VALUES (?1, 0, ?2)", params![SERIES, doc])?;
    tx.commit()?;
    Ok(db)
}

/// The page values of every instance, from the truth's latest revision of each.
pub fn rebuild(truth: Truth, db: &Connection) -> Result<Vec<PageValues>> {
    match truth {
        Truth::Groups => {
            let mut q = db.prepare_cached(
                "SELECT bytes FROM grp g WHERE instance > 0
                   AND revision = (SELECT max(revision) FROM grp WHERE instance = g.instance) ORDER BY instance",
            )?;
            let mut rows = q.query([])?;
            let mut page = Vec::new();
            while let Some(row) = rows.next()? {
                page.push(tagged(&group::parse(row.get_ref(0)?.as_blob()?)?));
            }
            Ok(page)
        }
        Truth::Attributes => {
            let lo = attribute_key(1, &[], 0)[..8].to_vec();
            let mut q = db.prepare_cached("SELECT key, value FROM kv WHERE key >= ?1 ORDER BY key")?;
            let mut rows = q.query([lo])?;
            let mut page: Vec<PageValues> = Vec::new();
            let mut current = [0u8; 8];
            while let Some(row) = rows.next()? {
                let key = row.get_ref(0)?.as_blob()?;
                if current != key[..8] {
                    current.copy_from_slice(&key[..8]);
                    page.push(Default::default());
                }
                if key.len() == 20 {
                    let tag: Tag = key[8..12].try_into().unwrap();
                    if let Some(i) = group::PAGE_TAGS.iter().position(|t| *t == tag) {
                        page.last_mut().unwrap()[i] = Some(row.get(1)?);
                    }
                }
            }
            Ok(page)
        }
    }
}

pub fn read_page(db: &Connection) -> Result<Vec<u8>> {
    let mut q = db.prepare_cached("SELECT document FROM page WHERE series = ?1")?;
    Ok(q.query_row([SERIES], |r| r.get(0))?)
}

/// One correction: `instance`'s rescale intercept becomes `value`, kept as a new revision beside the received one,
/// and the series' page row follows in the same commit: rebuilt from every instance, or with `patch` only this
/// instance's entry rewritten.
pub fn update(truth: Truth, db: &mut Connection, instance: i64, value: &[u8], patch: bool) -> Result<()> {
    let tx = db.transaction()?;
    let (revision, values) = new_revision(truth, &tx, instance, value)?;
    let doc = if patch {
        let mut entries: Vec<Entry> = serde_json::from_slice(&read_page(&tx)?)?;
        entries[instance as usize - 1] = entry(&values);
        serde_json::to_vec(&entries)?
    } else {
        document(&rebuild(truth, &tx)?)
    };
    tx.execute("UPDATE page SET revision = ?1, document = ?2 WHERE series = ?3", params![revision, doc, SERIES])?;
    tx.commit()?;
    Ok(())
}

/// Writes the corrected value as a new revision; returns the revision and the instance's page values after it.
fn new_revision(truth: Truth, tx: &Connection, instance: i64, value: &[u8]) -> Result<(i64, PageValues)> {
    match truth {
        Truth::Groups => {
            let (revision, bytes): (i64, Vec<u8>) = tx.query_row(
                "SELECT revision, bytes FROM grp WHERE instance = ?1 ORDER BY revision DESC LIMIT 1",
                [instance],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let mut records = group::parse(&bytes)?;
            let r = records.iter_mut().find(|r| r.tag() == RESCALE_INTERCEPT).context("no rescale intercept")?;
            r.value = value.to_vec();
            let bytes = group::write(&records);
            tx.execute(
                "INSERT INTO grp VALUES (?1, ?2, ?3, ?4)",
                params![instance, revision + 1, bytes, blake3::hash(&bytes).as_bytes()],
            )?;
            Ok((revision + 1, tagged(&records)))
        }
        Truth::Attributes => {
            let (key, _) = latest_attribute(tx, instance, RESCALE_INTERCEPT)?;
            let revision = u32::from_be_bytes(key[16..20].try_into()?) + 1;
            tx.execute(
                "INSERT INTO kv VALUES (?1, ?2)",
                params![attribute_key(instance, &key[8..16], revision), value],
            )?;
            let p = &attribute_key(instance, &[], 0)[..8];
            let mut q = tx.prepare_cached("SELECT key, value FROM kv WHERE key > ?1 AND key < ?2 ORDER BY key")?;
            let rows = q.query_map(params![p, [p, &[0xFF; 16]].concat()], |r| {
                Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, Vec<u8>>(1)?))
            })?;
            let mut tagged_rows = Vec::new();
            for row in rows {
                let (k, v) = row?;
                if k.len() == 20 {
                    tagged_rows.push((k[8..12].try_into().unwrap(), v));
                }
            }
            Ok((revision as i64, group::page_values(tagged_rows)))
        }
    }
}

fn latest_attribute(db: &Connection, instance: i64, tag: Tag) -> Result<(Vec<u8>, Vec<u8>)> {
    let p = &attribute_key(instance, &[], 0)[..8];
    let mut q = db.prepare_cached("SELECT key, value FROM kv WHERE key > ?1 AND key < ?2 ORDER BY key DESC LIMIT 1")?;
    let lo = [p, &tag].concat();
    let hi = [p, &tag, &[0xFF; 9]].concat();
    q.query_row(params![lo, hi], |r| Ok((r.get(0)?, r.get(1)?))).optional()?.context("no such attribute")
}

/// Every received group's BLAKE3 still holds: T1 hashes the stored blob, T2 reassembles revision 0 first.
pub fn check_received(truth: Truth, db: &Connection) -> Result<usize> {
    let mut checked = 0;
    match truth {
        Truth::Groups => {
            let mut q = db.prepare_cached("SELECT bytes, blake3 FROM grp WHERE revision = 0")?;
            let mut rows = q.query([])?;
            while let Some(row) = rows.next()? {
                ensure!(blake3::hash(row.get_ref(0)?.as_blob()?).as_bytes() == row.get_ref(1)?.as_blob()?, "a group's BLAKE3 fails");
                checked += 1;
            }
        }
        Truth::Attributes => {
            let mut q = db.prepare_cached("SELECT instance, blake3 FROM received")?;
            let hashes: Vec<(i64, Vec<u8>)> = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
            let mut rows = db.prepare_cached("SELECT key, value FROM kv WHERE key >= ?1 AND key < ?2")?;
            for (instance, hash) in hashes {
                let p = &attribute_key(instance, &[], 0)[..8];
                let records: Vec<Record> = rows
                    .query_map(params![p, [p, &[0xFF; 16]].concat()], |r| {
                        let key: Vec<u8> = r.get(0)?;
                        Ok((key, r.get::<_, Vec<u8>>(1)?))
                    })?
                    .filter_map(|r| r.ok())
                    .filter(|(k, _)| k[k.len() - 4..] == [0; 4])
                    .map(|(k, value)| Record { key: k[8..k.len() - 4].to_vec(), value })
                    .collect();
                ensure!(blake3::hash(&group::write(&records)).as_bytes() == hash.as_slice(), "instance {instance}'s BLAKE3 fails");
                checked += 1;
            }
        }
    }
    Ok(checked)
}

/// Bytes this process has handed to `write` so far (`/proc/self/io` wchar).
pub fn written() -> u64 {
    std::fs::read_to_string("/proc/self/io")
        .ok()
        .and_then(|s| s.lines().find_map(|l| l.strip_prefix("wchar: ").and_then(|v| v.trim().parse().ok())))
        .unwrap_or(0)
}

/// `CLOCK_MONOTONIC` in ns, the one clock both processes share.
pub fn now_ns() -> u64 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `ts` is a valid, writable timespec for the duration of the call.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64
}

/// Pins the calling process to one core.
pub fn pin(core: usize) -> Result<()> {
    // SAFETY: the set is zeroed, filled with one valid core index, and passed with its own size.
    let ok = unsafe {
        let mut set: libc::cpu_set_t = std::mem::zeroed();
        libc::CPU_SET(core, &mut set);
        libc::sched_setaffinity(0, std::mem::size_of::<libc::cpu_set_t>(), &set)
    };
    ensure!(ok == 0, "sched_setaffinity to core {core} failed");
    Ok(())
}

/// The second process: reads the page row until `stop` exists, every document one of `valid`; writes each read's
/// start and end (ns, `now_ns`) to `intervals`.
pub fn reader(db: &Path, valid: &[Vec<u8>], stop: &Path, intervals: &Path) -> Result<serde_json::Value> {
    let conn = open(db)?;
    let (mut mixed, mut out) = (0u64, Vec::new());
    while !stop.exists() {
        let start = now_ns();
        let doc = read_page(&conn)?;
        out.extend_from_slice(&start.to_le_bytes());
        out.extend_from_slice(&now_ns().to_le_bytes());
        mixed += !valid.contains(&doc) as u64;
    }
    std::fs::write(intervals, &out)?;
    Ok(serde_json::json!({"reads": out.len() / 16, "neither_before_nor_after": mixed}))
}
