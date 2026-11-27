//! A host's side of docs/adr/study-index.md §7: a stand-in study DB per study, whose commit carries its own outbox
//! row in the same SQLite transaction; a publisher that drains outbox rows into the index; the reconcile job.

use crate::gen::{sql_time, Study};
use crate::engine::Index;
use crate::index::{Applied, Record, SeriesRecord};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedReceiver;

const SCHEMA: &str = "
CREATE TABLE study (uid TEXT PRIMARY KEY, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, host TEXT NOT NULL,
  access_key TEXT NOT NULL, patient_name TEXT NOT NULL, patient_id TEXT NOT NULL, issuer TEXT NOT NULL,
  birth_date TEXT NOT NULL, sex TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, accession TEXT NOT NULL,
  study_id TEXT NOT NULL, referring TEXT NOT NULL, description TEXT NOT NULL);
CREATE TABLE series (uid TEXT PRIMARY KEY, modality TEXT NOT NULL, number INTEGER NOT NULL,
  description TEXT NOT NULL, instances INTEGER NOT NULL, frames INTEGER NOT NULL, codec TEXT NOT NULL);
CREATE TABLE outbox (revision INTEGER NOT NULL);";

fn open(path: &Path, durable: bool) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.pragma_update(None, "journal_mode", "WAL")?;
    c.pragma_update(None, "synchronous", if durable { "FULL" } else { "OFF" })?;
    Ok(c)
}

pub fn path_of(dir: &Path, uid: &str) -> PathBuf {
    dir.join(format!("{uid}.db"))
}

fn iso(days: i32) -> String {
    let (y, m, d) = crate::gen::ymd(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The receiver's commit of a new study: study DB and outbox row in one transaction. `durable: false` only seeds.
pub fn commit_new(dir: &Path, s: &Study, host: &str, access_key: &str, durable: bool) -> rusqlite::Result<PathBuf> {
    let path = path_of(dir, &s.uid);
    let mut c = open(&path, durable)?;
    let tx = c.transaction()?;
    tx.execute_batch(SCHEMA)?;
    tx.execute(
        "INSERT INTO study VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            s.uid, s.revision as i64, host, access_key, s.patient_name, s.patient_id, s.issuer, iso(s.birth_date), s.sex,
            iso(s.date), sql_time(s.time), s.accession, s.study_id, s.referring, s.description
        ],
    )?;
    for r in &s.series {
        tx.execute(
            "INSERT INTO series VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![r.uid, r.modality, r.number, r.description, r.instances, r.frames, r.codec],
        )?;
    }
    tx.execute("INSERT INTO outbox VALUES (?1)", params![s.revision as i64])?;
    tx.commit()?;
    Ok(path)
}

/// An audited update in the real receiver; here the patient's name, revision + 1, and its outbox row, atomically.
pub fn correct_name(path: &Path, name: &str) -> rusqlite::Result<u64> {
    let mut c = open(path, true)?;
    let tx = c.transaction()?;
    let revision: i64 = tx.query_row("SELECT revision + 1 FROM study", [], |r| r.get(0))?;
    tx.execute("UPDATE study SET patient_name = ?1, revision = ?2", params![name, revision])?;
    tx.execute("INSERT INTO outbox VALUES (?1)", params![revision])?;
    tx.commit()?;
    Ok(revision as u64)
}

#[cfg_attr(not(test), allow(dead_code))]
/// A deletion is a tombstone at revision + 1; the file goes once the index has dropped the study.
pub fn delete(path: &Path) -> rusqlite::Result<u64> {
    let mut c = open(path, true)?;
    let tx = c.transaction()?;
    let revision: i64 = tx.query_row("SELECT revision + 1 FROM study", [], |r| r.get(0))?;
    tx.execute("UPDATE study SET deleted = 1, revision = ?1", params![revision])?;
    tx.execute("INSERT INTO outbox VALUES (?1)", params![revision])?;
    tx.commit()?;
    Ok(revision as u64)
}

/// The study as committed, and whether it owes the index an outbox row.
pub fn read(path: &Path) -> rusqlite::Result<(Record, bool)> {
    let c = Connection::open(path)?;
    let tx = c.unchecked_transaction()?;
    let mut r = tx.query_row("SELECT * FROM study", [], |row| {
        Ok(Record {
            uid: row.get(0)?,
            revision: row.get::<_, i64>(1)? as u64,
            deleted: row.get::<_, i64>(2)? != 0,
            host: row.get(3)?,
            access_key: row.get(4)?,
            patient_name: row.get(5)?,
            patient_id: row.get(6)?,
            issuer: row.get(7)?,
            birth_date: row.get(8)?,
            sex: row.get(9)?,
            date: row.get(10)?,
            time: row.get(11)?,
            accession: row.get(12)?,
            study_id: row.get(13)?,
            referring: row.get(14)?,
            description: row.get(15)?,
            series: Vec::new(),
        })
    })?;
    let mut st = tx.prepare("SELECT uid, modality, number, description, instances, frames, codec FROM series")?;
    r.series = st
        .query_map([], |row| {
            Ok(SeriesRecord {
                uid: row.get(0)?,
                modality: row.get(1)?,
                number: row.get(2)?,
                description: row.get(3)?,
                instances: row.get(4)?,
                frames: row.get(5)?,
                codec: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let owed: Option<i64> = tx.query_row("SELECT 1 FROM outbox LIMIT 1", [], |row| row.get(0)).optional()?;
    Ok((r, owed.is_some()))
}

fn remove_files(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

/// One study DB into the index, then its outbox rows up to the revision the index now holds are deleted.
pub async fn publish(pool: &Index, path: &Path) -> anyhow::Result<Applied> {
    let (record, _) = match read(path) {
        Ok(r) => r,
        Err(_) if !path.exists() => {
            let uid = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
            pool.remove(uid).await?;
            return Ok(Applied::Deleted);
        }
        Err(e) => return Err(e.into()),
    };
    let applied = pool.apply(&record).await?;
    if record.deleted {
        remove_files(path);
    } else {
        open(path, true)?.execute("DELETE FROM outbox WHERE revision <= ?1", params![record.revision as i64])?;
    }
    Ok(applied)
}

pub struct Published {
    pub path: PathBuf,
    pub at: Instant,
}

/// Publishes each notified path in order; a failure retries the same path, backing off from 10 ms to `cap`.
pub async fn publisher(
    pool: Index,
    mut notified: UnboundedReceiver<PathBuf>,
    done: tokio::sync::mpsc::UnboundedSender<Published>,
    cap: Duration,
) {
    let mut queue = VecDeque::new();
    let mut backoff = Duration::from_millis(10);
    loop {
        if queue.is_empty() {
            match notified.recv().await {
                Some(p) => queue.push_back(p),
                None => return,
            }
        }
        while let Ok(p) = notified.try_recv() {
            queue.push_back(p);
        }
        let path = queue.front().expect("non-empty").clone();
        match publish(&pool, &path).await {
            Ok(_) => {
                queue.pop_front();
                backoff = Duration::from_millis(10);
                let _ = done.send(Published { path, at: Instant::now() });
            }
            Err(_) => {
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(cap);
            }
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Reconciled {
    pub scanned: usize,
    pub published: usize,
    pub removed: usize,
}

/// At publisher start and daily: every study DB of `host` against the index's rows for it.
pub async fn reconcile(pool: &Index, host: &str, dir: &Path) -> anyhow::Result<Reconciled> {
    let mut indexed: HashMap<String, u64> = pool.revisions(host).await?.into_iter().collect();
    let mut out = Reconciled::default();
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("db") {
            continue;
        }
        out.scanned += 1;
        let (record, owed) = read(&path)?;
        let behind = indexed.remove(&record.uid).is_none_or(|have| have < record.revision);
        if (behind && !record.deleted) || owed {
            publish(pool, &path).await?;
            out.published += 1;
        }
    }
    for uid in indexed.keys() {
        pool.remove(uid).await?;
        out.removed += 1;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{num, P};
    use crate::gen;

    /// A fresh `si_test` index on each engine configured: `SI_TEST_MYSQL` (a server URL without a database),
    /// `SI_TEST_PG` (a server URL whose database `si_test` is dropped and made again), `SI_TEST_SQLITE` (a directory).
    async fn fresh_indexes() -> Vec<(&'static str, Index)> {
        use mysql_async::prelude::Queryable;
        let mut out = Vec::new();
        if let Ok(server) = std::env::var("SI_TEST_MYSQL") {
            let admin = mysql_async::Pool::from_url(server.replace("/?", "/mysql?")).unwrap();
            let mut c = admin.get_conn().await.unwrap();
            c.query_drop("DROP DATABASE IF EXISTS si_test").await.unwrap();
            c.query_drop("CREATE DATABASE si_test").await.unwrap();
            c.query_drop(format!("USE si_test; {}", include_str!("../schema.sql"))).await.unwrap();
            out.push(("mysql", Index::open(&server.replace("/?", "/si_test?")).unwrap()));
        }
        if let Ok(server) = std::env::var("SI_TEST_PG") {
            let (admin, conn) = tokio_postgres::connect(&format!("{server}/postgres"), tokio_postgres::NoTls).await.unwrap();
            tokio::spawn(conn);
            admin.batch_execute("DROP DATABASE IF EXISTS si_test WITH (FORCE)").await.unwrap();
            admin.batch_execute("CREATE DATABASE si_test").await.unwrap();
            let (c, conn) = tokio_postgres::connect(&format!("{server}/si_test"), tokio_postgres::NoTls).await.unwrap();
            tokio::spawn(conn);
            c.batch_execute(concat!(include_str!("../pg.sql"), include_str!("../pg_indexes.sql"))).await.unwrap();
            out.push(("pg", Index::open(&format!("{server}/si_test")).unwrap()));
        }
        if let Ok(d) = std::env::var("SI_TEST_SQLITE") {
            let path = PathBuf::from(d).join("si_test.db");
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
            }
            let c = crate::lite::open_writer(&path).unwrap();
            c.execute_batch(crate::lite::SCHEMA).unwrap();
            c.execute_batch(crate::lite::INDEXES).unwrap();
            out.push(("sqlite", Index::open(&format!("sqlite:{}", path.display())).unwrap()));
        }
        if out.is_empty() {
            eprintln!("no SI_TEST_MYSQL, SI_TEST_PG or SI_TEST_SQLITE: skipped");
        }
        out
    }

    fn dir(name: &str, engine: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("si-test-{name}-{engine}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    async fn indexed(pool: &Index, uid: &str) -> Option<(u64, String, u64)> {
        let sql = "SELECT st.revision, st.patient_name, (SELECT COUNT(*) FROM series se WHERE se.study_uid = st.study_uid) \
                   FROM study st WHERE study_uid = ?";
        let rows = pool.rows(sql.to_string(), vec![P::from(uid)]).await.unwrap();
        rows.first().map(|r| (num(&r[0]), r[1].clone().unwrap_or_default(), num(&r[2])))
    }

    fn owed(path: &Path) -> bool {
        read(path).unwrap().1
    }

    /// A receiver killed after its commit and before any publish: the restarted publisher's reconcile brings the
    /// index to the study DB's revision and clears the outbox.
    #[tokio::test]
    async fn killed_after_commit() {
        for (engine, pool) in fresh_indexes().await {
            let d = dir("commit", engine);
            let s = &gen::studies(1, 1)[0];
            let path = commit_new(&d, s, "h", "k", true).unwrap();
            assert!(owed(&path) && indexed(&pool, &s.uid).await.is_none());
            let r = reconcile(&pool, "h", &d).await.unwrap();
            assert_eq!(r, Reconciled { scanned: 1, published: 1, removed: 0 }, "{engine}");
            assert_eq!(indexed(&pool, &s.uid).await, Some((s.revision, s.patient_name.clone(), s.series.len() as u64)), "{engine}");
            assert!(!owed(&path), "{engine}");
        }
    }

    /// A publisher killed after the index committed and before the outbox row went: publishing again is a no-op on
    /// the index and clears the row.
    #[tokio::test]
    async fn killed_after_index_commit() {
        for (engine, pool) in fresh_indexes().await {
            let d = dir("index", engine);
            let s = &gen::studies(1, 2)[0];
            let path = commit_new(&d, s, "h", "k", true).unwrap();
            assert_eq!(pool.apply(&read(&path).unwrap().0).await.unwrap(), Applied::Replaced, "{engine}");
            assert!(owed(&path));
            assert_eq!(publish(&pool, &path).await.unwrap(), Applied::Stale, "{engine}");
            assert!(!owed(&path), "{engine}");
            assert_eq!(indexed(&pool, &s.uid).await.unwrap().0, s.revision, "{engine}");
        }
    }

    /// Out of order: a lower or equal revision arriving after a higher one leaves the higher.
    #[tokio::test]
    async fn only_a_higher_revision() {
        for (engine, pool) in fresh_indexes().await {
            let d = dir("order", engine);
            let s = &gen::studies(1, 3)[0];
            let mut r = read(&commit_new(&d, s, "h", "k", true).unwrap()).unwrap().0;
            r.revision = 3;
            r.patient_name = "Third^Revision".into();
            assert_eq!(pool.apply(&r).await.unwrap(), Applied::Replaced, "{engine}");
            let mut older = r.clone();
            older.revision = 2;
            older.patient_name = "Second^Revision".into();
            older.series.pop();
            assert_eq!(pool.apply(&older).await.unwrap(), Applied::Stale, "{engine}");
            assert_eq!(pool.apply(&r).await.unwrap(), Applied::Stale, "{engine}");
            assert_eq!(indexed(&pool, &s.uid).await, Some((3, "Third^Revision".into(), r.series.len() as u64)), "{engine}");
        }
    }

    /// A correction and a deletion each travel through the outbox: the name changes at revision + 1, then the
    /// tombstone removes the rows and the file.
    #[tokio::test]
    async fn correction_then_deletion() {
        for (engine, pool) in fresh_indexes().await {
            let d = dir("correct", engine);
            let s = &gen::studies(1, 4)[0];
            let path = commit_new(&d, s, "h", "k", true).unwrap();
            publish(&pool, &path).await.unwrap();
            let rev = correct_name(&path, "Pérez^Corregido").unwrap();
            assert_eq!(publish(&pool, &path).await.unwrap(), Applied::Replaced, "{engine}");
            assert_eq!(indexed(&pool, &s.uid).await.unwrap().0, rev, "{engine}");
            assert_eq!(indexed(&pool, &s.uid).await.unwrap().1, "Pérez^Corregido", "{engine}");
            delete(&path).unwrap();
            assert_eq!(publish(&pool, &path).await.unwrap(), Applied::Deleted, "{engine}");
            assert!(indexed(&pool, &s.uid).await.is_none() && !path.exists(), "{engine}");
        }
    }

    /// Reconcile deletes the index rows of a study whose study DB is gone, and leaves current ones alone.
    #[tokio::test]
    async fn reconcile_removes_orphans() {
        for (engine, pool) in fresh_indexes().await {
            let d = dir("orphan", engine);
            let two = gen::studies(2, 5);
            let paths: Vec<_> = two.iter().map(|s| commit_new(&d, s, "h", "k", true).unwrap()).collect();
            reconcile(&pool, "h", &d).await.unwrap();
            remove_files(&paths[0]);
            let r = reconcile(&pool, "h", &d).await.unwrap();
            assert_eq!(r, Reconciled { scanned: 1, published: 0, removed: 1 }, "{engine}");
            assert!(indexed(&pool, &two[0].uid).await.is_none() && indexed(&pool, &two[1].uid).await.is_some(), "{engine}");
        }
    }

    /// A list query finds a published study by an accent- and case-folded name prefix on every engine, and only
    /// by its prefix; the folded column follows a correction.
    #[tokio::test]
    async fn name_prefix_on_every_engine() {
        use crate::query::Search;
        for (engine, pool) in fresh_indexes().await {
            let d = dir("names", engine);
            let s = &gen::studies(1, 6)[0];
            let path = commit_new(&d, s, "h", "k", true).unwrap();
            correct_name(&path, "Núñez Peña^José").unwrap();
            publish(&pool, &path).await.unwrap();
            let keys = vec!["k".to_string()];
            for (pattern, hits) in [("NUNEZ PENA^J*", 1), ("núñez*", 1), ("Nuñez Pe?a^JOSÉ", 1), ("PEÑA*", 0), ("N*A^J*", 1)] {
                let q = Search { patient_name: Some(pattern.into()), limit: 50, ..Default::default() };
                for tuned in [false, true] {
                    let (sql, params) = q.sql(&keys, tuned, pool.engine());
                    let rows = pool.rows(sql, params).await.unwrap();
                    assert_eq!(rows.len(), hits, "{engine} {pattern} tuned={tuned}");
                }
            }
        }
    }
}
