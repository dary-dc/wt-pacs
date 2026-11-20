//! The study DB: one row per metadata group, a table per level, keyed by UID (docs/ingest/pacs-receive-design.md §4).

use rusqlite::{params, Connection};

/// The study DB's file name in its study directory, beside the series' `.sbnd` files.
pub const FILE_NAME: &str = "study.db";

pub const LEVELS: [&str; 4] = ["exam", "series", "instance", "private"];

pub fn create(conn: &Connection) -> rusqlite::Result<()> {
    for level in LEVELS {
        conn.execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {level} (uid TEXT PRIMARY KEY, bytes BLOB NOT NULL, xxh3 INTEGER NOT NULL) STRICT"
        ))?;
    }
    Ok(())
}

/// SQLite's INTEGER is signed: the XXH3-64 is stored as its two's-complement bits.
pub fn group_hash(bytes: &[u8]) -> i64 {
    xxhash_rust::xxh3::xxh3_64(bytes) as i64
}

pub fn put(conn: &Connection, level: &str, uid: &str, bytes: &[u8]) -> rusqlite::Result<()> {
    conn.execute(
        &format!("INSERT OR REPLACE INTO {level} (uid, bytes, xxh3) VALUES (?1, ?2, ?3)"),
        params![uid, bytes, group_hash(bytes)],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A put stores the bytes beside their hash under the UID, and a second put replaces the row.
    #[test]
    fn a_put_stores_bytes_and_hash_and_replaces_by_uid() -> rusqlite::Result<()> {
        let conn = Connection::open_in_memory()?;
        create(&conn)?;
        put(&conn, "series", "1A", b"old")?;
        put(&conn, "series", "1A", b"new")?;
        let rows: Vec<(String, Vec<u8>, i64)> = conn
            .prepare("SELECT uid, bytes, xxh3 FROM series")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?;
        assert_eq!(
            rows,
            vec![("1A".into(), b"new".to_vec(), group_hash(b"new"))]
        );
        Ok(())
    }

    /// The stored hash is the XXH3-64 of the bytes, its bits unchanged.
    #[test]
    fn the_group_hash_is_the_xxh3_bits() {
        assert_eq!(group_hash(b"abc") as u64, 0x78af5f94892f3950);
    }
}
