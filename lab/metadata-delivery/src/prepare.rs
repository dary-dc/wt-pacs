use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::Connection;

use crate::doc::{self, Source};

pub fn study_name(n: usize) -> String {
    format!("s{n:03}")
}

pub fn study_dir(root: &Path, study: &str) -> PathBuf {
    root.join("studies").join(study)
}

/// B's and C's files from the study DB as committed, as the receiver's derive step writes them.
pub fn derive(study_dir: &Path, conn: &mut Connection, name: &str) -> Result<()> {
    let parts = doc::read(conn, name, Source::Instances)?;
    let [b, c_paint, c_study] = doc::derived_files(study_dir, name);
    doc::place(&b, &doc::gzip(&doc::document(&parts)))?;
    doc::place(&c_paint, &doc::gzip(&doc::paint_only(&parts.paint)))?;
    doc::place(&c_study, &doc::gzip(&doc::study_only(&parts.study)))?;
    Ok(())
}

/// `studies` copies of the template, each with its ready rows, its derived files and the journal mode asked.
pub fn run(fixture: &Path, root: &Path, studies: usize, journal: &str) -> Result<()> {
    fs::create_dir_all(root.join("studies"))?;
    fs::copy(fixture.join("frame0.gz"), root.join("frame0.gz")).context("frame0.gz")?;
    for n in 0..studies {
        let dir = study_dir(root, &study_name(n));
        if dir.exists() {
            fs::remove_dir_all(&dir)?;
        }
        fs::create_dir_all(&dir)?;
        fs::copy(fixture.join("template.db"), doc::study_db(&dir)).context("template.db")?;
        let mut conn = doc::open_write(&dir)?;
        conn.pragma_update(None, "journal_mode", journal)?;
        let tx = conn.transaction()?;
        for name in doc::series_names(&tx)? {
            doc::ready_row(&tx, &name)?;
            doc::compressed_row(&tx, &name)?;
        }
        tx.commit()?;
        for name in doc::series_names(&conn)? {
            derive(&dir, &mut conn, &name)?;
        }
    }
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    /// One prepared study from the template `fixture/build.py` wrote (`METADATA_DELIVERY_FIXTURE`, README §Run).
    pub fn fixture() -> PathBuf {
        let fixture = PathBuf::from(std::env::var("METADATA_DELIVERY_FIXTURE").expect("METADATA_DELIVERY_FIXTURE"));
        let root = std::env::temp_dir().join(format!("md-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
        run(&fixture, &root, 1, "wal").unwrap();
        study_dir(&root, &study_name(0))
    }
}
