//! What the sender keeps: each package until it is stored, what each revision carried for good
//! (docs/adr/pcs-transfer.md §15.7, §15.8).
use anyhow::{bail, Context, Result};
use carrier::handoff::{write_durably, PackageName};
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

/// What a revision carried, read back to rebuild it as it was first built.
pub struct Carried {
    pub compressed: bool,
    /// Relative to the exam directory; the bundle, always `<unit>/series.sbnd`, is not listed.
    pub groups: Vec<String>,
}

pub struct Outbox(PathBuf);

impl Outbox {
    pub fn open(path: &Path) -> Result<Outbox> {
        fs::create_dir_all(path)?;
        Ok(Outbox(path.to_path_buf()))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    /// The unit's recorded revisions, oldest first.
    pub fn revisions(&self, unit: &str) -> Result<Vec<u64>> {
        let entries = match fs::read_dir(self.0.join(unit)) {
            Ok(entries) => entries,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.into()),
        };
        let mut revisions = Vec::new();
        for entry in entries {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if !name.starts_with('0') && name.bytes().all(|b| b.is_ascii_digit()) {
                revisions.push(name.parse()?);
            }
        }
        revisions.sort();
        Ok(revisions)
    }

    pub fn carried(&self, unit: &str, n: u64) -> Result<Carried> {
        let path = self.0.join(unit).join(n.to_string());
        let text = fs::read_to_string(&path).with_context(|| format!("{}", path.display()))?;
        let mut lines = text.lines();
        let compressed = match lines.next() {
            Some("metadata zstd") => true,
            Some("metadata plain") => false,
            other => bail!("{}: {other:?} is not the metadata line", path.display()),
        };
        Ok(Carried {
            compressed,
            groups: lines.map(String::from).collect(),
        })
    }

    pub fn write_carried(&self, unit: &str, n: u64, carried: &Carried) -> Result<()> {
        let dir = self.0.join(unit);
        if !dir.exists() {
            fs::create_dir(&dir)?;
            File::open(&self.0)?.sync_all()?;
        }
        let metadata = if carried.compressed { "zstd" } else { "plain" };
        let text = format!("metadata {metadata}\n{}\n", carried.groups.join("\n"));
        Ok(write_durably(&dir.join(n.to_string()), text.as_bytes())?)
    }

    pub fn stored(&self, unit: &str, n: u64) -> bool {
        self.0.join(unit).join(format!("{n}.stored")).exists()
    }

    /// Marked before the package is deleted, so a crash between the two leaves a stored revision.
    pub fn mark_stored(&self, unit: &str, n: u64, package: &Path) -> Result<()> {
        write_durably(&self.0.join(unit).join(format!("{n}.stored")), b"")?;
        Ok(fs::remove_file(package)?)
    }

    /// The packages kept for the revision: one, unless a build died before recording it.
    pub fn kept(&self, unit: &str, n: u64) -> Result<Vec<PathBuf>> {
        let mut kept = Vec::new();
        for entry in fs::read_dir(&self.0)? {
            let entry = entry?;
            let name = PackageName::parse(&entry.file_name().to_string_lossy());
            if name.is_some_and(|name| name.unit == unit && name.revision == n) {
                kept.push(entry.path());
            }
        }
        Ok(kept)
    }

    /// Removes what a build of the unrecorded revision `n` left: never sent, since sending follows recording.
    pub fn forget(&self, unit: &str, n: u64) -> Result<()> {
        for kept in self.kept(unit, n)? {
            fs::remove_file(kept)?;
        }
        match fs::remove_file(self.0.join(format!("{unit}.{n}.partial"))) {
            Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err.into()),
            _ => Ok(()),
        }
    }
}
