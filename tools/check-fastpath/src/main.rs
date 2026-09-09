//! Does this host's storage give the server its fast read path? Run it against the
//! directory studies will be served from, before deploying: `docs/disk-access/DEPLOYMENT.md`.
//!
//! Exit status is the answer, so it can gate a rollout: 0 fast path, 1 fallback, 2 unknown.

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
        // Moves every measured miss rate; record it beside a campaign. `docs/disk-access/DEPLOYMENT.md`.
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

/// Filesystem name for `path`, via `statfs` magic. An unrecognised one is reported by its
/// magic so it can be looked up rather than guessed.
fn filesystem_type(path: &Path) -> Option<String> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `buf` is a live statfs; `c` is a valid NUL-terminated path.
    let mut buf: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c.as_ptr(), &mut buf) } != 0 {
        return None;
    }
    // `f_type` is `__fsword_t` on glibc but `u32` on musl and 32-bit targets; the cast is
    // what makes this compile everywhere.
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

/// `read_ahead_kb` for the block device behind `path`. Network and virtual filesystems have
/// none, and that absence is not an error.
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
