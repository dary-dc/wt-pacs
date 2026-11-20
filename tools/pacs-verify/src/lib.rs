//! Checks every series bundle and study DB under a path, read from disk: tools/pacs-verify/README.md.

mod bundle;
mod study;

use serde::Serialize;
use std::fmt::Display;
use std::io::{self, Write};
use std::path::Path;

/// The receiver's in-flight packages and staged files, which are not yet stored.
const INCOMING_DIR: &str = "incoming";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Ok,
    Fail,
}

#[derive(Debug, Serialize)]
pub struct Finding {
    pub path: String,
    pub check: &'static str,
    pub result: Outcome,
    pub details: String,
}

impl Finding {
    fn ok(path: &Path, check: &'static str, details: impl Display) -> Self {
        Self::new(path, check, Outcome::Ok, details)
    }

    fn fail(path: &Path, check: &'static str, details: impl Display) -> Self {
        Self::new(path, check, Outcome::Fail, details)
    }

    fn new(path: &Path, check: &'static str, result: Outcome, details: impl Display) -> Self {
        let path = path.display().to_string();
        let details = details.to_string();
        Self {
            path,
            check,
            result,
            details,
        }
    }
}

/// Every check of every `.sbnd` and study DB under `root`, in path order; `incoming/` is skipped below the root.
pub fn verify(root: &Path) -> Vec<Finding> {
    let mut findings = Vec::new();
    visit(root, true, &mut findings);
    if findings.is_empty() {
        findings.push(Finding::fail(root, "walk", "no .sbnd and no study DB here"));
    }
    findings
}

fn visit(path: &Path, is_root: bool, findings: &mut Vec<Finding>) {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) => return findings.push(Finding::fail(path, "walk", e)),
    };
    if meta.is_dir() {
        if !is_root && path.file_name().is_some_and(|n| n == INCOMING_DIR) {
            return;
        }
        let entries =
            std::fs::read_dir(path).and_then(|d| d.map(|e| e.map(|e| e.path())).collect());
        let mut entries: Vec<_> = match entries {
            Ok(entries) => entries,
            Err(e) => return findings.push(Finding::fail(path, "walk", e)),
        };
        entries.sort();
        for entry in entries {
            visit(&entry, false, findings);
        }
    } else if meta.is_file() {
        if path.extension().is_some_and(|e| e == "sbnd") {
            bundle::check(path, findings);
        } else if path.file_name().is_some_and(|n| n == study_db::FILE_NAME) {
            study::check(path, findings);
        }
    }
}

/// Writes every failure and a summary as text, every finding as a JSON line; true if any check failed.
pub fn report(
    findings: &[Finding],
    text: &mut dyn Write,
    json: Option<&mut dyn Write>,
) -> io::Result<bool> {
    let failed = findings
        .iter()
        .filter(|f| f.result == Outcome::Fail)
        .count();
    for f in findings.iter().filter(|f| f.result == Outcome::Fail) {
        writeln!(text, "FAIL {} {}: {}", f.path, f.check, f.details)?;
    }
    let mut files: Vec<&str> = findings.iter().map(|f| f.path.as_str()).collect();
    files.dedup();
    writeln!(
        text,
        "{} checks on {} paths, {failed} failed",
        findings.len(),
        files.len()
    )?;
    if let Some(json) = json {
        for f in findings {
            serde_json::to_writer(&mut *json, f)?;
            writeln!(json)?;
        }
        json.flush()?;
    }
    Ok(failed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::path::PathBuf;

    struct Study(PathBuf);

    impl Study {
        /// A study directory: two series bundles and a study DB with a group at every level.
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("pacs-verify-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            series_bundle::write_bundle(&dir.join("1A.sbnd"), b"{}", &[b"aaa", b"bbbb"]).unwrap();
            series_bundle::write_bundle(&dir.join("1B.sbnd"), b"{}", &[b"cc"]).unwrap();
            let conn = Connection::open(dir.join(study_db::FILE_NAME)).unwrap();
            study_db::create(&conn).unwrap();
            for level in study_db::LEVELS {
                study_db::put(&conn, level, "1A", format!("{level} group").as_bytes()).unwrap();
            }
            study_db::put(&conn, "instance", "1A1", b"another instance group").unwrap();
            Study(dir)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }

        fn db(&self) -> Connection {
            Connection::open(self.path(study_db::FILE_NAME)).unwrap()
        }

        fn patch(&self, name: &str, at: u64, bytes: &[u8]) {
            use std::os::unix::fs::FileExt;
            let file = std::fs::OpenOptions::new()
                .write(true)
                .open(self.path(name))
                .unwrap();
            file.write_all_at(bytes, at).unwrap();
        }

        fn failures(&self) -> Vec<(String, &'static str, String)> {
            verify(&self.0)
                .into_iter()
                .filter(|f| f.result == Outcome::Fail)
                .map(|f| {
                    (
                        Path::new(&f.path)
                            .file_name()
                            .unwrap()
                            .to_string_lossy()
                            .into_owned(),
                        f.check,
                        f.details,
                    )
                })
                .collect()
        }

        /// The one failure, as (file name, check, details).
        fn failure(&self) -> (String, &'static str, String) {
            let mut failures = self.failures();
            assert_eq!(failures.len(), 1, "expected one failure, got {failures:?}");
            failures.remove(0)
        }
    }

    impl Drop for Study {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A sound study passes every check: each bundle's layout and frames, the DB's integrity and every level's groups.
    #[test]
    fn a_sound_study_passes_every_check() {
        let study = Study::new("sound");
        let findings = verify(&study.0);
        let checks: Vec<_> = findings.iter().map(|f| (f.result, f.check)).collect();
        use Outcome::Ok;
        let bundle = [(Ok, "layout"), (Ok, "frames")];
        let db = [
            (Ok, "integrity"),
            (Ok, "groups"),
            (Ok, "groups"),
            (Ok, "groups"),
            (Ok, "groups"),
        ];
        assert_eq!(
            checks,
            [&bundle[..], &bundle[..], &db[..]].concat(),
            "{findings:?}"
        );
        assert!(
            findings[7].details.contains("instance: 2 groups"),
            "{findings:?}"
        );
    }

    /// A wrong magic fails the bundle's layout, naming the magic.
    #[test]
    fn a_wrong_magic_fails_the_layout() {
        let study = Study::new("magic");
        study.patch("1A.sbnd", 0, b"X");
        let (file, check, details) = study.failure();
        assert_eq!((file.as_str(), check), ("1A.sbnd", "layout"));
        assert!(details.contains("magic"), "{details}");
    }

    /// An unknown version fails the layout; version 2 also says it has no reader yet.
    #[test]
    fn an_unknown_version_fails_and_version_2_says_it_has_no_reader() {
        let study = Study::new("version");
        study.patch("1A.sbnd", 4, &3u32.to_le_bytes());
        study.patch("1B.sbnd", 4, &2u32.to_le_bytes());
        let failures = study.failures();
        assert_eq!(failures.len(), 2, "{failures:?}");
        assert!(
            failures[0].2.contains("version 3") && !failures[0].2.contains("no reader"),
            "{failures:?}"
        );
        assert!(
            failures[1].2.contains("version 2") && failures[1].2.contains("no reader"),
            "{failures:?}"
        );
    }

    /// An index entry whose frame lies past the file's end fails the layout, naming the frame.
    #[test]
    fn a_frame_outside_the_file_fails_the_layout() {
        let study = Study::new("bounds");
        study.patch("1A.sbnd", 16 + 12, &1_000u64.to_le_bytes());
        let (file, check, details) = study.failure();
        assert_eq!((file.as_str(), check), ("1A.sbnd", "layout"));
        assert!(
            details.contains("frame 1 ") && details.contains("outside"),
            "{details}"
        );
    }

    /// A frame longer than the cap fails the layout, naming the frame, even inside a file that long.
    #[test]
    fn a_frame_over_the_cap_fails_the_layout() {
        let study = Study::new("cap");
        let cap = frame_envelope::MAX_CODESTREAM_LEN;
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(study.path("1B.sbnd"))
            .unwrap();
        file.set_len(64 + cap as u64 + 1).unwrap();
        study.patch("1B.sbnd", 16 + 8, &(cap as u32 + 1).to_le_bytes());
        let (file, check, details) = study.failure();
        assert_eq!((file.as_str(), check), ("1B.sbnd", "layout"));
        assert!(
            details.contains("frame 0 ") && details.contains("over"),
            "{details}"
        );
    }

    /// A bundle cut short of its last frame fails the layout.
    #[test]
    fn a_truncated_bundle_fails_the_layout() {
        let study = Study::new("truncated");
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(study.path("1A.sbnd"))
            .unwrap();
        let len = file.metadata().unwrap().len();
        file.set_len(len - 1).unwrap();
        let (file, check, _) = study.failure();
        assert_eq!((file.as_str(), check), ("1A.sbnd", "layout"));
    }

    /// A group whose bytes changed without its hash fails, naming its level and UID.
    #[test]
    fn a_changed_group_fails_naming_it() {
        let study = Study::new("row");
        study
            .db()
            .execute("UPDATE instance SET bytes = x'00' WHERE uid = '1A1'", [])
            .unwrap();
        let (file, check, details) = study.failure();
        assert_eq!((file.as_str(), check), (study_db::FILE_NAME, "groups"));
        assert!(details.starts_with("instance 1A1: "), "{details}");
    }

    /// A stored hash that changed fails its group the same way.
    #[test]
    fn a_changed_hash_fails_naming_its_group() {
        let study = Study::new("hash");
        study
            .db()
            .execute("UPDATE exam SET xxh3 = xxh3 + 1", [])
            .unwrap();
        let (_, check, details) = study.failure();
        assert_eq!(check, "groups");
        assert!(details.starts_with("exam 1A: "), "{details}");
    }

    /// A level's table that is missing fails that level.
    #[test]
    fn a_missing_level_fails() {
        let study = Study::new("table");
        study.db().execute("DROP TABLE private", []).unwrap();
        let (_, check, details) = study.failure();
        assert_eq!(check, "groups");
        assert!(
            details.starts_with("private: ") && details.contains("no such table"),
            "{details}"
        );
    }

    /// A garbled page of the DB, here its UID index, fails SQLite's integrity check.
    #[test]
    fn a_garbled_page_fails_the_integrity_check() {
        let study = Study::new("page");
        let (root, page_size): (i64, i64) = {
            let db = study.db();
            let root = db.query_row("SELECT rootpage FROM sqlite_master WHERE type = 'index' AND tbl_name = 'series'", [], |r| r.get(0)).unwrap();
            (
                root,
                db.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap(),
            )
        };
        study.patch(
            study_db::FILE_NAME,
            ((root - 1) * page_size) as u64,
            &vec![0xff; page_size as usize],
        );
        let failures = study.failures();
        assert!(failures.iter().any(|f| f.1 == "integrity"), "{failures:?}");
    }

    /// An index that disagrees with its table is reported by SQLite's integrity check, message by message.
    #[test]
    fn an_index_that_disagrees_with_its_table_fails_the_integrity_check() {
        let study = Study::new("index");
        let db = study.db();
        let root: i64 = db
            .query_row(
                "SELECT rootpage FROM sqlite_master WHERE name = 'sqlite_autoindex_instance_1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        db.execute_batch(&format!("PRAGMA writable_schema = ON; UPDATE sqlite_master SET rootpage = {root} WHERE name = 'sqlite_autoindex_series_1'")).unwrap();
        drop(db);
        let (_, check, details) = study.failure();
        assert_eq!(check, "integrity");
        assert!(details.contains("sqlite_autoindex_series_1"), "{details}");
    }

    /// A DB checked while its writer holds rows in the write-ahead log is checked with those rows.
    #[test]
    fn a_db_mid_write_ahead_log_is_checked_with_its_logged_rows() {
        let study = Study::new("wal");
        let writer = study.db();
        writer
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0")
            .unwrap();
        study_db::put(&writer, "instance", "1A2", b"logged").unwrap();
        assert!(study.path("study.db-wal").exists());
        let findings = verify(&study.0);
        assert!(
            findings.iter().all(|f| f.result == Outcome::Ok),
            "{findings:?}"
        );
        assert!(
            findings
                .iter()
                .any(|f| f.details.starts_with("instance: 3 groups")),
            "{findings:?}"
        );
    }

    /// A DB whose header is not SQLite's fails at its first read, and nothing is reported as passing.
    #[test]
    fn a_db_with_a_garbled_header_fails() {
        let study = Study::new("dbheader");
        study.patch(study_db::FILE_NAME, 0, b"not a database!!");
        let findings: Vec<_> = verify(&study.0)
            .into_iter()
            .filter(|f| f.path.ends_with(study_db::FILE_NAME))
            .collect();
        assert!(
            !findings.is_empty() && findings.iter().all(|f| f.result == Outcome::Fail),
            "{findings:?}"
        );
    }

    /// The receiver's `incoming/` below the root and partial files are not stored series and are not checked.
    #[test]
    fn incoming_and_partial_files_are_skipped() {
        let study = Study::new("incoming");
        std::fs::create_dir(study.path(INCOMING_DIR)).unwrap();
        std::fs::write(study.path("incoming/2A.sbnd"), b"junk").unwrap();
        std::fs::write(study.path("2B.sbnd.partial"), b"junk").unwrap();
        assert_eq!(study.failures(), []);
        let given = verify(&study.path(INCOMING_DIR));
        assert_eq!(
            (given[0].check, given[0].result),
            ("layout", Outcome::Fail),
            "incoming/ given as the root is checked"
        );
    }

    /// A path that holds nothing to check fails, so a scrub pointed at the wrong place does not pass.
    #[test]
    fn a_path_with_nothing_to_check_fails() {
        let study = Study::new("empty");
        std::fs::create_dir(study.path("empty")).unwrap();
        let findings = verify(&study.path("empty"));
        assert_eq!(
            (findings.len(), findings[0].check, findings[0].result),
            (1, "walk", Outcome::Fail)
        );
        assert_eq!(verify(&study.path("missing"))[0].check, "walk");
    }

    /// The text names each failure and the count; every finding is a JSON line of path, check, result, details.
    #[test]
    fn the_report_writes_failures_as_text_and_every_finding_as_json() {
        let study = Study::new("report");
        study.patch("1A.sbnd", 0, b"X");
        let findings = verify(&study.0);
        let (mut text, mut json) = (Vec::new(), Vec::new());
        let failed = report(&findings, &mut text, Some(&mut json)).unwrap();
        let text = String::from_utf8(text).unwrap();
        assert!(failed);
        assert_eq!(text.lines().count(), 2, "{text}");
        assert!(
            text.starts_with("FAIL ") && text.contains("1A.sbnd layout: "),
            "{text}"
        );
        assert!(
            text.ends_with(&format!("{} checks on 3 paths, 1 failed\n", findings.len())),
            "{text}"
        );
        let lines: Vec<serde_json::Value> = String::from_utf8(json)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(lines.len(), findings.len());
        assert_eq!(lines[0]["result"], "fail");
        assert_eq!(lines[0]["check"], "layout");
        assert!(lines[0]["path"].as_str().unwrap().ends_with("1A.sbnd"));
        assert!(lines[0]["details"].as_str().unwrap().contains("magic"));
        assert!(lines[1..].iter().all(|l| l["result"] == "ok"));

        let sound = Study::new("report-sound");
        assert!(!report(&verify(&sound.0), &mut Vec::new(), None).unwrap());
    }
}
