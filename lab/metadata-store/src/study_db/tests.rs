use super::{build, check, correct, full, paint, shared, state, unpack, Layout, Scope, PATIENT_NAME, SLICE_THICKNESS};
use crate::group::{self, Record, IMAGE_POSITION};
use crate::pair;
use rusqlite::Connection;

fn key(group: u16, element: u16, vr: &[u8; 2]) -> Vec<u8> {
    [&group.to_be_bytes()[..], &element.to_be_bytes(), vr, &[0, 0]].concat()
}

fn rec(group: u16, element: u16, vr: &[u8; 2], value: &[u8]) -> Record {
    Record { key: key(group, element, vr), value: value.to_vec() }
}

fn instance(n: u8) -> (Vec<Record>, Vec<Record>) {
    let uid = format!("1.2.3.{n}\0").into_bytes();
    let group = vec![
        rec(0x0002, 0x0003, b"UI", &uid),
        rec(0x0008, 0x0008, b"CS", b"ORIGINAL\\PRIMARY"),
        rec(0x0008, 0x0016, b"UI", b"1.2.840.10008.5.1.4.1.1.2\0"),
        rec(0x0008, 0x0018, b"UI", &uid),
        rec(0x0008, 0x0022, b"DA", b"20260101"),
        rec(0x0008, 0x0032, b"TM", format!("1200{n:02}").as_bytes()),
        rec(0x0018, 0x0050, b"DS", b"5 "),
        rec(0x0018, 0x0060, b"DS", b"120 "),
        rec(0x0020, 0x0012, b"IS", b"1 "),
        rec(0x0020, 0x0013, b"IS", format!("{n} ").as_bytes()),
        rec(0x0020, 0x0032, b"DS", format!("0\\0\\{n}0").as_bytes()),
        rec(0x0028, 0x0004, b"CS", b"MONOCHROME2 "),
        rec(0x0028, 0x0030, b"DS", b"0.7\\0.7 "),
        rec(0x0028, 0x1050, b"DS", b"40"),
        rec(0x0028, 0x1051, b"DS", b"400 "),
        rec(0x0028, 0x1052, b"DS", b"-1024 "),
        rec(0x0028, 0x1053, b"DS", b"1 "),
    ];
    (group, vec![rec(0x0009, 0x0010, b"LO", b"VENDOR")])
}

/// A CT series of `n` instances packaged as the parser's tree, sorted by path as the package script writes it.
fn package(n: u8) -> Vec<u8> {
    let mut files = vec![
        ("D/E/--.0".to_string(), group::write(&[rec(0x0010, 0x0010, b"PN", b"DOE^J ")])),
        ("D/E/S/---.0".to_string(), group::write(&[rec(0x0008, 0x0060, b"CS", b"CT")])),
    ];
    for i in 1..=n {
        let (g, p) = instance(i);
        files.push((format!("D/E/S/I{i:02}/----.0"), group::write(&g)));
        files.push((format!("D/E/S/I{i:02}/priv.0"), group::write(&p)));
    }
    files.sort();
    let mut tar = tar::Builder::new(Vec::new());
    for (path, bytes) in files {
        let mut header = tar::Header::new_ustar();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, path, bytes.as_slice()).unwrap();
    }
    tar.into_inner().unwrap()
}

fn store(layout: Layout, tag: &str, n: u8) -> (std::path::PathBuf, Connection) {
    let dir = std::env::temp_dir().join(format!("study-db-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("{layout:?}.db"));
    let db = build(layout, &path, &package(n)).unwrap();
    (path, db)
}

fn has(records: &[Record], key: &[u8], value: &[u8]) -> bool {
    records.iter().any(|r| r.key == key && r.value == value)
}

fn item(tag: [u8; 4], number: u32) -> Vec<u8> {
    [&tag[..], &number.to_be_bytes()].concat()
}

const SHARED: [u8; 4] = [0x52, 0x00, 0x92, 0x29];
const PER_FRAME: [u8; 4] = [0x52, 0x00, 0x92, 0x30];
const PIXEL_MEASURES: [u8; 4] = [0x00, 0x28, 0x91, 0x10];
const PLANE_POSITION: [u8; 4] = [0x00, 0x20, 0x91, 0x13];

/// A functional group the same in every instance is in the Shared item once; one that varies is in every frame's
/// item; an attribute the same everywhere goes in Unassigned Shared, and a top-level one that varies stays at the top
/// with every frame's value in Unassigned Per-Frame.
#[test]
fn the_conversion_places_shared_and_varying_attributes_as_the_standard_does() {
    let ce = shared::converted(&unpack(&package(3)).unwrap()).unwrap();
    let thickness = [item(SHARED, 1), item(PIXEL_MEASURES, 1), key(0x0018, 0x0050, b"DS")].concat();
    assert!(has(&ce, &thickness, b"5 "));
    assert_eq!(ce.iter().filter(|r| r.key.ends_with(&key(0x0018, 0x0050, b"DS"))).count(), 1);
    for n in 1..=3u8 {
        let position = [item(PER_FRAME, n as u32), item(PLANE_POSITION, 1), key(0x0020, 0x0032, b"DS")].concat();
        assert!(has(&ce, &position, format!("0\\0\\{n}0").as_bytes()));
        let number = [item(PER_FRAME, n as u32), item([0x00, 0x20, 0x91, 0x71], 1), key(0x0020, 0x0013, b"IS")].concat();
        assert!(has(&ce, &number, format!("{n} ").as_bytes()));
    }
    let kvp = [item(SHARED, 1), item([0x00, 0x20, 0x91, 0x70], 1), key(0x0018, 0x0060, b"DS")].concat();
    assert!(has(&ce, &kvp, b"120 "));
    assert!(has(&ce, &key(0x0020, 0x0013, b"IS"), b"1 "));
    assert!(has(&ce, &key(0x0028, 0x0008, b"IS"), b"3 "));
}

/// Every layout hands back the same paint values, and the row and blob layouts every received record.
#[test]
fn every_layout_paints_the_same_and_keeps_what_was_received() {
    let p = unpack(&package(5)).unwrap();
    let received: Vec<Vec<Record>> = p
        .instances
        .iter()
        .map(|i| [group::parse(&i.group).unwrap(), group::parse(&i.private).unwrap()].concat())
        .collect();
    let truth = paint(Layout::Rows, &store(Layout::Rows, "paint", 5).1, &p.series_uid).unwrap();
    assert_eq!(truth.len(), 5);
    assert_eq!(truth[2][0].as_deref(), Some(&b"3 "[..]));
    for layout in [Layout::Shared, Layout::Blob] {
        let (_, db) = store(layout, "paint", 5);
        assert_eq!(paint(layout, &db, &p.series_uid).unwrap(), truth, "{layout:?}");
    }
    for layout in [Layout::Rows, Layout::Blob] {
        let (_, db) = store(layout, "full", 5);
        assert_eq!(full(layout, &db, &p.series_uid).unwrap().instances, received, "{layout:?}");
    }
}

fn frame_has(db: &Connection, uid: &str, key: &[u8], value: &[u8]) -> bool {
    let bytes: Vec<u8> = db.query_row("SELECT bytes FROM frame WHERE uid = ?1", [uid], |r| r.get(0)).unwrap();
    has(&group::parse(&bytes).unwrap(), key, value)
}

/// A shared attribute corrected in one frame leaves the shared row for every frame, the others keeping the old
/// value; corrected back in every frame it rejoins the shared row and the store is as built.
#[test]
fn a_shared_attribute_set_in_one_frame_splits_and_set_in_all_joins_again() {
    let (_, mut db) = store(Layout::Shared, "split", 4);
    let built = state(Layout::Shared, &db).unwrap();
    let change = correct(Layout::Shared, &mut db, "S", Scope::Instance("I02"), SLICE_THICKNESS, b"9.75").unwrap();
    assert_eq!((change.rows, change.shared), (5, Some(false)));
    let thickness = |n: u32| [item(PER_FRAME, n), item(PIXEL_MEASURES, 1), key(0x0018, 0x0050, b"DS")].concat();
    assert!(frame_has(&db, "I02", &thickness(2), b"9.75"));
    assert!(frame_has(&db, "I03", &thickness(3), b"5 "));
    let change = correct(Layout::Shared, &mut db, "S", Scope::Series, SLICE_THICKNESS, b"5 ").unwrap();
    assert_eq!((change.rows, change.shared), (5, Some(true)));
    assert_eq!(state(Layout::Shared, &db).unwrap(), built);
}

/// A correction of a shared attribute in every instance stays shared and writes one row; the row layout writes one
/// per instance, the blob one; every instance reads the new value.
#[test]
fn a_series_correction_of_a_shared_attribute_writes_one_shared_row() {
    for (layout, rows, shared) in [(Layout::Shared, 1, Some(true)), (Layout::Rows, 6, None), (Layout::Blob, 1, None)] {
        let (_, mut db) = store(layout, "series", 6);
        let change = correct(layout, &mut db, "S", Scope::Series, SLICE_THICKNESS, b"9.75").unwrap();
        assert_eq!((change.rows, change.shared), (rows, shared), "{layout:?}");
        let f = full(layout, &db, "S").unwrap();
        for own in &f.instances {
            let thickness = own.iter().chain(&f.shared).filter(|r| r.key.ends_with(&key(0x0018, 0x0050, b"DS")));
            assert_eq!(thickness.map(|r| r.value.as_slice()).collect::<Vec<_>>(), [b"9.75"], "{layout:?}");
        }
    }
}

/// Corrections of a frame's own attribute and of the exam group write one row each, and every layout reads them.
#[test]
fn an_instance_and_an_exam_correction_reach_every_layout() {
    for layout in [Layout::Rows, Layout::Shared, Layout::Blob] {
        let (_, mut db) = store(layout, "instance", 4);
        let change = correct(layout, &mut db, "S", Scope::Instance("I03"), IMAGE_POSITION, b"0\\0\\0 ").unwrap();
        assert_eq!(change.rows, 1, "{layout:?}");
        correct(layout, &mut db, "S", Scope::Exam, PATIENT_NAME, b"ROE^J ").unwrap();
        let f = full(layout, &db, "S").unwrap();
        assert!(has(&f.exam, &key(0x0010, 0x0010, b"PN"), b"ROE^J "), "{layout:?}");
        let third = f.instances[2].iter().chain(&f.shared);
        assert!(third.clone().any(|r| r.key.ends_with(&key(0x0020, 0x0032, b"DS")) && r.value == b"0\\0\\0 "));
        let audits: i64 = db.query_row("SELECT count(*) FROM audit", [], |r| r.get(0)).unwrap();
        assert_eq!(audits, 2);
    }
}

/// The integrity check finds one changed byte in any layout's rows.
#[test]
fn the_integrity_check_finds_a_changed_byte() {
    for (layout, table) in [(Layout::Rows, "instance"), (Layout::Shared, "frame"), (Layout::Shared, "shared"), (Layout::Blob, "blob")] {
        let (path, db) = store(layout, "check", 3);
        assert_eq!(check(layout, &pair::open(&path).unwrap()).unwrap(), 2 + layout_rows(layout));
        let bytes: Vec<u8> = db.query_row(&format!("SELECT bytes FROM {table} LIMIT 1"), [], |r| r.get(0)).unwrap();
        let mut changed = bytes.clone();
        *changed.last_mut().unwrap() ^= 1;
        db.execute(&format!("UPDATE {table} SET bytes = ?1 WHERE rowid = (SELECT min(rowid) FROM {table})"), [changed])
            .unwrap();
        assert!(check(layout, &db).is_err(), "{layout:?} {table}");
    }
}

fn layout_rows(layout: Layout) -> usize {
    match layout {
        Layout::Rows => 6,
        Layout::Shared => 4,
        Layout::Blob => 1,
    }
}
