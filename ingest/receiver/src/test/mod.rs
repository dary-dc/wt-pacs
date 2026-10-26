mod addition;
mod crash;
mod receive;

use crate::group::{coded, SERIES_UID, SOP_INSTANCE_UID, STUDY_UID};
use crate::{study_db, Downstream, Outcome, Receiver};
use rusqlite::Connection;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{PoisonError, RwLock, RwLockReadGuard};
use xxhash_rust::xxh3::xxh3_64;

pub const STUDY: &str = "1.2.826.0.1.7";
pub const SERIES: &str = "1.2.826.0.1.7.1";
pub const SERIES_B: &str = "1.2.826.0.1.7.2";
const NUMBER_OF_FRAMES: u32 = 0x0028_0008;
const INSTANCE_NUMBER: u32 = 0x0020_0013;
const PATIENT_NAME: u32 = 0x0010_0010;
const SERIES_DESCRIPTION: u32 = 0x0008_103E;

/// A fresh directory beside the test binary: the build's filesystem, which a page drop can act on.
pub fn scratch(name: &str) -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let exe = std::env::current_exe().unwrap();
    let dir = exe.parent().unwrap().join("receiver-tests").join(format!(
        "{name}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Bytes this thread has had read from the device, not served from the page cache.
pub fn device_reads() -> u64 {
    let io = std::fs::read_to_string("/proc/thread-self/io").expect("/proc/thread-self/io");
    let line = io.lines().find(|l| l.starts_with("read_bytes:")).unwrap();
    line[11..].trim().parse().unwrap()
}

pub fn record(tag: u32, vr: &[u8; 2], value: &[u8]) -> Vec<u8> {
    let mut out = vec![8u8];
    out.extend_from_slice(&tag.to_be_bytes());
    out.extend_from_slice(vr);
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value);
    out
}

/// A UI value as stored: padded to even length with NUL.
pub fn ui(uid: &str) -> Vec<u8> {
    let mut v = uid.as_bytes().to_vec();
    if v.len() % 2 == 1 {
        v.push(0);
    }
    v
}

pub fn c(uid: &str) -> String {
    coded(&ui(uid)).unwrap()
}

pub fn exam_group(patient: &str) -> Vec<u8> {
    [
        record(STUDY_UID, b"UI", &ui(STUDY)),
        record(PATIENT_NAME, b"PN", patient.as_bytes()),
    ]
    .concat()
}

pub fn series_group(series: &str, description: &str) -> Vec<u8> {
    [
        record(SERIES_UID, b"UI", &ui(series)),
        record(SERIES_DESCRIPTION, b"LO", description.as_bytes()),
    ]
    .concat()
}

/// Its Instance Number is the UID's last component.
pub fn instance_group(uid: &str, frames: u32) -> Vec<u8> {
    let number = uid.rsplit('.').next().unwrap();
    [
        record(SOP_INSTANCE_UID, b"UI", &ui(uid)),
        record(INSTANCE_NUMBER, b"IS", number.as_bytes()),
        record(NUMBER_OF_FRAMES, b"IS", frames.to_string().as_bytes()),
    ]
    .concat()
}

/// Frame `i` is `100 + i` bytes of `fill + i`.
pub fn frames(frames: u32, fill: u8) -> Vec<Vec<u8>> {
    (0..frames)
        .map(|i| vec![fill.wrapping_add(i as u8); 100 + i as usize])
        .collect()
}

/// The metadata the ingest writes: the count, the range and a digest per frame.
pub fn bundle(n: u32, fill: u8) -> Vec<u8> {
    let digests: Vec<String> = frames(n, fill)
        .iter()
        .map(|f| format!("{:016x}", xxh3_64(f)))
        .collect();
    let metadata = serde_json::json!({
        "frameCount": n, "codec": "htj2k", "min": fill, "max": fill as u32 + n,
        "digests": { "algorithm": "xxh3-64", "frames": digests },
    });
    bundle_with(n, fill, &metadata.to_string())
}

pub fn bundle_with(n: u32, fill: u8, metadata: &str) -> Vec<u8> {
    let dir = scratch("bundle");
    let path = dir.join("b.sbnd");
    let frames = frames(n, fill);
    let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();
    series_bundle::write_bundle(&path, metadata.as_bytes(), &refs).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    std::fs::remove_dir_all(dir).unwrap();
    bytes
}

/// A bundle file's frames, in index order, and its metadata.
pub fn read_bundle(path: &Path) -> (Vec<Vec<u8>>, serde_json::Value) {
    use std::os::unix::fs::FileExt;
    let file = std::fs::File::open(path).unwrap();
    let layout = series_bundle::read_layout(&file).unwrap();
    let frames = layout
        .index
        .iter()
        .map(|&(offset, length)| {
            let mut bytes = vec![0u8; length as usize];
            file.read_exact_at(&mut bytes, offset).unwrap();
            bytes
        })
        .collect();
    (frames, serde_json::from_str(&layout.metadata).unwrap())
}

/// A package before it is packed: its header text, its groups and its bundle.
#[derive(Clone)]
pub struct Package {
    pub header: String,
    pub members: Vec<(String, Vec<u8>)>,
    pub unit: String,
    pub revision: u32,
    pub zstd: bool,
}

impl Package {
    /// `instances` are (SOP instance UID, frames); the bundle holds their sum.
    pub fn series(
        series: &str,
        revision: u32,
        patient: &str,
        instances: &[(&str, u32)],
        fill: u8,
    ) -> Self {
        let s = c(series);
        let mut p = Self::new("series", &s, revision);
        p.group("--".into(), exam_group(patient));
        p.group(format!("{s}/---"), series_group(series, "axial"));
        for (uid, frames) in instances {
            p.group(format!("{s}/{}/----", c(uid)), instance_group(uid, *frames));
        }
        let total = instances.iter().map(|(_, f)| f).sum();
        p.members
            .push((format!("{s}/series.sbnd"), bundle(total, fill)));
        p
    }

    /// The instances added to a stored series, its exam and series groups as `series` makes them.
    pub fn addition(series: &str, revision: u32, instances: &[(&str, u32)], fill: u8) -> Self {
        let mut p = Self::series(series, revision, "DOE^JANE", instances, fill);
        p.header = p.header.replace("kind series", "kind addition");
        p
    }

    pub fn new(kind: &str, unit: &str, revision: u32) -> Self {
        Self {
            header: format!(
                "layout 2\nkind {kind}\nstudy {}\nunit {unit}\nrevision {revision}\n",
                c(STUDY)
            ),
            members: Vec::new(),
            unit: unit.to_owned(),
            revision,
            zstd: false,
        }
    }

    /// `prefix` is the path up to the marker; the hash is added from the bytes.
    pub fn group(&mut self, prefix: String, bytes: Vec<u8>) {
        self.members
            .push((format!("{prefix}.{:016x}", xxh3_64(&bytes)), bytes));
    }

    /// The groups' inner tar in byte order of their paths, compressed when `zstd`.
    pub fn metadata(&self) -> Vec<u8> {
        let mut groups: Vec<_> = self
            .members
            .iter()
            .filter(|m| !m.0.ends_with(".sbnd"))
            .cloned()
            .collect();
        groups.sort_by(|a, b| a.0.cmp(&b.0));
        let inner = tar_of(&groups);
        match self.zstd {
            true => zstd::encode_all(inner.as_slice(), 3).unwrap(),
            false => inner,
        }
    }

    /// `package`, `metadata`, then each bundle.
    pub fn tar(&self) -> Vec<u8> {
        let mut members = vec![
            ("package".to_owned(), self.header.clone().into_bytes()),
            ("metadata".to_owned(), self.metadata()),
        ];
        members.extend(
            self.members
                .iter()
                .filter(|m| m.0.ends_with(".sbnd"))
                .cloned(),
        );
        tar_of(&members)
    }

    pub fn name_of(&self, bytes: &[u8]) -> String {
        format!(
            "{}.{}.{:016x}.tar",
            self.unit,
            self.revision,
            xxh3_64(bytes)
        )
    }
}

pub fn tar_of(members: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    for (path, bytes) in members {
        let mut header = tar::Header::new_ustar();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_mtime(0);
        header.set_entry_type(tar::EntryType::Regular);
        let name = &mut header.as_old_mut().name;
        name[..path.len()].copy_from_slice(path.as_bytes());
        header.set_cksum();
        builder.append(&header, bytes.as_slice()).unwrap();
    }
    builder.into_inner().unwrap()
}

/// A test's receiver holds the read side, a fork the write side: a forked child keeps a copy of
/// every open descriptor until its exec, so a lock another test dropped would still be held.
pub static FORK: RwLock<()> = RwLock::new(());

/// Field order matters: the receiver, and its lock, are dropped before the guard.
pub struct Held {
    receiver: Receiver,
    _no_fork: RwLockReadGuard<'static, ()>,
}

impl Held {
    pub fn with_downstream(self, downstream: Box<dyn Downstream>) -> Self {
        Self {
            receiver: self.receiver.with_downstream(downstream),
            ..self
        }
    }
}

impl Deref for Held {
    type Target = Receiver;
    fn deref(&self) -> &Receiver {
        &self.receiver
    }
}

/// A PACS root and its `incoming/`, side by side on one filesystem.
pub struct Site {
    pub root: PathBuf,
    pub incoming: PathBuf,
}

impl Site {
    pub fn new(name: &str) -> Self {
        let dir = scratch(name);
        let (root, incoming) = (dir.join("root"), dir.join("incoming"));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&incoming).unwrap();
        Self { root, incoming }
    }

    pub fn receiver(&self) -> Held {
        let no_fork = FORK.read().unwrap_or_else(PoisonError::into_inner);
        Held {
            receiver: Receiver::open(&self.root, &self.incoming).unwrap(),
            _no_fork: no_fork,
        }
    }

    /// As the carrier does: `.partial`, then a rename once complete.
    pub fn arrive_bytes(&self, name: &str, bytes: &[u8]) -> String {
        let partial = self.incoming.join(format!("{name}.partial"));
        std::fs::write(&partial, bytes).unwrap();
        std::fs::rename(&partial, self.incoming.join(name)).unwrap();
        name.to_owned()
    }

    pub fn arrive(&self, package: &Package) -> String {
        let bytes = package.tar();
        self.arrive_bytes(&package.name_of(&bytes), &bytes)
    }

    /// Arrives and is received alone, with a fresh receiver as a restart would make.
    pub fn receive(&self, package: &Package) -> Outcome {
        let name = self.arrive(package);
        self.receiver().receive(&name).unwrap()
    }

    pub fn status(&self, name: &str) -> String {
        std::fs::read_to_string(self.incoming.join("status").join(name)).unwrap()
    }

    pub fn study(&self) -> PathBuf {
        self.root.join(c(STUDY))
    }

    pub fn bundle_path(&self, series: &str) -> PathBuf {
        self.study().join(format!("{}.sbnd", c(series)))
    }

    pub fn db(&self) -> Connection {
        Connection::open(self.study().join(study_db::FILE)).unwrap()
    }

    /// (table, uid, bytes) of every group row, sorted.
    pub fn rows(&self) -> Vec<(String, String, Vec<u8>)> {
        if !self.study().join(study_db::FILE).exists() {
            return Vec::new();
        }
        let db = self.db();
        let mut out = Vec::new();
        for table in ["exam", "series", "instance", "private"] {
            let mut q = db
                .prepare(&format!(
                    "SELECT uid, bytes, xxh3 FROM {table} ORDER BY uid"
                ))
                .unwrap();
            let rows = q.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Vec<u8>>(1)?,
                    r.get::<_, String>(2)?,
                ))
            });
            for (uid, bytes, hash) in rows.unwrap().map(Result::unwrap) {
                assert_eq!(
                    hash,
                    format!("{:016x}", xxh3_64(&bytes)),
                    "{table} {uid} holds bytes not of its hash"
                );
                out.push((table.to_owned(), uid, bytes));
            }
        }
        out
    }

    pub fn audit(&self) -> Vec<(String, u32, String)> {
        let db = self.db();
        let mut q = db
            .prepare("SELECT unit, revision, changes FROM audit ORDER BY id")
            .unwrap();
        let rows = q
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        rows.map(Result::unwrap).collect()
    }

    /// Every file under `dir` but the receiver's lock, relative, sorted.
    pub fn files(dir: &Path) -> Vec<String> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return out;
        };
        for entry in entries.map(Result::unwrap) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            if entry.file_type().unwrap().is_dir() {
                out.extend(
                    Self::files(&entry.path())
                        .into_iter()
                        .map(|f| format!("{name}/{f}")),
                );
            } else {
                out.push(name);
            }
        }
        out.sort();
        out
    }
}
