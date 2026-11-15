//! The files the carrier and the receiver share under one root, and nothing else between them:
//! docs/ingest/link.md §12.2. One writer per file: the carrier writes `incoming/` and `uploads/`,
//! the receiver writes `status/` and moves a package out of `incoming/` once it has judged it.
use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// `<unit>.<revision>.<xxh3-64>.tar`, the only shape a package's name may take.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackageName {
    pub unit: String,
    pub revision: u64,
    pub hash: String,
}

impl PackageName {
    pub fn parse(name: &str) -> Option<PackageName> {
        let mut parts = name.strip_suffix(".tar")?.split('.');
        let (unit, revision, hash) = (parts.next()?, parts.next()?, parts.next()?);
        let unit_ok = (1..=64).contains(&unit.len())
            && unit
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'~');
        let revision_ok = (1..=10).contains(&revision.len())
            && revision.bytes().all(|b| b.is_ascii_digit())
            && (revision == "0" || !revision.starts_with('0'));
        let hash_ok =
            hash.len() == 16 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
        if parts.next().is_some() || !(unit_ok && revision_ok && hash_ok) {
            return None;
        }
        Some(PackageName {
            unit: unit.to_string(),
            revision: revision.parse().ok()?,
            hash: hash.to_string(),
        })
    }
}

impl fmt::Display for PackageName {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}.{}.{}.tar", self.unit, self.revision, self.hash)
    }
}

/// What the receiver says of a package once it has judged it; the carrier only reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verdict {
    Committed,
    Refused(Class, String),
}

/// Whether the PCS should send a refused package again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    Retry,
    Final,
}

impl fmt::Display for Verdict {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Verdict::Committed => f.write_str("committed"),
            Verdict::Refused(Class::Retry, reason) => write!(f, "refused retry {reason}"),
            Verdict::Refused(Class::Final, reason) => write!(f, "refused final {reason}"),
        }
    }
}

impl Verdict {
    pub fn parse(line: &str) -> Option<Verdict> {
        let line = line.trim_end();
        if line == "committed" {
            return Some(Verdict::Committed);
        }
        let rest = line.strip_prefix("refused ")?;
        let (class, reason) = rest.split_once(' ').unwrap_or((rest, ""));
        let class = match class {
            "retry" => Class::Retry,
            "final" => Class::Final,
            _ => return None,
        };
        Some(Verdict::Refused(class, reason.to_string()))
    }
}

pub struct Root(PathBuf);

impl Root {
    pub fn open(path: &Path) -> io::Result<Root> {
        for dir in ["incoming", "status", "uploads"] {
            fs::create_dir_all(path.join(dir))?;
        }
        Ok(Root(path.to_path_buf()))
    }

    /// The receiver's input: a complete upload, renamed here from its `.partial`.
    pub fn incoming(&self, name: &PackageName) -> PathBuf {
        self.0.join("incoming").join(name.to_string())
    }

    pub fn partial(&self, name: &PackageName) -> PathBuf {
        self.0.join("incoming").join(format!("{name}.partial"))
    }

    pub fn status(&self, name: &PackageName) -> PathBuf {
        self.0.join("status").join(name.to_string())
    }

    /// The carrier's own: which site owns a unit, and which upload holds each of its revisions.
    pub fn uploads(&self, unit: &str) -> PathBuf {
        self.0.join("uploads").join(unit)
    }

    pub fn read_verdict(&self, name: &PackageName) -> io::Result<Option<Verdict>> {
        match fs::read_to_string(self.status(name)) {
            Ok(line) => Verdict::parse(&line).map(Some).ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("status of {name}: {line:?}"),
                )
            }),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err),
        }
    }

    /// The receiver's one write: durable before it returns, since the PCS deletes on "committed".
    pub fn write_verdict(&self, name: &PackageName, verdict: &Verdict) -> io::Result<()> {
        write_durably(&self.status(name), format!("{verdict}\n").as_bytes())
    }
}

/// Written beside its target as a dotfile, synced, renamed over it, and the directory synced.
pub fn write_durably(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().expect("a file under the root");
    let tmp = dir.join(format!(
        ".{}.tmp",
        path.file_name().expect("a file name").to_string_lossy()
    ));
    let mut file = fs::File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(&tmp, path)?;
    fs::File::open(dir)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A name parses only in its one canonical spelling, so two spellings never name one package.
    #[test]
    fn names_parse_only_canonically() {
        let name = PackageName::parse("1A_b~.3.0123456789abcdef.tar").unwrap();
        assert_eq!((name.unit.as_str(), name.revision), ("1A_b~", 3));
        assert_eq!(name.to_string(), "1A_b~.3.0123456789abcdef.tar");
        for bad in [
            "u.03.0123456789abcdef.tar",
            "u.3.0123456789ABCDEF.tar",
            "u.3.0123456789abcde.tar",
            "u.3.0123456789abcdef",
            "u/x.3.0123456789abcdef.tar",
            "../u.3.0123456789abcdef.tar",
            "u.3.0123456789abcdef.x.tar",
            ".3.0123456789abcdef.tar",
        ] {
            assert_eq!(PackageName::parse(bad), None, "{bad}");
        }
    }

    /// Every verdict reads back as written, reason included; anything else is not a verdict.
    #[test]
    fn verdicts_round_trip() {
        for verdict in [
            Verdict::Committed,
            Verdict::Refused(Class::Retry, "hash mismatch".into()),
            Verdict::Refused(Class::Final, "conflict".into()),
        ] {
            assert_eq!(Verdict::parse(&format!("{verdict}\n")), Some(verdict));
        }
        assert_eq!(Verdict::parse("received"), None);
        assert_eq!(Verdict::parse("refused later x"), None);
    }
}
