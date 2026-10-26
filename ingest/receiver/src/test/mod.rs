mod crash;
mod receive;

use crate::group::{coded, SERIES_UID, SOP_INSTANCE_UID, STUDY_UID};
use crate::{study_db, Outcome, Receiver};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use xxhash_rust::xxh3::xxh3_64;

pub const STUDY: &str = "1.2.826.0.1.7";
pub const SERIES: &str = "1.2.826.0.1.7.1";
pub const SERIES_B: &str = "1.2.826.0.1.7.2";
const NUMBER_OF_FRAMES: u32 = 0x0028_0008;
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

pub fn instance_group(uid: &str, frames: u32) -> Vec<u8> {
    [
        record(SOP_INSTANCE_UID, b"UI", &ui(uid)),
        record(NUMBER_OF_FRAMES, b"IS", frames.to_string().as_bytes()),
    ]
    .concat()
}

pub fn bundle(frames: u32, fill: u8) -> Vec<u8> {
    bundle_with(
        frames,
        fill,
        &format!("{{\"frameCount\": {frames}, \"codec\": \"htj2k\"}}"),
    )
}

pub fn bundle_with(frames: u32, fill: u8, metadata: &str) -> Vec<u8> {
    let dir = scratch("bundle");
    let path = dir.join("b.sbnd");
    let frames: Vec<Vec<u8>> = (0..frames)
        .map(|i| vec![fill.wrapping_add(i as u8); 100 + i as usize])
        .collect();
    let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();
    series_bundle::write_bundle(&path, metadata.as_bytes(), &refs).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    std::fs::remove_dir_all(dir).unwrap();
    bytes
}

/// A package before it is packed: its header text and its members in order.
#[derive(Clone)]
pub struct Package {
    pub header: String,
    pub members: Vec<(String, Vec<u8>)>,
    pub unit: String,
    pub revision: u32,
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
        let (e, s) = (c(STUDY), c(series));
        let mut p = Self::new("series", &s, revision);
        p.group(format!("{e}/--"), exam_group(patient));
        p.group(format!("{e}/{s}/---"), series_group(series, "axial"));
        for (uid, frames) in instances {
            p.group(
                format!("{e}/{s}/{}/----", c(uid)),
                instance_group(uid, *frames),
            );
        }
        let total = instances.iter().map(|(_, f)| f).sum();
        p.members
            .push((format!("{e}/{s}/series.sbnd"), bundle(total, fill)));
        p
    }

    pub fn new(kind: &str, unit: &str, revision: u32) -> Self {
        Self {
            header: format!(
                "layout 1\nkind {kind}\nstudy {}\nunit {unit}\nrevision {revision}\n",
                c(STUDY)
            ),
            members: Vec::new(),
            unit: unit.to_owned(),
            revision,
        }
    }

    /// `prefix` is the path up to the marker; the hash is added from the bytes.
    pub fn group(&mut self, prefix: String, bytes: Vec<u8>) {
        self.members
            .push((format!("{prefix}.{:016x}", xxh3_64(&bytes)), bytes));
    }

    pub fn tar(&self) -> Vec<u8> {
        let mut members = vec![("package".to_owned(), self.header.clone().into_bytes())];
        members.extend(self.members.iter().cloned());
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

    pub fn receiver(&self) -> Receiver {
        Receiver::open(&self.root, &self.incoming).unwrap()
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
