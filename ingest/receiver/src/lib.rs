//! The PACS's receiver: steps 1–12, R and crash recovery of docs/adr/pacs-receiver.md §3.

mod disk;
mod group;
mod merge;
mod package;
mod study_db;

pub use package::{Kind, Level};

use anyhow::{bail, ensure, Context, Result};
use package::{Bundle, Group, Header, Name};
use std::fmt;
use std::fs::{self, File};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use study_db::Seen;
use xxhash_rust::xxh3::xxh3_64;

/// What a stored package changed, for what depends on it.
#[derive(Debug, Clone)]
pub struct Stored {
    pub study: String,
    pub unit: String,
    pub revision: u32,
    pub kind: Kind,
    pub groups: Vec<(Level, String)>,
    pub bundle: Option<String>,
}

/// Steps 9 and 10, Open (docs/adr/pacs-receiver.md §6–7): called after step 8; each retries and
/// reports its own failures, and none undoes 6–8.
pub trait Downstream {
    fn derive(&self, stored: &Stored);
    fn index(&self, stored: &Stored);
}

pub struct NotBuilt;

impl Downstream for NotBuilt {
    fn derive(&self, _: &Stored) {}
    fn index(&self, _: &Stored) {}
}

/// Step 11: what `incoming/status/<package>` says, one line, for the carrier to relay.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Stored,
    Refused(String),
    Quarantined(String),
}

impl fmt::Display for Outcome {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Outcome::Stored => write!(f, "stored"),
            Outcome::Refused(why) => write!(f, "refused {}", why.replace('\n', " ")),
            Outcome::Quarantined(why) => write!(f, "quarantined {}", why.replace('\n', " ")),
        }
    }
}

/// Two packages claim one (unit, revision): an operator's, never resent.
#[derive(Debug)]
struct Conflict(String);

impl fmt::Display for Conflict {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Conflict {}

/// The points between steps; a crash test stops the process at each.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Step {
    Checked,
    Staged,
    ReadBack,
    Placed,
    Recorded,
    Verified,
    Confirmed,
    Cleaned,
}

enum Placed {
    Nothing,
    Study(PathBuf),
    Bundle {
        at: PathBuf,
        previous: Option<PathBuf>,
    },
}

pub struct Receiver {
    root: PathBuf,
    incoming: PathBuf,
    downstream: Box<dyn Downstream>,
    _lock: File,
}

impl Receiver {
    /// Takes `incoming/` alone, then recovers from a crash: no `*.work/` survives a restart.
    pub fn open(root: &Path, incoming: &Path) -> Result<Self> {
        for dir in ["status", "refused", "quarantine"] {
            fs::create_dir_all(incoming.join(dir))
                .with_context(|| format!("create {}", incoming.display()))?;
        }
        let (root_dev, incoming_dev) = (fs::metadata(root)?.dev(), fs::metadata(incoming)?.dev());
        ensure!(
            root_dev == incoming_dev,
            "{} and {} are on two filesystems: a rename between them fails (EXDEV)",
            incoming.display(),
            root.display()
        );
        let lock = File::create(incoming.join(".lock"))?;
        lock.try_lock()
            .with_context(|| format!("another receiver holds {}", incoming.display()))?;
        let receiver = Self {
            root: root.to_owned(),
            incoming: incoming.to_owned(),
            downstream: Box::new(NotBuilt),
            _lock: lock,
        };
        receiver.recover()?;
        Ok(receiver)
    }

    pub fn with_downstream(mut self, downstream: Box<dyn Downstream>) -> Self {
        self.downstream = downstream;
        self
    }

    fn recover(&self) -> Result<()> {
        for entry in fs::read_dir(&self.incoming)? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "work") {
                fs::remove_dir_all(&path).with_context(|| format!("remove {}", path.display()))?;
            }
        }
        for entry in fs::read_dir(self.incoming.join("status"))? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "partial") {
                fs::remove_file(&path)?;
            }
        }
        Ok(())
    }

    /// Every package in `incoming/`, in the order `run` takes them.
    pub fn run(&self) -> Result<Vec<(String, Outcome)>> {
        self.pending()?
            .into_iter()
            .map(|name| Ok((name.clone(), self.receive(&name)?)))
            .collect()
    }

    /// Step 2: complete arrivals only, updates first, then by name.
    pub fn pending(&self) -> Result<Vec<String>> {
        let mut names = Vec::new();
        for entry in fs::read_dir(&self.incoming)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type()?.is_file() && !name.starts_with('.') && !name.ends_with(".partial")
            {
                let rank = match package::read_header(&entry.path()) {
                    Ok(h) if h.kind == Kind::Update => 0,
                    Ok(_) => 1,
                    Err(_) => 2,
                };
                names.push((rank, name));
            }
        }
        names.sort();
        Ok(names.into_iter().map(|(_, name)| name).collect())
    }

    /// One package, from step 3 to step 12 or R. An error is the receiver's own, for an operator.
    pub fn receive(&self, name: &str) -> Result<Outcome> {
        self.receive_at(name, &mut |_| {})
    }

    pub(crate) fn receive_at(&self, name: &str, at: &mut dyn FnMut(Step)) -> Result<Outcome> {
        let package = self.incoming.join(name);
        let work = self.incoming.join(format!("{name}.work"));
        let result = self.store(name, &package, &work, at);
        if work.exists() {
            fs::remove_dir_all(&work).with_context(|| format!("remove {}", work.display()))?;
        }
        let refused_before = self.incoming.join("refused").join(name);
        let outcome = match &result {
            Ok(stored) => {
                self.downstream.derive(stored);
                self.downstream.index(stored);
                Outcome::Stored
            }
            Err(e) if e.downcast_ref::<Conflict>().is_some() || refused_before.exists() => {
                Outcome::Quarantined(format!("{e:#}"))
            }
            Err(e) => Outcome::Refused(format!("{e:#}")),
        };
        disk::write_durably(
            &self.incoming.join("status").join(name),
            format!("{outcome}\n").as_bytes(),
        )?;
        at(Step::Confirmed);
        match &outcome {
            Outcome::Stored => fs::remove_file(&package)?,
            Outcome::Refused(_) => fs::rename(&package, &refused_before)?,
            Outcome::Quarantined(_) => {
                fs::rename(&package, self.incoming.join("quarantine").join(name))?
            }
        }
        if !matches!(outcome, Outcome::Refused(_)) && refused_before.exists() {
            fs::remove_file(&refused_before)?;
        }
        disk::sync_dir(&self.incoming)?;
        at(Step::Cleaned);
        Ok(outcome)
    }

    fn store(
        &self,
        name: &str,
        package: &Path,
        work: &Path,
        at: &mut dyn FnMut(Step),
    ) -> Result<Stored> {
        let named = Name::parse(name)?;
        let hash = disk::hash_file(package, false)?;
        ensure!(
            hash == named.hash,
            "the package hashes to {}, its name says {}",
            package::hex(hash),
            package::hex(named.hash)
        );
        at(Step::Checked);

        let header = package::read_header(package)?;
        ensure!(
            header.unit == named.unit && header.revision == named.revision,
            "the header names {}.{}, the file {}.{}",
            header.unit,
            header.revision,
            named.unit,
            named.revision
        );
        let study_dir = self.root.join(&header.study);
        let db_path = study_dir.join(study_db::FILE);
        let existing = study_dir.exists();
        ensure!(
            existing || header.kind == Kind::Series,
            "{} to study {}, which is not stored",
            header.kind.name(),
            header.study
        );
        let seen = if existing {
            study_db::seen(&study_db::open(&db_path)?, &header.unit, header.revision)?
        } else {
            Seen::New { last: 0 }
        };
        let stored = Stored {
            study: header.study.clone(),
            unit: header.unit.clone(),
            revision: header.revision,
            kind: header.kind,
            groups: Vec::new(),
            bundle: None,
        };
        let recorded = matches!(seen, Seen::Stored { .. });
        match seen {
            Seen::Stored { hash, .. } if hash != named.hash => {
                return Err(Conflict(format!(
                    "{}.{} is stored as {}, this package is {}",
                    header.unit,
                    header.revision,
                    package::hex(hash),
                    package::hex(named.hash)
                ))
                .into())
            }
            Seen::Stored { latest: false, .. } => return Ok(stored),
            Seen::Stored { latest: true, .. } => {}
            Seen::New { last: 0 } if header.kind == Kind::Addition => {
                bail!("an addition to series {}, which is not stored", header.unit)
            }
            Seen::New { last } if header.revision == last + 1 => {}
            Seen::New { last } => bail!(
                "revision {} of {}, after stored revision {last}",
                header.revision,
                header.unit
            ),
        }

        fs::create_dir_all(work)?;
        let mut staged = package::stage(package, &header, work)?;
        at(Step::Staged);

        for group in &mut staged.groups {
            group.bytes = from_disk::read(&group.staged)
                .with_context(|| format!("read {}", group.staged.display()))?;
            ensure!(
                xxh3_64(&group.bytes) == group.hash,
                "{} {} reads back changed from disk",
                group.level.table(),
                group.uid
            );
        }
        if let Some(bundle) = &mut staged.bundle {
            read_back(bundle)?;
            let mut instances: Vec<&[u8]> = staged
                .groups
                .iter()
                .filter(|g| g.level == Level::Instance)
                .map(|g| g.bytes.as_slice())
                .collect();
            check_frames(&bundle.staged, &instances)?;
            if header.kind == Kind::Addition {
                let db = study_db::open(&db_path)?;
                study_db::check_addition(&db, &staged.groups, recorded)?;
                let stored = study_db::in_series(&db, Level::Instance, &header.unit)?;
                let kept: Vec<&study_db::Row> = stored
                    .iter()
                    .filter(|r| !staged.groups.iter().any(|g| g.uid == r.uid))
                    .collect();
                *bundle = merge_addition(&study_dir, bundle, &kept, &staged.groups, work)?;
                read_back(bundle)?;
                instances.extend(kept.iter().map(|r| r.bytes.as_slice()));
                check_frames(&bundle.staged, &instances)?;
            }
        }
        at(Step::ReadBack);

        let placed = self.place(&header, staged.bundle.as_ref(), work, existing)?;
        at(Step::Placed);

        let change = match study_db::open(&db_path)
            .and_then(|mut db| study_db::record(&mut db, &header, name, named.hash, &staged.groups))
        {
            Ok(change) => change,
            Err(e) => {
                self.unplace(&placed)?;
                return Err(e);
            }
        };
        at(Step::Recorded);
        if let Err(e) = study_db::verify(&db_path, &change) {
            if existing {
                study_db::restore(&db_path, &change)?;
            }
            self.unplace(&placed)?;
            return Err(e.context("the study DB read back from disk"));
        }
        at(Step::Verified);

        Ok(Stored {
            groups: staged
                .groups
                .iter()
                .map(|g| (g.level, g.uid.clone()))
                .collect(),
            bundle: staged.bundle.map(|b| b.series),
            ..stored
        })
    }

    /// Step 6c: the only step that changes the serving tree, each change one rename.
    fn place(
        &self,
        header: &Header,
        bundle: Option<&Bundle>,
        work: &Path,
        existing: bool,
    ) -> Result<Placed> {
        let study_dir = self.root.join(&header.study);
        if !existing {
            let staged_study = work.join("study");
            fs::create_dir_all(&staged_study)?;
            study_db::create(&staged_study.join(study_db::FILE))?;
            disk::sync_dir(&staged_study)?;
            fs::rename(&staged_study, &study_dir).context("place the study")?;
            disk::sync_dir(&self.root)?;
            return Ok(Placed::Study(study_dir));
        }
        let Some(bundle) = bundle else {
            return Ok(Placed::Nothing);
        };
        let at = study_dir.join(format!("{}.sbnd", bundle.series));
        let previous = work.join("previous.sbnd");
        let previous = match fs::hard_link(&at, &previous) {
            Ok(()) => Some(previous),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e).context("keep the bundle being replaced"),
        };
        fs::rename(&bundle.staged, &at).context("place the bundle")?;
        disk::sync_dir(&study_dir)?;
        Ok(Placed::Bundle { at, previous })
    }

    fn unplace(&self, placed: &Placed) -> Result<()> {
        let path = match placed {
            Placed::Nothing => return Ok(()),
            Placed::Study(dir) => {
                fs::remove_dir_all(dir)?;
                dir
            }
            Placed::Bundle { at, previous } => {
                match previous {
                    Some(previous) => fs::rename(previous, at)?,
                    None => fs::remove_file(at)?,
                }
                at
            }
        };
        disk::sync_dir(path.parent().context("a placed path with no directory")?)
    }
}

/// Step 6b for an addition: a new bundle in `work`, the served one's frames and the addition's.
fn merge_addition(
    study_dir: &Path,
    addition: &Bundle,
    kept: &[&study_db::Row],
    groups: &[Group],
    work: &Path,
) -> Result<Bundle> {
    let added: Vec<merge::Instance> = groups
        .iter()
        .filter(|g| g.level == Level::Instance)
        .map(|g| (g.uid.as_str(), g.bytes.as_slice()))
        .collect();
    let kept: Vec<merge::Instance> = kept
        .iter()
        .map(|r| (r.uid.as_str(), r.bytes.as_slice()))
        .collect();
    let served = study_dir.join(format!("{}.sbnd", addition.series));
    let to = work.join("merged.sbnd");
    merge::merge(&served, &kept, &addition.staged, &added, &to).context("the merge")?;
    Ok(Bundle {
        series: addition.series.clone(),
        hash: disk::hash_file(&to, false)?,
        staged: to,
    })
}

/// Step 6b for a bundle: what is on disk is what was written.
fn read_back(bundle: &Bundle) -> Result<()> {
    let hash = disk::hash_file(&bundle.staged, true)?;
    ensure!(
        hash == bundle.hash,
        "the bundle reads back from disk as {}, not {}",
        package::hex(hash),
        package::hex(bundle.hash)
    );
    Ok(())
}

/// It opens as a v1 bundle, and its frames are the instance groups'. v1 carries no coded-frame
/// hash: docs/adr/pacs-receiver.md §3.
fn check_frames(bundle: &Path, instances: &[&[u8]]) -> Result<()> {
    let layout = series_bundle::read_layout(&File::open(bundle)?).context("the bundle")?;
    let metadata: serde_json::Value =
        serde_json::from_str(&layout.metadata).context("the bundle's metadata")?;
    let declared = metadata["frameCount"]
        .as_u64()
        .context("the bundle's metadata has no frameCount")?;
    ensure!(
        declared == layout.index.len() as u64,
        "frameCount {declared}, {} frames indexed",
        layout.index.len()
    );
    let codec = metadata["codec"].as_str().unwrap_or("htj2k");
    ensure!(matches!(codec, "htj2k" | "av1"), "codec {codec:?}");
    let mut frames = 0u64;
    for bytes in instances {
        frames += u64::from(group::number_of_frames(bytes)?);
    }
    ensure!(
        frames == declared,
        "the instance groups hold {frames} frames, the bundle {declared}"
    );
    Ok(())
}

#[cfg(test)]
#[path = "test/mod.rs"]
mod tests;
