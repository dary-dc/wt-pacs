//! The package, layout 2, written deterministically: docs/adr/pcs-transfer.md §15.4–§15.7.
use crate::outbox::Carried;
use crate::unpackable;
use anyhow::{bail, Context, Result};
use carrier::handoff::PackageName;
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use tar::{Builder, EntryType, Header};
use xxhash_rust::xxh3::{xxh3_64, Xxh3};
use zstd::zstd_safe::CParameter;

pub const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];
const ZSTD_LEVEL: i32 = 3;
/// The receiver's bound on a group, and the largest size a ustar header holds, in bytes.
const MAX_GROUP_LEN: u64 = 64 << 20;
const MAX_MEMBER_LEN: u64 = (8 << 30) - 1;

pub struct Plan {
    pub study: String,
    pub unit: String,
    pub revision: u64,
    pub carried: Carried,
}

/// Written as `<outbox>/<unit>.<n>.partial`, synced, then renamed to its name; returns that path.
pub fn build(exam: &Path, plan: &Plan, outbox: &Path) -> Result<PathBuf> {
    let metadata = metadata(exam, &plan.carried)?;
    let kind = if plan.revision == 1 {
        "series"
    } else {
        "addition"
    };
    let header = format!(
        "layout 2\nkind {kind}\nstudy {}\nunit {}\nrevision {}\n",
        plan.study, plan.unit, plan.revision
    );
    let bundle_path = format!("{}/series.sbnd", plan.unit);
    let bundle_len = regular_len(&exam.join(&bundle_path), &bundle_path, MAX_MEMBER_LEN)?;
    let bundle = File::open(exam.join(&bundle_path))?;

    let partial = outbox.join(format!("{}.{}.partial", plan.unit, plan.revision));
    let file = BufWriter::new(File::create(&partial)?);
    let mut tar = Builder::new(Hashing {
        file,
        hash: Xxh3::new(),
    });
    append(&mut tar, "package", header.as_bytes())?;
    append(&mut tar, "metadata", &metadata[..])?;
    append_sized(&mut tar, &bundle_path, bundle_len, bundle.take(bundle_len))?;
    let Hashing { file, hash } = tar.into_inner()?;
    file.into_inner()
        .map_err(|err| err.into_error())?
        .sync_all()?;

    let name = PackageName {
        unit: plan.unit.clone(),
        revision: plan.revision,
        hash: format!("{:016x}", hash.digest()),
    };
    let path = outbox.join(name.to_string());
    fs::rename(&partial, &path)?;
    File::open(outbox)?.sync_all()?;
    Ok(path)
}

/// Whether the file hashes to the name it carries.
pub fn intact(path: &Path) -> Result<bool> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(PackageName::parse);
    let name = name.with_context(|| format!("{} is not a package's name", path.display()))?;
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(err.into()),
    };
    let (mut hash, mut buf) = (Xxh3::new(), vec![0; 1 << 16]);
    loop {
        match file.read(&mut buf)? {
            0 => return Ok(format!("{:016x}", hash.digest()) == name.hash),
            n => hash.update(&buf[..n]),
        }
    }
}

/// The inner tar of the groups in byte order of their paths, as one zstd frame when compressed.
fn metadata(exam: &Path, carried: &Carried) -> Result<Vec<u8>> {
    let mut paths = carried.groups.clone();
    paths.sort();
    let mut tar = Builder::new(Vec::new());
    for path in &paths {
        regular_len(&exam.join(path), path, MAX_GROUP_LEN)?;
        let bytes = fs::read(exam.join(path))?;
        if !path.ends_with(&format!(".{:016x}", xxh3_64(&bytes))) {
            bail!(unpackable(format!("{path} does not hash to its name")));
        }
        append(&mut tar, path, &bytes[..])?;
    }
    let inner = tar.into_inner()?;
    if !carried.compressed {
        return Ok(inner);
    }
    let mut zstd = zstd::bulk::Compressor::new(ZSTD_LEVEL)?;
    zstd.set_parameter(CParameter::ChecksumFlag(true))?;
    zstd.set_parameter(CParameter::ContentSizeFlag(true))?;
    Ok(zstd.compress(&inner)?)
}

fn regular_len(file: &Path, path: &str, max: u64) -> Result<u64> {
    match fs::symlink_metadata(file) {
        Ok(meta) if meta.is_file() && meta.len() <= max => Ok(meta.len()),
        Ok(meta) if meta.is_file() => bail!(unpackable(format!("{path} is past {max} bytes"))),
        Ok(_) => bail!(unpackable(format!("{path} is not a regular file"))),
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            bail!(unpackable(format!("no {path}")))
        }
        Err(err) => Err(err.into()),
    }
}

fn append<W: Write>(tar: &mut Builder<W>, path: &str, bytes: &[u8]) -> Result<()> {
    append_sized(tar, path, bytes.len() as u64, bytes)
}

/// Every field but the path and the size fixed: §15.7's table.
fn append_sized<W: Write>(
    tar: &mut Builder<W>,
    path: &str,
    size: u64,
    data: impl Read,
) -> Result<()> {
    let mut header = Header::new_ustar();
    if header.set_path(path).is_err() {
        bail!(unpackable(format!("{path} does not fit a ustar header")));
    }
    header.set_size(size);
    header.set_entry_type(EntryType::Regular);
    header.set_mode(0o644);
    header.set_uid(0);
    header.set_gid(0);
    header.set_mtime(0);
    header.set_cksum();
    Ok(tar.append(&header, data)?)
}

/// The package's XXH3-64, computed as it is written.
struct Hashing {
    file: BufWriter<File>,
    hash: Xxh3,
}

impl Write for Hashing {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.file.write(buf)?;
        self.hash.update(&buf[..n]);
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}
