//! A study DB: SQLite's own integrity check, then every metadata group against its stored XXH3.

use crate::{disk, Finding};
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

pub(crate) fn check(path: &Path, findings: &mut Vec<Finding>) {
    let mut wal = path.as_os_str().to_owned();
    wal.push("-wal");
    let wal = PathBuf::from(wal);
    for file in [path, wal.as_path()].into_iter().filter(|p| p.exists()) {
        if let Err(e) = disk::open_uncached(file) {
            return findings.push(Finding::fail(file, "open", e));
        }
    }
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = match Connection::open_with_flags(path, flags) {
        Ok(conn) => conn,
        Err(e) => return findings.push(Finding::fail(path, "open", e)),
    };
    findings.push(integrity(path, &conn));
    for level in study_db::LEVELS {
        findings.extend(groups(path, &conn, level));
    }
}

fn integrity(path: &Path, conn: &Connection) -> Finding {
    let messages = conn.prepare("PRAGMA integrity_check").and_then(|mut s| {
        s.query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()
    });
    match messages {
        Ok(m) if m == ["ok"] => Finding::ok(path, "integrity", "PRAGMA integrity_check: ok"),
        Ok(m) => Finding::fail(path, "integrity", m.join("; ")),
        Err(e) => Finding::fail(path, "integrity", e),
    }
}

/// One finding per group whose bytes do not hash to its stored XXH3, else one for the level.
fn groups(path: &Path, conn: &Connection, level: &str) -> Vec<Finding> {
    let mut findings = Vec::new();
    let mut rows = 0;
    let scan = conn
        .prepare(&format!("SELECT uid, bytes, xxh3 FROM {level}"))
        .and_then(|mut s| {
            let mut q = s.query([])?;
            while let Some(row) = q.next()? {
                rows += 1;
                let uid: String = row.get(0)?;
                let stored: i64 = row.get(2)?;
                let actual = study_db::group_hash(row.get_ref(1)?.as_blob()?);
                if actual != stored {
                    let details = format!(
                        "{level} {uid}: stored XXH3 {:016x}, its bytes hash to {:016x}",
                        stored as u64, actual as u64
                    );
                    findings.push(Finding::fail(path, "groups", details));
                }
            }
            Ok(())
        });
    match scan {
        Err(e) => findings.push(Finding::fail(path, "groups", format!("{level}: {e}"))),
        Ok(()) if findings.is_empty() => findings.push(Finding::ok(
            path,
            "groups",
            format!("{level}: {rows} groups, every XXH3 matches"),
        )),
        Ok(()) => {}
    }
    findings
}
