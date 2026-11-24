//! The study DB: a table per level, a group's bytes and XXH3 keyed by its coded UID, and an audit
//! table (docs/adr/pacs-receiver.md §4).

use rusqlite::{params, Connection};

/// The study DB's file name in its study directory, beside the series' `.sbnd` files.
pub const FILE_NAME: &str = "study.db";

pub const LEVELS: [&str; 4] = ["exam", "series", "instance", "private"];

/// `series` is the group's series: NULL for the exam group, its own UID for a series group.
pub const SCHEMA: &str = "
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

pub fn create(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)
}

/// The stored form of a hash: 16 lowercase hex digits.
pub fn hash_text(hash: u64) -> String {
    format!("{hash:016x}")
}

pub fn group_hash(bytes: &[u8]) -> String {
    hash_text(xxhash_rust::xxh3::xxh3_64(bytes))
}

pub fn put(
    conn: &Connection,
    level: &str,
    uid: &str,
    series: Option<&str>,
    bytes: &[u8],
) -> rusqlite::Result<()> {
    conn.execute(
        &format!(
            "INSERT OR REPLACE INTO {level} (uid, series, xxh3, bytes) VALUES (?1, ?2, ?3, ?4)"
        ),
        params![uid, series, group_hash(bytes), bytes],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A put stores the bytes beside their hash and series under the UID, and a second put replaces the row.
    #[test]
    fn a_put_stores_bytes_and_hash_and_replaces_by_uid() -> rusqlite::Result<()> {
        let conn = Connection::open_in_memory()?;
        create(&conn)?;
        put(&conn, "instance", "1A1", Some("1A"), b"old")?;
        put(&conn, "instance", "1A1", Some("1A"), b"new")?;
        let rows: Vec<(String, Option<String>, Vec<u8>, String)> = conn
            .prepare("SELECT uid, series, bytes, xxh3 FROM instance")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<_>>()?;
        assert_eq!(
            rows,
            vec![(
                "1A1".into(),
                Some("1A".into()),
                b"new".to_vec(),
                group_hash(b"new")
            )]
        );
        Ok(())
    }

    /// The stored hash is the XXH3-64 of the bytes as 16 lowercase hex digits, leading zeros kept.
    #[test]
    fn the_group_hash_is_the_xxh3_in_16_hex_digits() {
        assert_eq!(group_hash(b"abc"), "78af5f94892f3950");
        assert_eq!(hash_text(0xab), "00000000000000ab");
    }
}
