//! Does this host's storage give the server its fast read path?
//!
//! The disk-access ADR (`docs/disk-access/adr.md`) streams frame bytes with
//! `preadv2(RWF_NOWAIT)` so a cold read returns short instead of parking a Tokio worker.
//! **ext4 honours the flag; overlayfs and tmpfs refuse it** (`EOPNOTSUPP`), and a container's
//! own root filesystem *is* overlayfs. Where the flag is refused the server stays correct
//! but falls back to one pooled `pread` per frame — measurably slower, and silently so.
//!
//! Run this against the directory studies will actually be served from, before deploying.
//! Exit status is the answer, so it can gate a rollout:
//!
//!   0  fast path available
//!   1  fast path NOT available (remedy printed)
//!   2  could not determine (bad path, permissions)

use anyhow::{Context, Result};
use exact_server::media::frame_store::nowait_supported_at;
use std::path::{Path, PathBuf};

fn main() -> std::process::ExitCode {
    let mut args = std::env::args_os().skip(1);
    let target = match args.next() {
        Some(a) if a != "--help" && a != "-h" => PathBuf::from(a),
        _ => {
            eprintln!(
                "usage: check-fastpath <study.sbnd | directory>\n\n\
                 Reports whether preadv2(RWF_NOWAIT) works where studies are stored.\n\
                 Pass the directory the server reads from — support is a property of the\n\
                 mount, not of any one file. Exit 0 = fast path, 1 = fallback, 2 = unknown."
            );
            return std::process::ExitCode::from(2);
        }
    };

    match report(&target) {
        Ok(true) => std::process::ExitCode::SUCCESS,
        Ok(false) => std::process::ExitCode::from(1),
        Err(e) => {
            eprintln!("check-fastpath: {e:#}");
            std::process::ExitCode::from(2)
        }
    }
}

fn report(target: &Path) -> Result<bool> {
    let fstype = filesystem_type(target);
    let supported =
        nowait_supported_at(target).with_context(|| format!("probe {}", target.display()))?;

    println!("path            {}", target.display());
    println!("filesystem      {}", fstype.as_deref().unwrap_or("unknown"));
    if let Some(kb) = read_ahead_kb(target) {
        // Not cosmetic: read-ahead is what protects sequential access under cache pressure,
        // and the lab host's 8 MiB against Linux's 128 KiB default moved every measured
        // miss rate (docs/disk-access/ACCESS-PATTERNS.md §4.1).
        println!("read_ahead_kb   {kb}");
    }
    println!(
        "RWF_NOWAIT      {}",
        if supported {
            "honoured"
        } else {
            "REFUSED (EOPNOTSUPP)"
        }
    );
    println!();

    if supported {
        println!("PASS — the server gets its fast path here.");
        println!("       Warm asks take no thread-pool hop; cold reads return short instead");
        println!("       of parking an executor thread.");
    } else {
        println!("FALLBACK — the server will still serve correctly, but every frame costs");
        println!("           one blocking-pool round trip instead of none.");
        println!();
        println!("Most likely cause: this path is on a container's own filesystem (overlayfs)");
        println!("or a tmpfs/RAM disk. Neither implements RWF_NOWAIT.");
        println!();
        println!("Fix: serve studies from a volume backed by a real filesystem (ext4/XFS)");
        println!("     rather than the container layer. See docs/disk-access/DEPLOYMENT.md");
    }
    Ok(supported)
}

/// Filesystem name for `path`, via `statfs` magic. Only the types this decision turns on are
/// named; anything else is reported by its magic so it can be looked up rather than guessed.
fn filesystem_type(path: &Path) -> Option<String> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `buf` is a live statfs; `c` is a valid NUL-terminated path.
    let mut buf: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c.as_ptr(), &mut buf) } != 0 {
        return None;
    }
    // `f_type` is `__fsword_t` on glibc but a plain `u32` on musl and 32-bit targets, so the
    // cast is what makes this compile everywhere — clippy only sees the one arch where it is
    // already i64.
    #[allow(clippy::unnecessary_cast)]
    let magic = buf.f_type as i64;
    Some(match magic {
        0xEF53 => "ext2/ext3/ext4".into(),
        0x58465342 => "xfs".into(),
        0x9123683E => "btrfs".into(),
        0x01021994 => "tmpfs".into(),
        0x794C7630 => "overlayfs".into(),
        0x6969 => "nfs".into(),
        0x65735546 => "fuse".into(),
        0x2FC12FC1 => "zfs".into(),
        other => format!("unrecognised (statfs magic {other:#x})"),
    })
}

/// `read_ahead_kb` for the block device behind `path`, if it has one (network and virtual
/// filesystems do not). Best effort — its absence is not an error.
fn read_ahead_kb(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    use std::os::unix::fs::MetadataExt;
    let dev = meta.dev();
    let (major, minor) = (libc::major(dev), libc::minor(dev));
    // The device may be a partition; its queue lives on the parent, which sysfs links for us.
    let dir = format!("/sys/dev/block/{major}:{minor}");
    for candidate in [
        format!("{dir}/queue/read_ahead_kb"),
        format!("{dir}/../queue/read_ahead_kb"),
    ] {
        if let Ok(v) = std::fs::read_to_string(&candidate) {
            return Some(v.trim().to_string());
        }
    }
    None
}
