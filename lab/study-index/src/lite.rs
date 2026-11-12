//! The index on SQLite, one file on the host: `lite.sql`'s schema, one writer, a pool of WAL readers.

use crate::engine::{Rows, P};
use crate::index::{Applied, Record};
use crate::pg::{series_insert, study_params};
use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

pub const SCHEMA: &str = include_str!("../lite.sql");
pub const INDEXES: &str = include_str!("../lite_indexes.sql");

/// README §Engines: the page cache through mmap, shared by every connection, and a small private cache each.
fn tune(c: &Connection) -> rusqlite::Result<()> {
    c.pragma_update(None, "mmap_size", 16i64 << 30)?;
    c.pragma_update(None, "cache_size", -65_536)?;
    c.pragma_update(None, "temp_store", "MEMORY")?;
    c.busy_timeout(std::time::Duration::from_secs(5))
}

pub fn open_writer(path: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.pragma_update(None, "journal_mode", "WAL")?;
    c.pragma_update(None, "synchronous", "FULL")?;
    tune(&c)?;
    Ok(c)
}

pub struct Lite {
    path: PathBuf,
    writer: Mutex<Connection>,
    readers: Mutex<Vec<Connection>>,
}

/// PS3.4 PN matching's key: canonical decomposition, combining marks dropped, lower case.
pub fn pn_key(s: &str) -> String {
    s.nfd().filter(|c| !is_combining_mark(*c)).flat_map(char::to_lowercase).collect()
}

/// A PN pattern as SQLite matches `name_key`: the folded literal prefix and the folded `GLOB`, `[` escaped.
pub fn pn_glob(pattern: &str) -> (String, String) {
    let literal: String = pattern.chars().take_while(|c| !matches!(c, '*' | '?')).collect();
    let glob = pn_key(pattern).replace('[', "[[]");
    (pn_key(&literal), glob)
}

fn value(p: P) -> Value {
    match p {
        P::Text(s) => Value::Text(s),
        P::Null => Value::Null,
        P::Int(v) => Value::Integer(v),
    }
}

fn text(v: ValueRef) -> Option<String> {
    match v {
        ValueRef::Null => None,
        ValueRef::Integer(i) => Some(i.to_string()),
        ValueRef::Real(f) => Some(f.to_string()),
        ValueRef::Text(t) | ValueRef::Blob(t) => Some(String::from_utf8_lossy(t).into_owned()),
    }
}

fn query(c: &Connection, sql: &str, params: Vec<P>) -> rusqlite::Result<Rows> {
    let mut st = c.prepare_cached(sql)?;
    let n = st.column_count();
    let mut rows = st.query(params_from_iter(params.into_iter().map(value)))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push((0..n).map(|i| row.get_ref(i).map(text)).collect::<rusqlite::Result<_>>()?);
    }
    Ok(out)
}

/// `YYYY-MM-DD` or `HH:MM:SS` as DICOM's `YYYYMMDD` or `HHMMSS`, which the file stores.
fn dicom(p: &mut P) {
    if let P::Text(s) = p {
        s.retain(|c| c != '-' && c != ':');
    }
}

fn write(c: &mut Connection, r: &Record) -> rusqlite::Result<Applied> {
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let stored: Option<i64> =
        tx.prepare_cached("SELECT revision FROM study WHERE study_uid = ?1")?.query_row([&r.uid], |row| row.get(0)).optional()?;
    if stored.is_some_and(|s| s as u64 >= r.revision) {
        return Ok(Applied::Stale);
    }
    tx.prepare_cached("DELETE FROM series WHERE study_uid = ?1")?.execute([&r.uid])?;
    if r.deleted {
        tx.prepare_cached("DELETE FROM study WHERE study_uid = ?1")?.execute([&r.uid])?;
        tx.commit()?;
        return Ok(Applied::Deleted);
    }
    let mut params = study_params(r);
    for i in [7, 9, 10] {
        dicom(&mut params[i]);
    }
    params.push(P::Text(pn_key(&r.patient_name)));
    tx.prepare_cached(UPSERT)?.execute(params_from_iter(params.into_iter().map(value)))?;
    if !r.series.is_empty() {
        let (sql, params) = series_insert(r);
        tx.prepare_cached(&sql)?.execute(params_from_iter(params.into_iter().map(value)))?;
    }
    tx.commit()?;
    Ok(Applied::Replaced)
}

const UPSERT: &str = "INSERT INTO study (study_uid, host, revision, access_key, patient_name, patient_id, \
    issuer_of_patient_id, patient_birth_date, patient_sex, study_date, study_time, accession_number, study_id, \
    referring_physician_name, modalities_in_study, study_description, number_of_series, number_of_instances, name_key) \
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (study_uid) DO UPDATE SET host = excluded.host, \
    revision = excluded.revision, access_key = excluded.access_key, patient_name = excluded.patient_name, \
    patient_id = excluded.patient_id, issuer_of_patient_id = excluded.issuer_of_patient_id, \
    patient_birth_date = excluded.patient_birth_date, patient_sex = excluded.patient_sex, \
    study_date = excluded.study_date, study_time = excluded.study_time, accession_number = excluded.accession_number, \
    study_id = excluded.study_id, referring_physician_name = excluded.referring_physician_name, \
    modalities_in_study = excluded.modalities_in_study, study_description = excluded.study_description, \
    number_of_series = excluded.number_of_series, number_of_instances = excluded.number_of_instances, \
    name_key = excluded.name_key, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')";

impl Lite {
    pub fn open(path: &str) -> anyhow::Result<Lite> {
        let path = PathBuf::from(path);
        anyhow::ensure!(path.exists(), "no index file {}", path.display());
        Ok(Lite { writer: Mutex::new(open_writer(&path)?), readers: Mutex::new(Vec::new()), path })
    }

    fn reader(&self) -> rusqlite::Result<Connection> {
        if let Some(c) = self.readers.lock().expect("readers").pop() {
            return Ok(c);
        }
        let c = Connection::open(&self.path)?;
        tune(&c)?;
        c.pragma_update(None, "query_only", true)?;
        Ok(c)
    }

    /// A `SELECT` on a pooled reader, anything else on the writer; both off the async workers.
    pub async fn rows(self: std::sync::Arc<Self>, sql: String, params: Vec<P>) -> anyhow::Result<Rows> {
        Ok(tokio::task::spawn_blocking(move || -> rusqlite::Result<Rows> {
            if sql.trim_start().starts_with("SELECT") {
                let c = self.reader()?;
                let out = query(&c, &sql, params);
                self.readers.lock().expect("readers").push(c);
                out
            } else {
                query(&self.writer.lock().expect("writer"), &sql, params)
            }
        })
        .await??)
    }

    pub async fn write(self: std::sync::Arc<Self>, r: Record) -> anyhow::Result<Applied> {
        Ok(tokio::task::spawn_blocking(move || write(&mut self.writer.lock().expect("writer"), &r)).await??)
    }

    pub async fn remove(self: std::sync::Arc<Self>, uid: String) -> anyhow::Result<()> {
        Ok(tokio::task::spawn_blocking(move || -> rusqlite::Result<()> {
            let mut c = self.writer.lock().expect("writer");
            let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            tx.execute("DELETE FROM series WHERE study_uid = ?1", [&uid])?;
            tx.execute("DELETE FROM study WHERE study_uid = ?1", [&uid])?;
            tx.commit()
        })
        .await??)
    }
}

/// A file from `gen`'s TSV: rows first, then `lite_indexes.sql` and `ANALYZE`. `fold: false` is the broken control.
pub fn load(tsv: &str, out: &Path, fold: bool) -> anyhow::Result<()> {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", out.display()));
    }
    let mut c = open_writer(out)?;
    c.execute_batch(SCHEMA)?;
    let field = |f: &str| if f == "\\N" { Value::Null } else { Value::Text(f.replace("\\\\", "\\")) };
    let tx = c.transaction()?;
    {
        let mut st = tx.prepare(&UPSERT[..UPSERT.find(" ON CONFLICT").expect("upsert")])?;
        for line in std::fs::read_to_string(format!("{tsv}.study.tsv"))?.lines() {
            let f: Vec<&str> = line.split('\t').collect();
            let mut v: Vec<Value> = f.iter().map(|x| field(x)).collect();
            for i in [7, 9, 10] {
                if let Value::Text(s) = &mut v[i] {
                    s.retain(|c| c != '-' && c != ':');
                }
            }
            v.push(Value::Text(if fold { pn_key(f[4]) } else { f[4].to_string() }));
            st.execute(params_from_iter(v))?;
        }
        let mut st = tx.prepare("INSERT INTO series VALUES (?,?,?,?,?,?,?,?)")?;
        for line in std::fs::read_to_string(format!("{tsv}.series.tsv"))?.lines() {
            st.execute(params_from_iter(line.split('\t').map(field)))?;
        }
    }
    tx.commit()?;
    c.execute_batch(INDEXES)?;
    c.execute_batch("ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}

/// What a reader connection runs with, and each table's and index's bytes by `dbstat`.
pub fn settings(path: &str) -> anyhow::Result<()> {
    let c = Connection::open(path)?;
    tune(&c)?;
    let version: String = c.query_row("SELECT sqlite_version()", [], |r| r.get(0))?;
    println!("sqlite_version {version}");
    for p in ["journal_mode", "synchronous", "mmap_size", "cache_size", "page_size", "temp_store", "page_count"] {
        let v: String = c.query_row(&format!("PRAGMA {p}"), [], |r| r.get_ref(0).map(|v| text(v).unwrap_or_default()))?;
        println!("{p} {v}");
    }
    let mut st = c.prepare("SELECT name, SUM(pgsize) FROM dbstat GROUP BY name ORDER BY name")?;
    let mut rows = st.query([])?;
    while let Some(r) = rows.next()? {
        println!("dbstat {} {}", r.get::<_, String>(0)?, r.get::<_, i64>(1)?);
    }
    Ok(())
}
