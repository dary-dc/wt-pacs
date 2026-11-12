//! The package: its name, its header and its members, layout 2 (docs/adr/pacs-receiver.md §2).

use crate::group::{self, is_coded};
use anyhow::{bail, ensure, Context, Result};
use std::collections::HashSet;
use std::fs::File;
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use tar::{Archive, EntryType};
use xxhash_rust::xxh3::{xxh3_64, Xxh3};

pub const HEADER_MEMBER: &str = "package";
const METADATA_MEMBER: &str = "metadata";
const MAX_HEADER_LEN: u64 = 4096;
pub const MAX_GROUP_LEN: u64 = 64 << 20;
/// Bytes of the metadata's inner tar, after decompression; a placeholder: docs/adr/pacs-receiver.md §2.
pub const MAX_METADATA_LEN: u64 = if cfg!(test) { 8 << 20 } else { 1 << 30 };
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
    Addition,
    Update,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Series => "series",
            Kind::Addition => "addition",
            Kind::Update => "update",
        }
    }
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
            field(0, "layout")? == "2",
            "layout {:?} is not 2",
            field(0, "layout")?
        );
        let kind = match field(1, "kind")? {
            "series" => Kind::Series,
            "addition" => Kind::Addition,
            "update" => Kind::Update,
            other => bail!("kind {other:?} is not series, addition or update"),
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

/// What a group's path in the metadata names.
struct Named {
    level: Level,
    series: Option<String>,
    uid: String,
    hash: u64,
}

/// `--.<h>`, `<S>/---.<h>`, `<S>/<I>/----.<h>`, `<S>/<I>/priv.<h>`: relative to the exam directory.
fn group_name(path: &str, study: &str) -> Result<Named> {
    let parts: Vec<&str> = path.split('/').collect();
    ensure!(
        parts[..parts.len() - 1].iter().all(|p| is_coded(p)),
        "{path:?} has a directory that is not a coded UID"
    );
    let (marker, hash) = parts[parts.len() - 1]
        .split_once('.')
        .with_context(|| format!("{path:?} is not a group"))?;
    let (level, series, uid) = match (marker, &parts[..]) {
        ("--", [_]) => (Level::Exam, None, study),
        ("---", [s, _]) => (Level::Series, None, *s),
        ("----", [s, i, _]) => (Level::Instance, Some(*s), *i),
        ("priv", [s, i, _]) => (Level::Private, Some(*s), *i),
        _ => bail!("{path:?} is not a group of layout 2"),
    };
    Ok(Named {
        level,
        series: series.map(str::to_owned),
        uid: uid.to_owned(),
        hash: hex_hash(hash)?,
    })
}

fn path_of(entry: &tar::Entry<impl Read>) -> Result<String> {
    let path = String::from_utf8(entry.path_bytes().into_owned())
        .context("a member's name is not UTF-8")?;
    ensure!(
        entry.header().entry_type() == EntryType::Regular,
        "{path:?} is not a regular file"
    );
    Ok(path)
}

/// Steps 4–6: the members in their order, `package`, `metadata`, `<S>/series.sbnd`; every group
/// checked against its name; every file written to `work` and synced.
pub fn stage(package: &Path, header: &Header, work: &Path) -> Result<Staged> {
    let mut archive = Archive::new(File::open(package).context("open the package")?);
    let mut entries = archive.entries()?;
    entries.next().context("an empty package")??;
    let mut metadata = entries.next().context("no metadata member")??;
    let path = path_of(&metadata)?;
    ensure!(
        path == METADATA_MEMBER,
        "the second member is {path:?}, not {METADATA_MEMBER:?}"
    );
    let mut staged = Staged {
        groups: stage_groups(&mut metadata, header, work)?,
        bundle: None,
    };
    if let Some(entry) = entries.next() {
        let mut entry = entry?;
        let path = path_of(&entry)?;
        let series = match path.split_once('/') {
            Some((series, "series.sbnd")) if is_coded(series) => series.to_owned(),
            _ => bail!("{path:?} is not <series>/series.sbnd"),
        };
        let to = work.join("study").join(format!("{series}.sbnd"));
        let hash = write_synced(&to, &mut entry)?;
        staged.bundle = Some(Bundle {
            series,
            staged: to,
            hash,
        });
    }
    if let Some(entry) = entries.next() {
        bail!("a member after the bundle: {:?}", path_of(&entry?)?);
    }
    check_set(header, &staged)?;
    Ok(staged)
}

/// The metadata member: an inner tar of the groups, as it is or as one zstd frame.
fn stage_groups(member: &mut impl Read, header: &Header, work: &Path) -> Result<Vec<Group>> {
    let mut magic = [0u8; 4];
    member
        .read_exact(&mut magic)
        .context("the metadata member is cut short")?;
    let whole = Cursor::new(magic).chain(member);
    let inner: Box<dyn Read + '_> = if magic == ZSTD_MAGIC {
        Box::new(zstd::stream::read::Decoder::new(whole)?)
    } else {
        Box::new(whole)
    };
    let mut archive = Archive::new(Bounded {
        inner,
        left: MAX_METADATA_LEN,
    });
    let mut seen = HashSet::new();
    let mut groups = Vec::new();
    for entry in archive.entries()? {
        let mut entry = entry.context("the metadata")?;
        let path = path_of(&entry)?;
        ensure!(seen.insert(path.clone()), "{path:?} appears twice");
        let Named {
            level,
            series,
            uid,
            hash,
        } = group_name(&path, &header.study)?;
        ensure!(
            entry.size() <= MAX_GROUP_LEN,
            "{path:?} is {} bytes",
            entry.size()
        );
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .with_context(|| path.clone())?;
        ensure!(
            !bytes.starts_with(&ZSTD_MAGIC),
            "{path:?} is compressed on its own"
        );
        ensure!(
            xxh3_64(&bytes) == hash,
            "{path:?} does not hash to its name ({})",
            hex(xxh3_64(&bytes))
        );
        check_uid(level, &uid, &bytes).with_context(|| path.clone())?;
        let to = work.join("members").join(&path);
        write_synced(&to, &mut bytes.as_slice())?;
        groups.push(Group {
            level,
            series,
            uid,
            hash,
            staged: to,
            bytes: Vec::new(),
        });
    }
    Ok(groups)
}

/// Fails the read that passes `left` bytes, so a zstd bomb is refused, not decompressed whole.
struct Bounded<R> {
    inner: R,
    left: u64,
}

impl<R: Read> Read for Bounded<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.left = self.left.checked_sub(n as u64).ok_or_else(|| {
            io::Error::other(format!(
                "the metadata decompresses past {MAX_METADATA_LEN} bytes"
            ))
        })?;
        Ok(n)
    }
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
    let carries_bundle = header.kind != Kind::Update;
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
                carries_bundle,
                "an exam group in an update of series {}",
                header.unit
            ),
        }
        if g.level == Level::Private && carries_bundle {
            ensure!(
                instances.contains(g.uid.as_str()),
                "private group {} has no instance group",
                g.uid
            );
        }
    }
    let kind = header.kind.name();
    match header.kind {
        Kind::Series | Kind::Addition => {
            ensure!(
                count(Level::Exam) == 1 && count(Level::Series) == 1,
                "{kind} package without one exam and one series group"
            );
            ensure!(
                !instances.is_empty(),
                "{kind} package without instance groups"
            );
            let bundle = staged
                .bundle
                .as_ref()
                .with_context(|| format!("{kind} package without its bundle"))?;
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
