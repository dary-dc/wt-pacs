//! An exam tree as the PCS writes it, and readers for the packages built from it.
#![allow(dead_code)]
use sender::package::ZSTD_MAGIC;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use xxhash_rust::xxh3::xxh3_64;

pub const STUDY: &str = "Ex01";
pub const UNIT: &str = "Se01";

/// A scratch directory; on tmpfs when there is one, whose listing order follows creation order.
pub fn scratch(label: &str) -> PathBuf {
    let base = match Path::new("/dev/shm").is_dir() {
        true => PathBuf::from("/dev/shm"),
        false => std::env::temp_dir(),
    };
    let dir = base.join(format!("sender-{label}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Writes `<marker>.<xxh3-64>` in `dir`; returns its name.
pub fn group(dir: &Path, marker: &str, bytes: &[u8]) -> String {
    fs::create_dir_all(dir).unwrap();
    let name = format!("{marker}.{:016x}", xxh3_64(bytes));
    fs::write(dir.join(&name), bytes).unwrap();
    name
}

pub fn instance(exam: &Path, unit: &str, uid: &str, private: bool) {
    let dir = exam.join(unit).join(uid);
    group(&dir, "----", format!("\x08instance {uid}").as_bytes());
    if private {
        group(&dir, "priv", format!("\x08private {uid}").as_bytes());
    }
}

/// `<root>/PbPb/Ex01`: an exam group, series `Se01` with a group, a bundle and three instances.
pub fn exam(root: &Path) -> PathBuf {
    let exam = root.join("PbPb").join(STUDY);
    group(&exam, "--", b"\x08exam group");
    group(&exam.join(UNIT), "---", b"\x08series group");
    let bundle: Vec<u8> = (0..300_000u32).map(|i| (i * 31 + i / 7) as u8).collect();
    fs::write(exam.join(UNIT).join("series.sbnd"), bundle).unwrap();
    instance(&exam, UNIT, "In01", true);
    instance(&exam, UNIT, "In02", false);
    instance(&exam, UNIT, "In03", false);
    exam
}

pub struct Package {
    pub header: String,
    /// Outer member names, in order.
    pub members: Vec<String>,
    pub metadata: Vec<u8>,
    pub bundle: Vec<u8>,
}

impl Package {
    pub fn read(path: &Path) -> Package {
        let mut archive = tar::Archive::new(fs::File::open(path).unwrap());
        let mut members = Vec::new();
        let mut bodies = Vec::new();
        for entry in archive.entries().unwrap() {
            let mut entry = entry.unwrap();
            members.push(String::from_utf8(entry.path_bytes().into_owned()).unwrap());
            let mut body = Vec::new();
            entry.read_to_end(&mut body).unwrap();
            bodies.push(body);
        }
        Package {
            header: String::from_utf8(bodies[0].clone()).unwrap(),
            metadata: bodies[1].clone(),
            bundle: bodies.get(2).cloned().unwrap_or_default(),
            members,
        }
    }

    /// The inner tar, decompressed when it begins with zstd's magic.
    pub fn inner(&self) -> Vec<u8> {
        match self.metadata.starts_with(&ZSTD_MAGIC) {
            true => zstd::decode_all(&self.metadata[..]).unwrap(),
            false => self.metadata.clone(),
        }
    }

    /// The inner tar's member names, in order.
    pub fn groups(&self) -> Vec<String> {
        let inner = self.inner();
        let mut archive = tar::Archive::new(&inner[..]);
        let entries = archive.entries().unwrap();
        entries
            .map(|e| String::from_utf8(e.unwrap().path_bytes().into_owned()).unwrap())
            .collect()
    }
}

/// The one package kept in `outbox`.
pub fn kept(outbox: &Path) -> PathBuf {
    let kept: Vec<PathBuf> = fs::read_dir(outbox)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "tar"))
        .collect();
    assert_eq!(kept.len(), 1, "{kept:?}");
    kept[0].clone()
}
