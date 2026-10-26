//! The package: its name, its header and its members, layout 1 (docs/adr/pacs-receiver.md §2).

use crate::group::{self, is_coded};
use anyhow::{bail, ensure, Context, Result};
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tar::{Archive, EntryType};
use xxhash_rust::xxh3::{xxh3_64, Xxh3};

pub const HEADER_MEMBER: &str = "package";
const MAX_HEADER_LEN: u64 = 4096;
/// Bytes, after decompression: a group is kilobytes, so this bounds a zstd bomb, not real data.
pub const MAX_GROUP_LEN: u64 = 64 << 20;
const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

/// `<unit>.<revision>.<xxh3-64 of the file, 16 hex>.tar`
#[derive(Debug, Clone, PartialEq)]
pub struct Name {
    pub unit: String,
    pub revision: u32,
    pub hash: u64,
}

impl Name {
    pub fn parse(file_name: &str) -> Result<Self> {
        let parts: Vec<&str> = file_name.split('.').collect();
        let [unit, revision, hash, "tar"] = parts[..] else {
            bail!("{file_name:?} is not <unit>.<revision>.<hash>.tar");
        };
        ensure!(is_coded(unit), "{unit:?} is not a coded UID");
        Ok(Self {
            unit: unit.to_owned(),
            revision: revision_number(revision)?,
            hash: hex_hash(hash)?,
        })
    }
}

fn revision_number(text: &str) -> Result<u32> {
    ensure!(
        !text.starts_with('0'),
        "revision {text:?} is not a number from 1"
    );
    text.parse().with_context(|| format!("revision {text:?}"))
}

fn hex_hash(text: &str) -> Result<u64> {
    ensure!(
        text.len() == 16 && text.bytes().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f')),
        "{text:?} is not 16 lowercase hex digits"
    );
    Ok(u64::from_str_radix(text, 16)?)
}

pub fn hex(hash: u64) -> String {
    format!("{hash:016x}")
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Series,
    Update,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Header {
    pub kind: Kind,
    pub study: String,
    pub unit: String,
    pub revision: u32,
}

impl Header {
    fn parse(text: &str) -> Result<Self> {
        let lines: Vec<&str> = text.lines().collect();
        let field = |i: usize, key: &str| -> Result<&str> {
            let line = lines.get(i).copied().unwrap_or_default();
            line.strip_prefix(key)
                .and_then(|v| v.strip_prefix(' '))
                .with_context(|| format!("header line {} is {line:?}, not {key} …", i + 1))
        };
        ensure!(
            lines.len() == 5,
            "the header has {} lines, not 5",
            lines.len()
        );
        ensure!(
            field(0, "layout")? == "1",
            "layout {:?} is not 1",
            field(0, "layout")?
        );
        let kind = match field(1, "kind")? {
            "series" => Kind::Series,
            "update" => Kind::Update,
            other => bail!("kind {other:?} is neither series nor update"),
        };
        let study = field(2, "study")?;
        let unit = field(3, "unit")?;
        ensure!(
            is_coded(study) && is_coded(unit),
            "study {study:?} or unit {unit:?} is not a coded UID"
        );
        Ok(Self {
            kind,
            study: study.to_owned(),
            unit: unit.to_owned(),
            revision: revision_number(field(4, "revision")?)?,
        })
    }
}

/// The first member; a package whose header is not first is not read further.
pub fn read_header(package: &Path) -> Result<Header> {
    let mut archive = Archive::new(File::open(package).context("open the package")?);
    let mut entry = archive.entries()?.next().context("an empty package")??;
    ensure!(
        entry.header().entry_type() == EntryType::Regular
            && entry.path_bytes().as_ref() == HEADER_MEMBER.as_bytes(),
        "the first member is not the header {HEADER_MEMBER:?}"
    );
    ensure!(
        entry.size() <= MAX_HEADER_LEN,
        "a {}-byte header",
        entry.size()
    );
    let mut text = String::new();
    entry
        .read_to_string(&mut text)
        .context("the header is not UTF-8")?;
    Header::parse(&text)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Level {
    Exam,
    Series,
    Instance,
    Private,
}

impl Level {
    pub fn table(self) -> &'static str {
        match self {
            Level::Exam => "exam",
            Level::Series => "series",
            Level::Instance => "instance",
            Level::Private => "private",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Group {
    pub level: Level,
    pub series: Option<String>,
    pub uid: String,
    pub hash: u64,
    pub staged: PathBuf,
    /// Filled by the read-back, from disk.
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct Bundle {
    pub series: String,
    pub staged: PathBuf,
    /// As extracted; the read-back must find the same.
    pub hash: u64,
}

#[derive(Debug)]
pub struct Staged {
    pub groups: Vec<Group>,
    pub bundle: Option<Bundle>,
}

enum Member {
    Group {
        level: Level,
        series: Option<String>,
        uid: String,
        hash: u64,
    },
    Bundle {
        series: String,
    },
}

/// `<E>/--.<h>`, `<E>/<S>/---.<h>`, `<E>/<S>/<I>/----.<h>`, `<E>/<S>/<I>/priv.<h>`, `<E>/<S>/series.sbnd`.
fn member(path: &str, study: &str) -> Result<Member> {
    let parts: Vec<&str> = path.split('/').collect();
    ensure!(parts[0] == study, "{path:?} is outside the study {study}");
    ensure!(
        parts[..parts.len() - 1].iter().all(|p| is_coded(p)),
        "{path:?} has a directory that is not a coded UID"
    );
    let file = parts[parts.len() - 1];
    if let [_, series, "series.sbnd"] = parts[..] {
        return Ok(Member::Bundle {
            series: series.to_owned(),
        });
    }
    let (marker, hash) = file
        .split_once('.')
        .with_context(|| format!("{path:?} is not a group or the bundle"))?;
    let (level, series, uid) = match (marker, &parts[..]) {
        ("--", [e, _]) => (Level::Exam, None, *e),
        ("---", [_, s, _]) => (Level::Series, None, *s),
        ("----", [_, s, i, _]) => (Level::Instance, Some(*s), *i),
        ("priv", [_, s, i, _]) => (Level::Private, Some(*s), *i),
        _ => bail!("{path:?} is not a member of layout 1"),
    };
    Ok(Member::Group {
        level,
        series: series.map(str::to_owned),
        uid: uid.to_owned(),
        hash: hex_hash(hash)?,
    })
}

/// Steps 4–6: every member checked against its name and written to `work`, each file synced.
pub fn stage(package: &Path, header: &Header, work: &Path) -> Result<Staged> {
    let mut archive = Archive::new(File::open(package).context("open the package")?);
    let mut entries = archive.entries()?;
    entries.next().context("an empty package")??;
    let mut seen = HashSet::new();
    let mut staged = Staged {
        groups: Vec::new(),
        bundle: None,
    };
    for entry in entries {
        let mut entry = entry?;
        let path = String::from_utf8(entry.path_bytes().into_owned())
            .context("a member's name is not UTF-8")?;
        ensure!(
            entry.header().entry_type() == EntryType::Regular,
            "{path:?} is not a regular file"
        );
        ensure!(seen.insert(path.clone()), "{path:?} appears twice");
        match member(&path, &header.study)? {
            Member::Bundle { series } => {
                ensure!(staged.bundle.is_none(), "a second bundle {path:?}");
                let to = work.join("study").join(format!("{series}.sbnd"));
                let hash = write_synced(&to, &mut entry)?;
                staged.bundle = Some(Bundle {
                    series,
                    staged: to,
                    hash,
                });
            }
            Member::Group {
                level,
                series,
                uid,
                hash,
            } => {
                ensure!(
                    entry.size() <= MAX_GROUP_LEN,
                    "{path:?} is {} bytes",
                    entry.size()
                );
                let bytes = group_bytes(&mut entry).with_context(|| path.clone())?;
                ensure!(
                    xxh3_64(&bytes) == hash,
                    "{path:?} does not hash to its name ({})",
                    hex(xxh3_64(&bytes))
                );
                check_uid(level, &uid, &bytes).with_context(|| path.clone())?;
                let to = work.join("members").join(&path);
                write_synced(&to, &mut bytes.as_slice())?;
                staged.groups.push(Group {
                    level,
                    series,
                    uid,
                    hash,
                    staged: to,
                    bytes: Vec::new(),
                });
            }
        }
    }
    check_set(header, &staged)?;
    Ok(staged)
}

/// A zstd frame, told by its magic number, is the group compressed; anything else is the group.
fn group_bytes(entry: &mut impl Read) -> Result<Vec<u8>> {
    let mut raw = Vec::new();
    entry.read_to_end(&mut raw)?;
    if !raw.starts_with(&ZSTD_MAGIC) {
        return Ok(raw);
    }
    let mut bytes = Vec::new();
    zstd::stream::read::Decoder::new(raw.as_slice())?
        .take(MAX_GROUP_LEN + 1)
        .read_to_end(&mut bytes)
        .context("a zstd frame that does not decompress")?;
    ensure!(
        bytes.len() as u64 <= MAX_GROUP_LEN,
        "decompresses past {MAX_GROUP_LEN} bytes"
    );
    Ok(bytes)
}

/// The UID a group names in its path is the one it holds; a private group may hold none.
fn check_uid(level: Level, uid: &str, bytes: &[u8]) -> Result<()> {
    let tag = match level {
        Level::Exam => group::STUDY_UID,
        Level::Series => group::SERIES_UID,
        Level::Instance => group::SOP_INSTANCE_UID,
        Level::Private => return group::value(bytes, 0).map(drop),
    };
    let held = group::value(bytes, tag)?.context("the group does not hold its UID")?;
    let held = group::coded(held)?;
    ensure!(
        held == uid,
        "the group holds UID {held}, its path names {uid}"
    );
    Ok(())
}

/// What a package of its kind must hold, and nothing outside its unit.
fn check_set(header: &Header, staged: &Staged) -> Result<()> {
    let count = |level| staged.groups.iter().filter(|g| g.level == level).count();
    let instances: HashSet<&str> = staged
        .groups
        .iter()
        .filter(|g| g.level == Level::Instance)
        .map(|g| g.uid.as_str())
        .collect();
    let whole_study = header.kind == Kind::Update && header.unit == header.study;
    for g in &staged.groups {
        let series = match g.level {
            Level::Exam => None,
            Level::Series => Some(g.uid.as_str()),
            Level::Instance | Level::Private => g.series.as_deref(),
        };
        match series {
            _ if whole_study => {}
            Some(series) => ensure!(
                series == header.unit,
                "{} {} is outside the unit {}",
                g.level.table(),
                g.uid,
                header.unit
            ),
            None => ensure!(
                header.kind == Kind::Series,
                "an exam group in an update of series {}",
                header.unit
            ),
        }
        if g.level == Level::Private && header.kind == Kind::Series {
            ensure!(
                instances.contains(g.uid.as_str()),
                "private group {} has no instance group",
                g.uid
            );
        }
    }
    match header.kind {
        Kind::Series => {
            ensure!(
                count(Level::Exam) == 1 && count(Level::Series) == 1,
                "a series package without one exam and one series group"
            );
            ensure!(
                !instances.is_empty(),
                "a series package without instance groups"
            );
            let bundle = staged
                .bundle
                .as_ref()
                .context("a series package without its bundle")?;
            ensure!(
                bundle.series == header.unit,
                "the bundle is series {}, the unit {}",
                bundle.series,
                header.unit
            );
        }
        Kind::Update => {
            ensure!(staged.bundle.is_none(), "an update carries no bundle");
            ensure!(!staged.groups.is_empty(), "an update with no group");
        }
    }
    Ok(())
}

fn write_synced(to: &Path, from: &mut impl Read) -> Result<u64> {
    std::fs::create_dir_all(to.parent().context("a member path with no directory")?)?;
    let mut file = File::create(to).with_context(|| format!("create {}", to.display()))?;
    let mut hasher = Xxh3::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = from.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        file.write_all(&buffer[..n])?;
    }
    file.sync_all()
        .with_context(|| format!("fsync {}", to.display()))?;
    Ok(hasher.digest())
}
