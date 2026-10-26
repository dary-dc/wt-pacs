use super::*;
use crate::{Downstream, Kind, Level, Step, Stored};
use std::cell::RefCell;
use std::fs;
use std::rc::Rc;

const I1: &str = "1.2.826.0.1.7.1.1";
const I2: &str = "1.2.826.0.1.7.1.2";
const I3: &str = "1.2.826.0.1.7.1.3";

fn first() -> Package {
    Package::series(SERIES, 1, "DOE^JANE", &[(I1, 2), (I2, 1)], 10)
}

fn refused(outcome: &Outcome, says: &str) {
    match outcome {
        Outcome::Refused(why) => assert!(why.contains(says), "refused for {why:?}, not {says:?}"),
        other => panic!("{other:?}, not refused for {says:?}"),
    }
}

fn exam_update(revision: u32, patient: &str) -> Package {
    let mut p = Package::new("update", &c(STUDY), revision);
    p.group(format!("{}/--", c(STUDY)), exam_group(patient));
    p
}

/// A series package is stored whole: its bundle placed byte for byte, a row per group in its
/// level's table with the group's own bytes and hash, one audit record; then the status says
/// "stored" and nothing of the package is left in `incoming/`.
#[test]
fn a_series_package_is_placed_recorded_confirmed_and_deleted() {
    let site = Site::new("stored");
    let package = first();
    let name = site.arrive(&package);
    assert_eq!(
        site.receiver().run().unwrap(),
        vec![(name.clone(), Outcome::Stored)]
    );
    assert_eq!(
        fs::read(site.bundle_path(SERIES)).unwrap(),
        package.members.last().unwrap().1
    );
    let rows = site.rows();
    let tables: Vec<&str> = rows.iter().map(|r| r.0.as_str()).collect();
    assert_eq!(tables, ["exam", "series", "instance", "instance"]);
    assert_eq!(rows[0], ("exam".into(), c(STUDY), exam_group("DOE^JANE")));
    assert_eq!(rows[2].1, c(I1));
    assert_eq!(site.audit().len(), 1);
    assert_eq!(site.status(&name), "stored\n");
    assert_eq!(Site::files(&site.incoming), [format!("status/{name}")]);
}

/// Only complete arrivals are taken: a carrier's `.partial` and the receiver's lock are not packages.
#[test]
fn a_partial_arrival_is_not_picked_up() {
    let site = Site::new("partial");
    let receiver = site.receiver();
    fs::write(
        site.incoming.join("x.1.0000000000000000.tar.partial"),
        b"half",
    )
    .unwrap();
    assert!(receiver.pending().unwrap().is_empty());
    let name = site.arrive(&first());
    assert_eq!(receiver.pending().unwrap(), [name]);
}

/// Step 2: an update jumps the series packages ahead of it, whatever their names.
#[test]
fn an_update_is_taken_before_series_packages() {
    let site = Site::new("order");
    let series = site.arrive(&Package::series("0.9", 1, "DOE^JANE", &[(I1, 1)], 10));
    let update = site.arrive(&exam_update(1, "DOE^J"));
    assert!(
        series < update,
        "the test needs the update to sort last by name"
    );
    assert_eq!(site.receiver().pending().unwrap(), [update, series]);
}

/// Step 3: a package whose bytes are not its name's hash is refused, written nowhere, and kept in
/// `refused/` for the resend to be compared with.
#[test]
fn a_package_not_hashing_to_its_name_is_refused_and_kept() {
    let site = Site::new("hash");
    let package = first();
    let mut bytes = package.tar();
    let name = package.name_of(&bytes);
    let last = bytes.len() - 1030;
    bytes[last] ^= 1;
    site.arrive_bytes(&name, &bytes);
    refused(&site.receiver().receive(&name).unwrap(), "hashes to");
    assert!(site
        .status(&name)
        .starts_with("refused the package hashes to"));
    assert!(Site::files(&site.root).is_empty());
    assert_eq!(
        fs::read(site.incoming.join("refused").join(&name)).unwrap(),
        bytes
    );
}

/// A file name outside `<unit>.<revision>.<hash>.tar` is refused by name.
#[test]
fn a_name_outside_the_grammar_is_refused() {
    let site = Site::new("name");
    let bytes = first().tar();
    for (name, says) in [
        ("x.tar", "is not <unit>"),
        (
            &format!("TO.01.{:016x}.tar", xxh3_64(&bytes)),
            "not a number",
        ),
        (&format!("T.1.{:016x}.tar", xxh3_64(&bytes)), "coded UID"),
        ("TO.1.ABCDEF0123456789.tar", "16 lowercase hex"),
    ] {
        site.arrive_bytes(name, &bytes);
        refused(&site.receiver().receive(name).unwrap(), says);
    }
}

/// Step 4: a header in another layout, or naming another unit or revision than the file, is refused.
#[test]
fn a_header_the_name_or_layout_disagrees_with_is_refused() {
    let site = Site::new("header");
    let mut other_layout = first();
    other_layout.header = other_layout.header.replace("layout 1", "layout 2");
    refused(&site.receive(&other_layout), "layout \"2\"");
    let mut other_revision = first();
    other_revision.header = other_revision.header.replace("revision 1", "revision 2");
    refused(&site.receive(&other_revision), "the header names");
    let mut not_coded = first();
    not_coded.header = not_coded
        .header
        .replace(&format!("study {}", c(STUDY)), "study 1.2");
    refused(&site.receive(&not_coded), "is not a coded UID");
    let mut extra_line = first();
    extra_line.header.push_str("sender x\n");
    refused(&site.receive(&extra_line), "6 lines");
    let mut too_long = first();
    too_long.header.push_str(&" ".repeat(5000));
    refused(&site.receive(&too_long), "-byte header");
    let mut not_first = first();
    let header = not_first.header.clone().into_bytes();
    not_first.header = String::new();
    let bytes = tar_of(&[
        (
            not_first.members[0].0.clone(),
            not_first.members[0].1.clone(),
        ),
        ("package".into(), header),
    ]);
    let name = site.arrive_bytes(&not_first.name_of(&bytes), &bytes);
    refused(&site.receiver().receive(&name).unwrap(), "first member");
}

/// Members outside layout 1 are refused before anything is placed: a parent directory, an absolute
/// path, another study, an unknown file, a link, a member twice.
#[test]
fn a_member_outside_the_layout_is_refused() {
    let site = Site::new("members");
    let (e, s) = (c(STUDY), c(SERIES));
    for (path, says) in [
        ("../x".to_owned(), "outside the study"),
        (format!("/{e}/--.0000000000000000"), "outside the study"),
        (format!("{e}/../{e}/--.0000000000000000"), "not a coded UID"),
        (
            format!("{}/--.0000000000000000", c("1.2.9")),
            "outside the study",
        ),
        (format!("{e}/{s}/run.sh"), "not a member of layout 1"),
        (format!("{e}/{s}/run"), "not a group or the bundle"),
    ] {
        let mut p = first();
        p.members.insert(1, (path.clone(), b"x".to_vec()));
        refused(&site.receive(&p), says);
    }
    let mut twice = first();
    twice.members.insert(1, twice.members[0].clone());
    refused(&site.receive(&twice), "appears twice");

    let mut link = first();
    let mut members = vec![("package".to_owned(), link.header.clone().into_bytes())];
    members.append(&mut link.members);
    let mut bytes = tar_of(&members);
    bytes[1024 + 156] = b'2';
    let mut header = tar::Header::new_old();
    header.as_mut_bytes().copy_from_slice(&bytes[1024..1536]);
    header.set_cksum();
    bytes[1024..1536].copy_from_slice(header.as_bytes());
    let name = site.arrive_bytes(&link.name_of(&bytes), &bytes);
    refused(
        &site.receiver().receive(&name).unwrap(),
        "not a regular file",
    );
    assert!(Site::files(&site.root).is_empty());
}

/// Step 5: a group whose bytes are not its name's hash is refused.
#[test]
fn a_group_not_hashing_to_its_name_is_refused() {
    let site = Site::new("group-hash");
    let mut p = first();
    p.members[2].1.push(0);
    refused(&site.receive(&p), "does not hash to its name");
}

/// A group sent as a zstd frame is stored as the group: the same rows as the plain package. The
/// switch is the sender's alone.
#[test]
fn a_zstd_compressed_group_is_stored_as_the_group() {
    let plain = Site::new("plain");
    assert_eq!(plain.receive(&first()), Outcome::Stored);
    let zstd = Site::new("zstd");
    let mut p = first();
    for (path, bytes) in p.members.iter_mut() {
        if !path.ends_with(".sbnd") {
            *bytes = zstd::encode_all(bytes.as_slice(), 1).unwrap();
        }
    }
    assert_eq!(zstd.receive(&p), Outcome::Stored);
    assert_eq!(zstd.rows(), plain.rows());
}

/// A group member past the group limit is refused before it is read into memory.
#[test]
fn a_group_past_the_limit_is_refused_unread() {
    let site = Site::new("huge");
    let mut p = first();
    p.members[0].1 = vec![0u8; crate::package::MAX_GROUP_LEN as usize + 1];
    refused(
        &site.receive(&p),
        &format!("is {} bytes", crate::package::MAX_GROUP_LEN + 1),
    );
}

/// A zstd frame that decompresses past the group limit is refused, not decompressed whole.
#[test]
fn a_zstd_bomb_is_refused() {
    let site = Site::new("bomb");
    let mut p = first();
    let huge = vec![0u8; crate::package::MAX_GROUP_LEN as usize + 1];
    p.members[0].1 = zstd::encode_all(huge.as_slice(), 1).unwrap();
    refused(&site.receive(&p), "decompresses past");
}

/// A group holding another UID than the directory it sits in is refused: metadata and pixels
/// must name the same objects.
#[test]
fn a_group_holding_another_uid_than_its_path_is_refused() {
    let site = Site::new("uid");
    let mut p = Package::series(SERIES, 1, "DOE^JANE", &[(I1, 1)], 10);
    let wrong = instance_group(I2, 1);
    let path = p.members[2].0.rsplit_once('.').unwrap().0.to_owned();
    p.members[2] = (format!("{path}.{:016x}", xxh3_64(&wrong)), wrong);
    refused(&site.receive(&p), "holds UID");
}

/// Step 5: a series package must carry one exam group, one series group of its unit, instance
/// groups and one bundle, of its unit; an update carries groups of its unit and no bundle.
#[test]
fn a_package_missing_what_its_kind_needs_is_refused() {
    let site = Site::new("set");
    let mut no_bundle = first();
    no_bundle.members.pop();
    refused(&site.receive(&no_bundle), "without its bundle");
    let mut two_bundles = first();
    let second = (
        format!("{}/{}/series.sbnd", c(STUDY), c(SERIES_B)),
        bundle(3, 10),
    );
    two_bundles.members.push(second.clone());
    refused(&site.receive(&two_bundles), "a second bundle");
    let mut other_bundle = first();
    *other_bundle.members.last_mut().unwrap() = second;
    refused(&site.receive(&other_bundle), "the bundle is series");
    let mut no_series_group = first();
    no_series_group.members.remove(1);
    refused(
        &site.receive(&no_series_group),
        "one exam and one series group",
    );
    let mut orphan = first();
    orphan.group(
        format!("{}/{}/{}/priv", c(STUDY), c(SERIES), c(I3)),
        record(0x0009_0010, b"LO", b"x"),
    );
    refused(&site.receive(&orphan), "has no instance group");
    let mut no_instances = first();
    no_instances.members.drain(2..4);
    refused(&site.receive(&no_instances), "without instance groups");
    let mut other_series = Package::series(SERIES_B, 1, "DOE^JANE", &[(I1, 1)], 10);
    other_series.header = other_series.header.replace(&c(SERIES_B), &c(SERIES));
    other_series.unit = c(SERIES);
    refused(&site.receive(&other_series), "outside the unit");
    assert_eq!(site.receive(&first()), Outcome::Stored);
    let mut with_bundle = exam_update(1, "X");
    with_bundle.members.push(first().members.pop().unwrap());
    refused(&site.receive(&with_bundle), "carries no bundle");
    refused(
        &site.receive(&Package::new("update", &c(STUDY), 1)),
        "an update with no group",
    );
    let mut exam_in_series = Package::new("update", &c(SERIES), 2);
    exam_in_series.group(format!("{}/--", c(STUDY)), exam_group("X"));
    refused(
        &site.receive(&exam_in_series),
        "an exam group in an update of series",
    );
}

/// Step 6b: the bundle's frames must be the instance groups' frames, and it must open as v1.
#[test]
fn a_bundle_not_matching_its_instances_or_not_v1_is_refused() {
    let site = Site::new("bundle");
    let mut p = first();
    p.members.last_mut().unwrap().1 = bundle(4, 10);
    refused(&site.receive(&p), "hold 3 frames, the bundle 4");
    let mut p = first();
    p.members.last_mut().unwrap().1[0] = b'X';
    refused(&site.receive(&p), "invalid magic");
    let mut p = first();
    p.members.last_mut().unwrap().1[4] = 2;
    refused(&site.receive(&p), "version 2");
    let mut p = first();
    p.members.last_mut().unwrap().1 = bundle_with(3, 10, r#"{"frameCount": 5}"#);
    refused(&site.receive(&p), "frameCount 5, 3 frames indexed");
    let mut p = first();
    p.members.last_mut().unwrap().1 = bundle_with(3, 10, r#"{"frameCount": 3, "codec": "jxl"}"#);
    refused(&site.receive(&p), "codec \"jxl\"");
}

/// Step 6b reads the staged files back from disk: a staged bundle or group changed after its
/// write is refused, and the serving tree is untouched.
#[test]
fn a_staged_file_changed_after_its_write_is_refused_by_the_read_back() {
    for target in [".sbnd", "/----."] {
        let site = Site::new("readback");
        let name = site.arrive(&first());
        let work = site.incoming.join(format!("{name}.work"));
        let outcome = site.receiver().receive_at(&name, &mut |step| {
            if step == Step::Staged {
                let file = Site::files(&work)
                    .into_iter()
                    .find(|f| f.contains(target))
                    .unwrap();
                let path = work.join(file);
                let mut bytes = fs::read(&path).unwrap();
                let at = bytes.len() - 1;
                bytes[at] ^= 1;
                fs::write(&path, bytes).unwrap();
            }
        });
        refused(&outcome.unwrap(), "reads back");
        assert!(
            Site::files(&site.root).is_empty(),
            "{target}: the serving tree changed"
        );
    }
}

/// Flips one byte of a stored group's bytes in the study DB file, past SQLite's own checks.
fn corrupt_row(site: &Site, needle: &[u8]) {
    let path = site.study().join(study_db::FILE);
    site.db()
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
        .unwrap();
    let mut bytes = fs::read(&path).unwrap();
    let at = bytes
        .windows(needle.len())
        .position(|w| w == needle)
        .expect("the row is in the file");
    bytes[at] ^= 0x20;
    fs::write(&path, bytes).unwrap();
}

/// Step 8: a study DB whose rows read back wrong from disk is undone: a new study's directory goes;
/// in a stored study the rows and the bundle are the prior ones, with no audit record of the package.
#[test]
fn a_study_db_reading_back_wrong_is_undone() {
    let site = Site::new("db-new");
    let name = site.arrive(&first());
    let outcome = site.receiver().receive_at(&name, &mut |s| {
        if s == Step::Recorded {
            corrupt_row(&site, b"DOE^JANE")
        }
    });
    refused(&outcome.unwrap(), "read back from disk");
    assert!(Site::files(&site.root).is_empty());

    let site = Site::new("db-stored");
    assert_eq!(site.receive(&first()), Outcome::Stored);
    let (rows, bundle_before) = (site.rows(), fs::read(site.bundle_path(SERIES)).unwrap());
    let reinsert_i2 = |site: &Site| {
        let i2 = rows.iter().find(|r| r.1 == c(I2)).unwrap();
        site.db()
            .execute(
                "INSERT INTO instance VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![i2.1, c(SERIES), format!("{:016x}", xxh3_64(&i2.2)), i2.2],
            )
            .unwrap();
    };
    type Harm<'a> = &'a dyn Fn(&Site);
    let cases: [(Package, Harm, &str); 3] = [
        (
            exam_update(1, "ROE^JOHN"),
            &|site| corrupt_row(site, b"ROE^JOHN"),
            "reads back as",
        ),
        (
            Package::series(SERIES, 2, "ROE^JACK", &[(I3, 1)], 50),
            &|site| corrupt_row(site, b"ROE^JACK"),
            "reads back as",
        ),
        (
            Package::series(SERIES, 2, "ROE^JILL", &[(I1, 1)], 60),
            &reinsert_i2,
            "was removed and reads back",
        ),
    ];
    for (package, harm, says) in cases {
        let name = site.arrive(&package);
        let outcome = site.receiver().receive_at(&name, &mut |s| {
            if s == Step::Recorded {
                harm(&site)
            }
        });
        refused(&outcome.unwrap(), says);
        assert_eq!(site.rows(), rows);
        assert_eq!(fs::read(site.bundle_path(SERIES)).unwrap(), bundle_before);
        assert_eq!(site.audit().len(), 1);
    }
}

/// Step 8 runs SQLite's own integrity check: an index that no longer matches its table, which
/// reading rows by UID never touches, refuses the package.
#[test]
fn a_study_db_failing_its_integrity_check_is_refused() {
    let site = Site::new("integrity");
    let name = site.arrive(&first());
    let outcome = site.receiver().receive_at(&name, &mut |s| {
        if s == Step::Recorded {
            let db = site.db();
            db.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
                .unwrap();
            let page: i64 = db
                .query_row(
                    "SELECT rootpage FROM sqlite_schema WHERE name = 'instance_series'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let size: i64 = db.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap();
            drop(db);
            let path = site.study().join(study_db::FILE);
            let mut bytes = fs::read(&path).unwrap();
            let index = &mut bytes[((page - 1) * size) as usize..(page * size) as usize];
            let at = index
                .windows(c(SERIES).len())
                .position(|w| w == c(SERIES).as_bytes())
                .unwrap();
            index[at] ^= 1;
            fs::write(&path, bytes).unwrap();
        }
    });
    refused(&outcome.unwrap(), "integrity_check");
    assert!(Site::files(&site.root).is_empty());
}

/// A failed read-back of a package already recorded, sent again, undoes nothing: the rows its
/// first pass stored stay.
#[test]
fn a_failed_read_back_of_a_resend_keeps_the_stored_rows() {
    let site = Site::new("db-resend");
    assert_eq!(site.receive(&first()), Outcome::Stored);
    let name = site.arrive(&first());
    let outcome = site.receiver().receive_at(&name, &mut |s| {
        if s == Step::Recorded {
            site.db()
                .execute("UPDATE exam SET xxh3 = '0000000000000000'", [])
                .unwrap();
        }
    });
    refused(&outcome.unwrap(), "reads back as");
    let count: u32 = site
        .db()
        .query_row("SELECT count(*) FROM instance", [], |r| r.get(0))
        .unwrap();
    assert_eq!((count, site.audit().len()), (2, 1));
}

/// An update replaces the row at its level and nothing deeper; the audit says what it replaced
/// with what; the bundle is not touched.
#[test]
fn an_update_replaces_its_rows_and_audits_them() {
    let site = Site::new("update");
    assert_eq!(site.receive(&first()), Outcome::Stored);
    let bundle = fs::read(site.bundle_path(SERIES)).unwrap();
    let before = site.rows();
    assert_eq!(site.receive(&exam_update(1, "ROE^JOHN")), Outcome::Stored);
    let after = site.rows();
    assert_eq!(after[0].2, exam_group("ROE^JOHN"));
    assert_eq!(after[1..], before[1..]);
    assert_eq!(fs::read(site.bundle_path(SERIES)).unwrap(), bundle);
    let (unit, revision, changes) = site.audit().pop().unwrap();
    assert_eq!((unit, revision), (c(STUDY), 1));
    let old = format!("{:016x}", xxh3_64(&exam_group("DOE^JANE")));
    let new = format!("{:016x}", xxh3_64(&exam_group("ROE^JOHN")));
    assert_eq!(changes, format!("exam {} {old} {new}", c(STUDY)));
}

/// An update to a row that is not stored, or to a study that is not, is refused; the rows stay.
#[test]
fn an_update_to_nothing_stored_is_refused() {
    let site = Site::new("update-none");
    refused(&site.receive(&exam_update(1, "X")), "which is not stored");
    assert_eq!(site.receive(&first()), Outcome::Stored);
    let rows = site.rows();
    let mut p = Package::new("update", &c(SERIES), 2);
    p.group(
        format!("{}/{}/{}/----", c(STUDY), c(SERIES), c(I3)),
        instance_group(I3, 1),
    );
    refused(&site.receive(&p), "no current instance");
    let mut moved = Package::new("update", &c(SERIES_B), 1);
    moved.group(
        format!("{}/{}/{}/----", c(STUDY), c(SERIES_B), c(I1)),
        instance_group(I1, 2),
    );
    refused(&site.receive(&moved), "belongs to series");
    assert_eq!(site.rows(), rows);
}

/// A private group is stored beside its instance, in its own table, under the instance's UID.
#[test]
fn a_private_group_is_stored_with_its_instance() {
    let site = Site::new("private");
    let mut p = first();
    let private = record(0x0009_0010, b"LO", b"vendor");
    p.group(
        format!("{}/{}/{}/priv", c(STUDY), c(SERIES), c(I1)),
        private.clone(),
    );
    assert_eq!(site.receive(&p), Outcome::Stored);
    let row = study_db::current(&site.db(), Level::Private, &c(I1))
        .unwrap()
        .unwrap();
    assert_eq!((row.series, row.bytes), (Some(c(SERIES)), private));
}

/// The stored revision sent again is "stored" again and changes nothing; an older one is
/// answered without being staged.
#[test]
fn a_resend_of_a_stored_revision_is_stored_without_change() {
    let site = Site::new("resend");
    assert_eq!(site.receive(&first()), Outcome::Stored);
    let rows = site.rows();
    assert_eq!(site.receive(&first()), Outcome::Stored);
    assert_eq!((site.rows(), site.audit().len()), (rows.clone(), 1));
    assert_eq!(
        site.receive(&Package::series(SERIES, 2, "DOE^JANE", &[(I1, 1)], 50)),
        Outcome::Stored
    );
    let name = site.arrive(&first());
    let outcome = site.receiver().receive_at(&name, &mut |s| {
        assert_ne!(s, Step::Staged, "an old revision was staged")
    });
    assert_eq!(outcome.unwrap(), Outcome::Stored);
    assert_eq!(fs::read(site.bundle_path(SERIES)).unwrap(), bundle(1, 50));
}

/// Two packages for one (unit, revision) are an operator's: quarantined at once, never refused.
#[test]
fn another_package_for_a_stored_revision_is_quarantined() {
    let site = Site::new("conflict");
    assert_eq!(site.receive(&first()), Outcome::Stored);
    let other = Package::series(SERIES, 1, "DOE^JANE", &[(I1, 2), (I2, 1)], 99);
    let name = site.arrive(&other);
    match site.receiver().receive(&name).unwrap() {
        Outcome::Quarantined(why) => assert!(why.contains("is stored as")),
        other => panic!("{other:?}"),
    }
    assert!(site.incoming.join("quarantine").join(&name).exists());
    assert!(site.status(&name).starts_with("quarantined "));
}

/// A revision past the next is refused until the one before it is stored; then its resend is
/// stored and its refused copy goes.
#[test]
fn a_revision_out_of_order_is_refused_until_its_predecessor_is_stored() {
    let site = Site::new("gap");
    assert_eq!(site.receive(&first()), Outcome::Stored);
    let third = Package::series(SERIES, 3, "DOE^JANE", &[(I1, 1)], 30);
    refused(&site.receive(&third), "after stored revision 1");
    assert_eq!(
        site.receive(&Package::series(SERIES, 2, "DOE^JANE", &[(I1, 1)], 20)),
        Outcome::Stored
    );
    let name = site.arrive(&third);
    assert_eq!(site.receiver().receive(&name).unwrap(), Outcome::Stored);
    assert!(Site::files(&site.incoming.join("refused")).is_empty());
}

/// A series' next revision replaces it whole: an instance it no longer holds leaves the study DB,
/// the bundle is the new one, and the audit lists the removal.
#[test]
fn a_series_revision_replaces_the_series_whole() {
    let site = Site::new("revision");
    assert_eq!(site.receive(&first()), Outcome::Stored);
    let second = Package::series(SERIES, 2, "DOE^JANE", &[(I1, 2), (I3, 1)], 40);
    assert_eq!(site.receive(&second), Outcome::Stored);
    let uids: Vec<String> = site
        .rows()
        .into_iter()
        .filter(|r| r.0 == "instance")
        .map(|r| r.1)
        .collect();
    let mut want = vec![c(I1), c(I3)];
    want.sort();
    assert_eq!(uids, want);
    assert_eq!(fs::read(site.bundle_path(SERIES)).unwrap(), bundle(3, 40));
    let changes = site.audit().pop().unwrap().2;
    let hash = |bytes: &[u8]| format!("{:016x}", xxh3_64(bytes));
    let want = [
        format!("instance {} - {}", c(I3), hash(&instance_group(I3, 1))),
        format!("instance {} {} -", c(I2), hash(&instance_group(I2, 1))),
    ];
    assert_eq!(
        changes,
        want.join("\n"),
        "the audit lists exactly what changed"
    );
}

/// The same content refused a second time goes to quarantine and an operator: a bug, not the network.
#[test]
fn the_same_content_refused_twice_is_quarantined() {
    let site = Site::new("twice");
    let mut p = first();
    p.members.pop();
    refused(&site.receive(&p), "without its bundle");
    let name = site.arrive(&p);
    assert!(matches!(
        site.receiver().receive(&name).unwrap(),
        Outcome::Quarantined(_)
    ));
    assert!(Site::files(&site.incoming.join("refused")).is_empty());
    assert!(site.incoming.join("quarantine").join(&name).exists());
}

/// A restart removes every work directory and partial status, and takes the packages left at step 3.
#[test]
fn a_restart_removes_work_directories_and_takes_what_is_left() {
    let site = Site::new("restart");
    let name = site.arrive(&first());
    fs::create_dir_all(site.incoming.join(format!("{name}.work/study"))).unwrap();
    fs::create_dir_all(site.incoming.join("status")).unwrap();
    fs::write(site.incoming.join("status/x.partial"), b"st").unwrap();
    let receiver = site.receiver();
    assert_eq!(Site::files(&site.incoming), std::slice::from_ref(&name));
    assert_eq!(receiver.run().unwrap(), [(name, Outcome::Stored)]);
}

/// One receiver per `incoming/`: a second is refused while the first holds it.
#[test]
fn a_second_receiver_on_one_incoming_is_refused() {
    let site = Site::new("lock");
    let _first = site.receiver();
    let second = Receiver::open(&site.root, &site.incoming);
    assert!(format!("{:#}", second.err().unwrap()).contains("another receiver"));
}

/// The root and `incoming/` on two filesystems are refused at open, before any rename could fail.
#[test]
fn incoming_on_another_filesystem_is_refused() {
    let site = Site::new("exdev");
    let shm = Path::new("/dev/shm");
    use std::os::unix::fs::MetadataExt;
    if !shm.is_dir() || fs::metadata(shm).unwrap().dev() == fs::metadata(&site.root).unwrap().dev()
    {
        eprintln!("SKIPPED: the receiver's EXDEV check — no second filesystem at /dev/shm");
        return;
    }
    let incoming = shm.join(format!("receiver-exdev-{}", std::process::id()));
    let got = Receiver::open(&site.root, &incoming);
    let _ = fs::remove_dir_all(&incoming);
    assert!(format!("{:#}", got.err().unwrap()).contains("EXDEV"));
}

struct Told(Rc<RefCell<Vec<(&'static str, Stored)>>>);

impl Downstream for Told {
    fn derive(&self, stored: &Stored) {
        self.0.borrow_mut().push(("derive", stored.clone()));
    }
    fn index(&self, stored: &Stored) {
        self.0.borrow_mut().push(("index", stored.clone()));
    }
}

/// Steps 9 and 10 are told what was stored, derive first, and nothing of a refusal.
#[test]
fn derive_then_index_are_told_what_was_stored() {
    let site = Site::new("downstream");
    let told = Rc::new(RefCell::new(Vec::new()));
    let mut p = first();
    p.members.pop();
    let bad = site.arrive(&p);
    let good = site.arrive(&first());
    let receiver = site
        .receiver()
        .with_downstream(Box::new(Told(told.clone())));
    receiver.receive(&bad).unwrap();
    assert!(told.borrow().is_empty());
    receiver.receive(&good).unwrap();
    let told = told.borrow();
    assert_eq!(
        told.iter().map(|t| t.0).collect::<Vec<_>>(),
        ["derive", "index"]
    );
    let stored = &told[0].1;
    assert_eq!(
        (stored.kind, stored.bundle.as_deref()),
        (Kind::Series, Some(c(SERIES).as_str()))
    );
    assert_eq!(stored.groups[0], (Level::Exam, c(STUDY)));
    assert_eq!(stored.groups.len(), 4);
}
