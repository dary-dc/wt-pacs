//! The package build alone, from exam trees on disk: docs/adr/pcs-transfer.md §15.10.
mod exam;

use exam::*;
use sender::outbox::Outbox;
use sender::package::{intact, ZSTD_MAGIC};
use sender::Stop;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::Path;
use std::time::{Duration, SystemTime};
use xxhash_rust::xxh3::xxh3_64;

fn name(marker: &str, bytes: &[u8]) -> String {
    format!("{marker}.{:016x}", xxh3_64(bytes))
}

/// Copies a tree in reverse creation order, with other modes, mtimes and, as root, owners.
fn copy_reversed(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    let mut entries: Vec<_> = fs::read_dir(from)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    for path in entries.into_iter().rev() {
        let target = to.join(path.file_name().unwrap());
        if path.is_dir() {
            copy_reversed(&path, &target);
            continue;
        }
        fs::copy(&path, &target).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        let file = fs::File::options().write(true).open(&target).unwrap();
        file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000_000))
            .unwrap();
        if is_root() {
            std::os::unix::fs::chown(&target, Some(1234), Some(1234)).unwrap();
        }
    }
}

fn is_root() -> bool {
    fs::metadata("/proc/self").is_ok_and(|m| std::os::unix::fs::MetadataExt::uid(&m) == 0)
}

fn listing(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect()
}

/// The same tree, copied with other mtimes, modes, owners and creation order, builds a
/// byte-equal package under the same name.
#[test]
fn the_same_tree_builds_the_same_bytes() {
    let dir = scratch("twice");
    let a = exam(&dir.join("a"));
    let b = dir.join("b/PbPb").join(STUDY);
    copy_reversed(&a, &b);
    if Path::new("/dev/shm").is_dir() {
        assert_ne!(
            listing(&a.join(UNIT)),
            listing(&b.join(UNIT)),
            "the copies list alike"
        );
    }
    let (one, two) = (
        Outbox::open(&dir.join("out-a")).unwrap(),
        Outbox::open(&dir.join("out-b")).unwrap(),
    );
    assert_eq!(sender::next(&one, &a, UNIT, true).unwrap(), Some(1));
    assert_eq!(sender::next(&two, &b, UNIT, true).unwrap(), Some(1));
    let (x, y) = (kept(one.path()), kept(two.path()));
    assert_eq!(x.file_name(), y.file_name());
    assert!(
        fs::read(&x).unwrap() == fs::read(&y).unwrap(),
        "the bytes differ"
    );
}

/// A byte flipped in the header, the metadata or the bundle fails the package's own name, and
/// the sender rebuilds the bytes the name was made from.
#[test]
fn a_changed_byte_fails_the_name_and_is_rebuilt() {
    let dir = scratch("flip");
    let exam = exam(&dir);
    let outbox = Outbox::open(&dir.join("out")).unwrap();
    sender::next(&outbox, &exam, UNIT, true).unwrap();
    let path = kept(outbox.path());
    let good = fs::read(&path).unwrap();
    assert!(intact(&path).unwrap());
    let in_bundle = good.len() - 1024 - 1000;
    for (what, offset) in [
        ("header", 512 + 7),
        ("metadata", 3 * 512 + 9),
        ("bundle", in_bundle),
    ] {
        let mut bad = good.clone();
        bad[offset] ^= 1;
        fs::write(&path, &bad).unwrap();
        assert!(!intact(&path).unwrap(), "a flipped {what} byte passed");
        let rebuilt = sender::kept_or_rebuilt(&outbox, &exam, UNIT, 1).unwrap();
        assert_eq!(rebuilt, path);
        assert!(
            fs::read(&rebuilt).unwrap() == good,
            "{what}: not rebuilt to the same bytes"
        );
    }
}

/// Construction folders, raw frames, the PDF's containers, dotfiles, unknown names and another
/// series stay out: the package holds layout 2's members and nothing else, in byte order.
#[test]
fn the_allow_list_leaves_the_rest_out() {
    let dir = scratch("allow");
    let exam = exam(&dir);
    let series = exam.join(UNIT);
    group(&series.join("c"), "----", b"\x08construction");
    fs::write(series.join("c/00001.j2c"), b"codestream").unwrap();
    group(&series.join("b"), "----", b"\x08construction");
    fs::write(series.join("b/00001.tif"), b"tiff").unwrap();
    fs::write(series.join("In01/00001.OPC"), b"raw frame").unwrap();
    group(&series.join("In02/d"), "----", b"\x08the PDF's layout");
    for other in [
        "mf.mxf",
        "sf.jxl",
        "mf.mp4",
        ".hidden",
        "---.nothex",
        "series.sbnd.tmp",
    ] {
        fs::write(series.join(other), b"left out").unwrap();
    }
    fs::write(exam.join(".DS_Store"), b"left out").unwrap();
    group(&exam.join("Se02"), "---", b"\x08another series");
    instance(&exam, "Se02", "In09", false);

    let outbox = Outbox::open(&dir.join("out")).unwrap();
    sender::next(&outbox, &exam, UNIT, true).unwrap();
    let package = Package::read(&kept(outbox.path()));
    assert_eq!(package.members, ["package", "metadata", "Se01/series.sbnd"]);
    let expected = [
        name("--", b"\x08exam group"),
        format!("Se01/{}", name("---", b"\x08series group")),
        format!("Se01/In01/{}", name("----", b"\x08instance In01")),
        format!("Se01/In01/{}", name("priv", b"\x08private In01")),
        format!("Se01/In02/{}", name("----", b"\x08instance In02")),
        format!("Se01/In03/{}", name("----", b"\x08instance In03")),
    ];
    assert_eq!(package.groups(), expected);
}

/// A link in place of a group, two series groups, an instance without its group, a group off its
/// name and no bundle: each refused as unpackable, with nothing kept.
#[test]
fn an_unpackable_tree_is_refused_with_nothing_kept() {
    type Break = fn(&Path);
    let cases: [(&str, Break); 5] = [
        ("a link", |series| {
            let group = name("---", b"\x08series group");
            fs::rename(series.join(&group), series.join("elsewhere")).unwrap();
            symlink(series.join("elsewhere"), series.join(&group)).unwrap();
        }),
        ("two series groups", |series| {
            group(series, "---", b"\x08a corrected series group");
        }),
        ("an instance without its group", |series| {
            fs::create_dir(series.join("In04")).unwrap();
            fs::write(series.join("In04/00001.OPC"), b"raw frame").unwrap();
        }),
        ("a group off its name", |series| {
            fs::write(
                series.join("In02").join(name("----", b"\x08instance In02")),
                b"\x08changed",
            )
            .unwrap();
        }),
        ("no bundle", |series| {
            fs::remove_file(series.join("series.sbnd")).unwrap()
        }),
    ];
    for (i, (case, break_it)) in cases.into_iter().enumerate() {
        let dir = scratch(&format!("refused-{i}"));
        let exam = exam(&dir);
        break_it(&exam.join(UNIT));
        let outbox = Outbox::open(&dir.join("out")).unwrap();
        let err = sender::next(&outbox, &exam, UNIT, true).unwrap_err();
        assert!(
            matches!(err.downcast_ref::<Stop>(), Some(Stop::Unpackable(_))),
            "{case}: {err:#}"
        );
        assert!(
            fs::read_dir(outbox.path()).unwrap().next().is_none(),
            "{case}: something kept"
        );
    }
}

/// Under `zstd` the metadata is one zstd frame, with its content size and checksum, of the very
/// inner tar `plain` stores as it is; the bundle is stored as it is under both.
#[test]
fn the_profile_compresses_the_metadata_or_not() {
    let dir = scratch("profiles");
    let exam = exam(&dir);
    let (zstd_out, plain_out) = (
        Outbox::open(&dir.join("zstd")).unwrap(),
        Outbox::open(&dir.join("plain")).unwrap(),
    );
    sender::next(&zstd_out, &exam, UNIT, true).unwrap();
    sender::next(&plain_out, &exam, UNIT, false).unwrap();
    let (zstd_path, plain_path) = (kept(zstd_out.path()), kept(plain_out.path()));
    assert_ne!(zstd_path.file_name(), plain_path.file_name());
    let (zstd, plain) = (Package::read(&zstd_path), Package::read(&plain_path));
    assert!(zstd.metadata.starts_with(&ZSTD_MAGIC));
    assert!(!plain.metadata.starts_with(&ZSTD_MAGIC));
    assert_eq!(
        zstd::zstd_safe::find_frame_compressed_size(&zstd.metadata),
        Ok(zstd.metadata.len())
    );
    let content_size = zstd::zstd_safe::get_frame_content_size(&zstd.metadata);
    assert_eq!(content_size.ok(), Some(Some(plain.metadata.len() as u64)));
    assert_ne!(zstd.metadata[4] & 0x04, 0, "no checksum flag");
    assert!(zstd.inner() == plain.metadata);
    assert!(
        zstd.bundle == plain.bundle
            && zstd.bundle == fs::read(exam.join(UNIT).join("series.sbnd")).unwrap()
    );
}

/// A second call with nothing new builds nothing; after a late instance it builds revision 2, an
/// addition of the exam and series groups and only the new instance's groups.
#[test]
fn a_late_instance_makes_an_addition() {
    let dir = scratch("addition");
    let exam = exam(&dir);
    let outbox = Outbox::open(&dir.join("out")).unwrap();
    assert_eq!(sender::next(&outbox, &exam, UNIT, true).unwrap(), Some(1));
    assert_eq!(sender::next(&outbox, &exam, UNIT, true).unwrap(), None);
    instance(&exam, UNIT, "In04", true);
    assert_eq!(sender::next(&outbox, &exam, UNIT, true).unwrap(), Some(2));
    let first = Package::read(&outbox.kept(UNIT, 1).unwrap()[0]);
    assert_eq!(
        first.header,
        "layout 2\nkind series\nstudy Ex01\nunit Se01\nrevision 1\n"
    );
    let addition = Package::read(&outbox.kept(UNIT, 2).unwrap()[0]);
    assert_eq!(
        addition.header,
        "layout 2\nkind addition\nstudy Ex01\nunit Se01\nrevision 2\n"
    );
    let expected = [
        name("--", b"\x08exam group"),
        format!("Se01/{}", name("---", b"\x08series group")),
        format!("Se01/In04/{}", name("----", b"\x08instance In04")),
        format!("Se01/In04/{}", name("priv", b"\x08private In04")),
    ];
    assert_eq!(addition.groups(), expected);
}

/// Killed after the rename and before the record: the next call builds the same revision again,
/// to the same name, and keeps one package.
#[test]
fn a_build_killed_before_its_record_is_built_again() {
    let dir = scratch("crash");
    let exam = exam(&dir);
    let outbox = Outbox::open(&dir.join("out")).unwrap();
    sender::next(&outbox, &exam, UNIT, true).unwrap();
    let first = kept(outbox.path());
    fs::remove_file(outbox.path().join(UNIT).join("1")).unwrap();
    fs::write(outbox.path().join("Se01.1.partial"), b"a build cut short").unwrap();
    assert_eq!(sender::next(&outbox, &exam, UNIT, true).unwrap(), Some(1));
    assert_eq!(kept(outbox.path()), first);
    assert!(!outbox.path().join("Se01.1.partial").exists());
}
