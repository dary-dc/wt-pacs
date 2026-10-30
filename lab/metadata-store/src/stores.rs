//! The four stores of docs/ingest/metadata-draft.md §2, each built from the same groups and read for the same page.

use crate::group::{self, PageValues, Record, Tag, PAGE_TAGS};
use anyhow::{bail, Context, Result};
use memmap2::Mmap;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};

const SERIES_NUMBER: u16 = 1;

/// DECK's 8-byte prefix `sSSiIIFF` (docs/ingest/contract.md §DECK's key); instance 0 is the series level.
fn prefix(series: u16, instance: u16) -> [u8; 8] {
    let [s0, s1] = series.to_be_bytes();
    let [i0, i1] = instance.to_be_bytes();
    [1, s0, s1, (instance > 0) as u8, i0, i1, 0, 0]
}

fn deck_key(prefix: &[u8; 8], record_key: &[u8]) -> Vec<u8> {
    [prefix.as_slice(), record_key].concat()
}

fn bound(prefix: &[u8], tag: Tag, fill: u8) -> Vec<u8> {
    [prefix, &tag, &[fill; 4]].concat()
}

fn first_page_key(p: &[u8]) -> Vec<u8> {
    bound(p, PAGE_TAGS[0], 0x00)
}

fn last_page_key(p: &[u8]) -> Vec<u8> {
    bound(p, PAGE_TAGS[5], 0xFF)
}

fn number(values: &PageValues) -> i64 {
    values[0]
        .as_deref()
        .and_then(|v| String::from_utf8_lossy(v).trim().parse().ok())
        .unwrap_or(0)
}

fn top_level(key: &[u8]) -> Option<Tag> {
    (key.len() == 16).then(|| key[8..12].try_into().unwrap())
}

pub struct Paths {
    pub files: PathBuf,
    pub columns: PathBuf,
    pub rows: PathBuf,
    pub keys: PathBuf,
    pub values: PathBuf,
}

impl Paths {
    pub fn under(dir: &Path) -> Self {
        Paths {
            files: dir.join("a-files"),
            columns: dir.join("b-columns.db"),
            rows: dir.join("c-rows.db"),
            keys: dir.join("d-keys.bin"),
            values: dir.join("d-values.bin"),
        }
    }
}

pub fn build(paths: &Paths, series: &[Record], instances: &[Vec<Record>]) -> Result<()> {
    build_files(&paths.files, series, instances)?;
    build_columns(&paths.columns, instances)?;
    build_rows(&paths.rows, series, instances)?;
    build_keys(&paths.keys, &paths.values, series, instances)
}

// A. The parser's directory.

fn build_files(dir: &Path, series: &[Record], instances: &[Vec<Record>]) -> Result<()> {
    fs::create_dir_all(dir)?;
    fs::write(dir.join(format!("---.{:064x}", 0)), group::write(series))?;
    for (i, records) in instances.iter().enumerate() {
        let inst = dir.join(format!("{:05}", i + 1));
        fs::create_dir_all(&inst)?;
        fs::write(
            inst.join(format!("----.{:064x}", i + 1)),
            group::write(records),
        )?;
    }
    Ok(())
}

pub fn read_files(dir: &Path) -> Result<Vec<PageValues>> {
    let mut page = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        for file in fs::read_dir(entry.path())? {
            let file = file?;
            if file.file_name().to_string_lossy().starts_with("----.") {
                let records = group::parse(&fs::read(file.path())?)?;
                page.push(group::page_values(
                    records.into_iter().map(|r| (r.tag(), r.value)),
                ));
            }
        }
    }
    page.sort_by_key(number);
    Ok(page)
}

// B. Each group whole, plus a column per page value copied out of it.

fn build_columns(path: &Path, instances: &[Vec<Record>]) -> Result<()> {
    let mut db = Connection::open(path)?;
    db.execute_batch(
        "CREATE TABLE instance (iuid BLOB PRIMARY KEY, suid INTEGER, number INTEGER,
                                t0 BLOB, t1 BLOB, t2 BLOB, t3 BLOB, t4 BLOB, t5 BLOB, grp BLOB);
         CREATE INDEX by_series ON instance (suid, number);",
    )?;
    let tx = db.transaction()?;
    {
        let mut insert =
            tx.prepare("INSERT INTO instance VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")?;
        for records in instances {
            let v = group::page_values(records.iter().map(|r| (r.tag(), r.value.clone())));
            let uid = records
                .iter()
                .find(|r| r.tag() == group::SOP_INSTANCE_UID)
                .map(|r| r.value.clone());
            insert.execute(params![
                uid,
                SERIES_NUMBER,
                number(&v),
                v[0],
                v[1],
                v[2],
                v[3],
                v[4],
                v[5],
                group::write(records)
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn open(path: &Path) -> Result<Connection> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

pub fn read_columns(db: &Connection) -> Result<Vec<PageValues>> {
    let mut query = db.prepare_cached(
        "SELECT t0, t1, t2, t3, t4, t5 FROM instance WHERE suid = ?1 ORDER BY number",
    )?;
    let rows = query.query_map([SERIES_NUMBER], |r| {
        Ok([
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get(4)?,
            r.get(5)?,
        ])
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// C. One row per attribute, keyed by DECK's ordered key.

fn deck_rows(series: &[Record], instances: &[Vec<Record>]) -> Vec<(Vec<u8>, Vec<u8>)> {
    let level = |p: [u8; 8], rs: &[Record]| {
        rs.iter()
            .map(move |r| (deck_key(&p, &r.key), r.value.clone()))
            .collect::<Vec<_>>()
    };
    let mut rows = level(prefix(SERIES_NUMBER, 0), series);
    for (i, records) in instances.iter().enumerate() {
        rows.extend(level(prefix(SERIES_NUMBER, i as u16 + 1), records));
    }
    rows.sort();
    rows
}

fn build_rows(path: &Path, series: &[Record], instances: &[Vec<Record>]) -> Result<()> {
    let mut db = Connection::open(path)?;
    db.execute_batch("CREATE TABLE kv (key BLOB PRIMARY KEY, value BLOB) WITHOUT ROWID;")?;
    let tx = db.transaction()?;
    {
        let mut insert = tx.prepare("INSERT INTO kv VALUES (?1, ?2)")?;
        for (k, v) in deck_rows(series, instances) {
            insert.execute(params![k, v])?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn series_range() -> (Vec<u8>, Vec<u8>) {
    (
        prefix(SERIES_NUMBER, 1).to_vec(),
        prefix(SERIES_NUMBER + 1, 0).to_vec(),
    )
}

/// Rows in key order, one instance per prefix, keeping the page's tags.
fn page_from(mut rows: rusqlite::Rows) -> Result<Vec<PageValues>> {
    let mut page: Vec<PageValues> = Vec::new();
    let mut current = [0u8; 8];
    while let Some(row) = rows.next()? {
        let key = row.get_ref(0)?.as_blob()?;
        if current != key[..8] {
            current.copy_from_slice(&key[..8]);
            page.push(Default::default());
        }
        if let Some(i) = top_level(key).and_then(|t| PAGE_TAGS.iter().position(|p| *p == t)) {
            page.last_mut().unwrap()[i] = Some(row.get(1)?);
        }
    }
    Ok(page)
}

/// Every row of the series, in key order, keeping the page's tags.
pub fn read_rows_scan(db: &Connection) -> Result<Vec<PageValues>> {
    let (lo, hi) = series_range();
    let mut query = db.prepare_cached("SELECT key, value FROM kv WHERE key >= ?1 AND key < ?2")?;
    let page = page_from(query.query(params![lo, hi])?);
    page
}

/// The series' rows, with SQLite keeping only the page's tags: one statement, no row it does not need leaves it.
pub fn read_rows_filter(db: &Connection) -> Result<Vec<PageValues>> {
    let (lo, hi) = series_range();
    let mut query = db.prepare_cached(
        "SELECT key, value FROM kv WHERE key >= ?1 AND key < ?2 AND length(key) = 16
           AND substr(key, 9, 4) IN (x'00200013', x'00280004', x'00281050', x'00281051', x'00281052', x'00281053')",
    )?;
    let page = page_from(query.query(params![lo, hi])?);
    page
}

/// Per instance, only the key range of the page's tags; then a jump to the next instance's first key.
pub fn read_rows_seek(db: &Connection) -> Result<Vec<PageValues>> {
    let (_, hi) = series_range();
    let mut next = db.prepare_cached("SELECT key FROM kv WHERE key > ?1 AND key < ?2 LIMIT 1")?;
    let mut range = db.prepare_cached("SELECT key, value FROM kv WHERE key >= ?1 AND key <= ?2")?;
    let mut page = Vec::new();
    let mut after = [prefix(SERIES_NUMBER, 0).as_slice(), &[0xFF; 8]].concat();
    while let Some(key) = next
        .query_row(params![after, hi], |r| r.get::<_, Vec<u8>>(0))
        .optional()?
    {
        let p = &key[..8];
        let rows = range.query_map(params![first_page_key(p), last_page_key(p)], |r| {
            Ok((r.get::<_, Vec<u8>>(0)?, r.get(1)?))
        })?;
        let mut tagged = Vec::new();
        for row in rows {
            let (k, v) = row?;
            if let Some(t) = top_level(&k) {
                tagged.push((t, v));
            }
        }
        page.push(group::page_values(tagged));
        after = [p, &[0xFF; 8]].concat();
    }
    Ok(page)
}

/// An instance's group, put back together from its rows: the parser's bytes, for the parser's BLAKE3.
pub fn group_from_rows(db: &Connection, instance: u16) -> Result<Vec<u8>> {
    let p = prefix(SERIES_NUMBER, instance);
    let mut query = db.prepare_cached("SELECT key, value FROM kv WHERE key > ?1 AND key < ?2")?;
    let rows = query.query_map(
        params![p.to_vec(), [p.as_slice(), &[0xFF; 9]].concat()],
        |r| {
            Ok(Record {
                key: r.get::<_, Vec<u8>>(0)?[8..].to_vec(),
                value: r.get(1)?,
            })
        },
    )?;
    Ok(group::write(&rows.collect::<rusqlite::Result<Vec<_>>>()?))
}

// D. A sorted key file with each value's place, searched without an engine; the values apart.

const KEY: usize = 16;
const ENTRY: usize = KEY + 8;

fn build_keys(
    keys: &Path,
    values: &Path,
    series: &[Record],
    instances: &[Vec<Record>],
) -> Result<()> {
    let (mut k, mut v) = (Vec::new(), Vec::new());
    for (key, value) in deck_rows(series, instances) {
        if key.len() != KEY {
            bail!(
                "a {}-byte key: the fixed-width key file holds top-level attributes only",
                key.len()
            );
        }
        k.extend_from_slice(&key);
        k.extend_from_slice(&(v.len() as u32).to_le_bytes());
        k.extend_from_slice(&(value.len() as u32).to_le_bytes());
        v.extend_from_slice(&value);
    }
    fs::write(keys, k)?;
    fs::write(values, v)?;
    Ok(())
}

pub struct KeyFile {
    keys: Mmap,
    values: Mmap,
}

impl KeyFile {
    pub fn open(keys: &Path, values: &Path) -> Result<Self> {
        // SAFETY: both files are written once before this run maps them and never change while mapped.
        let map = |p: &Path| {
            unsafe { Mmap::map(&fs::File::open(p).with_context(|| p.display().to_string())?) }
                .map_err(anyhow::Error::from)
        };
        Ok(KeyFile {
            keys: map(keys)?,
            values: map(values)?,
        })
    }

    fn len(&self) -> usize {
        self.keys.len() / ENTRY
    }

    fn key(&self, i: usize) -> &[u8] {
        &self.keys[i * ENTRY..i * ENTRY + KEY]
    }

    fn value(&self, i: usize) -> Vec<u8> {
        let e = &self.keys[i * ENTRY + KEY..(i + 1) * ENTRY];
        let off = u32::from_le_bytes(e[..4].try_into().unwrap()) as usize;
        let len = u32::from_le_bytes(e[4..].try_into().unwrap()) as usize;
        self.values[off..off + len].to_vec()
    }

    /// The first entry whose key is not below `key`.
    fn find(&self, key: &[u8]) -> usize {
        let (mut lo, mut hi) = (0, self.len());
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.key(mid) < key {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }

    pub fn read_scan(&self) -> Vec<PageValues> {
        let (lo, hi) = series_range();
        let mut page: Vec<PageValues> = Vec::new();
        let mut current: &[u8] = &[];
        for i in self.find(&lo)..self.find(&hi) {
            let key = self.key(i);
            if current != &key[..8] {
                current = &key[..8];
                page.push(Default::default());
            }
            if let Some(t) = PAGE_TAGS.iter().position(|p| *p == key[8..12]) {
                page.last_mut().unwrap()[t] = Some(self.value(i));
            }
        }
        page
    }

    pub fn read_seek(&self) -> Vec<PageValues> {
        let (lo, hi) = series_range();
        let (mut i, end) = (self.find(&lo), self.find(&hi));
        let mut page = Vec::new();
        while i < end {
            let p = self.key(i)[..8].to_vec();
            let last = last_page_key(&p);
            let mut j = self.find(&first_page_key(&p));
            let mut tagged = Vec::new();
            while j < end && self.key(j) <= last.as_slice() {
                tagged.push((self.key(j)[8..12].try_into().unwrap(), self.value(j)));
                j += 1;
            }
            page.push(group::page_values(tagged));
            i = self.find(&[p.as_slice(), &[0xFF; 8]].concat());
        }
        page
    }
}

pub fn on_disk(paths: &Paths) -> Result<serde_json::Value> {
    fn walk(dir: &Path, files: &mut u64, bytes: &mut u64, blocks: &mut u64) -> Result<()> {
        use std::os::unix::fs::MetadataExt;
        for entry in fs::read_dir(dir)? {
            let m = entry?.path();
            let meta = fs::metadata(&m)?;
            *blocks += meta.blocks() * 512;
            if meta.is_dir() {
                walk(&m, files, bytes, blocks)?;
            } else {
                *files += 1;
                *bytes += meta.len();
            }
        }
        Ok(())
    }
    let (mut files, mut bytes, mut allocated) = (0, 0, 0);
    walk(&paths.files, &mut files, &mut bytes, &mut allocated)?;
    let size = |p: &Path| fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    Ok(serde_json::json!({
        "A": {"files": files, "bytes": bytes, "allocated": allocated},
        "B": {"bytes": size(&paths.columns)},
        "C": {"bytes": size(&paths.rows)},
        "D": {"bytes": size(&paths.keys) + size(&paths.values)},
    }))
}
