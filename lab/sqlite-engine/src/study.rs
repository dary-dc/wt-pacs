use anyhow::Result;
use rusqlite::{params, Connection};
use std::path::Path;

pub const SCAN: &str = "SELECT uid, body, xxh3 FROM groups WHERE series = ?1";
pub const POINT: &str = "SELECT body, xxh3 FROM groups WHERE uid = ?1";
pub const BODY: usize = 1024;

pub const SCHEMA: &str = "CREATE TABLE groups(uid TEXT PRIMARY KEY, kind INTEGER, series TEXT, body BLOB, xxh3 INTEGER);
CREATE INDEX groups_series ON groups(series);";

pub fn series_uid(study: usize) -> String {
    format!("1.2.826.0.1.3680043.10.{study}.1")
}

pub fn instance_uid(study: usize, n: usize) -> String {
    format!("1.2.826.0.1.3680043.10.{study}.1.{n}")
}

pub fn body(seed: u64) -> Vec<u8> {
    let mut x = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    (0..BODY)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x as u8
        })
        .collect()
}

/// One exam row, one series row, `instances` instance rows, a private row per 10 instances; WAL, closed checkpointed.
pub fn build(path: &Path, study: usize, instances: usize) -> Result<()> {
    let _ = std::fs::remove_file(path);
    let mut c = Connection::open(path)?;
    c.pragma_update(None, "journal_mode", "WAL")?;
    c.pragma_update(None, "synchronous", "FULL")?;
    c.execute_batch(SCHEMA)?;
    let tx = c.transaction()?;
    {
        let mut ins = tx.prepare("INSERT INTO groups VALUES (?1, ?2, ?3, ?4, ?5)")?;
        let series = series_uid(study);
        let row = |uid: &str, kind: i64, n: u64| (uid.to_owned(), kind, body(n), n as i64);
        let mut rows = vec![row(&format!("exam.{study}"), 0, 0), row(&series, 1, 1)];
        for n in 0..instances {
            rows.push(row(&instance_uid(study, n), 2, n as u64 + 2));
            if n % 10 == 0 {
                rows.push(row(&format!("private.{study}.{n}"), 3, n as u64 + 1_000_000));
            }
        }
        for (uid, kind, body, h) in rows {
            ins.execute(params![uid, kind, series, body, h])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}
