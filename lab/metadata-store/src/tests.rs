use crate::group::{self, Record};
use crate::pair;
use crate::stores::{self, KeyFile, Paths};

fn fixture(name: &str) -> Vec<Record> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name);
    group::parse(&std::fs::read(path).unwrap()).unwrap()
}

fn built(n: u16, tag: &str) -> (Paths, Vec<Vec<Record>>) {
    let dir = std::env::temp_dir().join(format!("metadata-store-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let paths = Paths::under(&dir);
    let instances = group::synthetic_series(&fixture("ct1-instance.grp"), n);
    stores::build(&paths, &fixture("ct1-series.grp"), &instances).unwrap();
    (paths, instances)
}

/// A group parsed and written again is the same bytes, so a group rebuilt from records hashes as the parser's did.
#[test]
fn a_group_round_trips_byte_for_byte() {
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/ct1-instance.grp"),
    )
    .unwrap();
    assert_eq!(group::write(&group::parse(&bytes).unwrap()), bytes);
}

/// Every store and every read hands the page the same values, in instance order.
#[test]
fn every_store_reads_the_same_page() {
    let (paths, instances) = built(7, "same");
    let truth: Vec<_> = instances
        .iter()
        .map(|r| group::page_values(r.iter().map(|r| (r.tag(), r.value.clone()))))
        .collect();
    let numbers: Vec<_> = truth
        .iter()
        .map(|v| String::from_utf8(v[0].clone().unwrap()).unwrap())
        .collect();
    assert_eq!(numbers, ["1 ", "2 ", "3 ", "4 ", "5 ", "6 ", "7 "]);
    let (columns, rows) = (
        stores::open(&paths.columns).unwrap(),
        stores::open(&paths.rows).unwrap(),
    );
    let keys = KeyFile::open(&paths.keys, &paths.values).unwrap();
    assert_eq!(stores::read_files(&paths.files).unwrap(), truth, "A");
    assert_eq!(stores::read_columns(&columns).unwrap(), truth, "B");
    assert_eq!(stores::read_rows_scan(&rows).unwrap(), truth, "C scan");
    assert_eq!(stores::read_rows_seek(&rows).unwrap(), truth, "C seek");
    assert_eq!(stores::read_rows_filter(&rows).unwrap(), truth, "C filter");
    assert_eq!(keys.read_scan(), truth, "D scan");
    assert_eq!(keys.read_seek(), truth, "D seek");
}

/// One row per attribute keeps the parser's group: its rows, in key order, are the group's bytes.
#[test]
fn rows_give_each_group_back() {
    let (paths, instances) = built(3, "back");
    let rows = stores::open(&paths.rows).unwrap();
    for (i, records) in instances.iter().enumerate() {
        assert_eq!(
            stores::group_from_rows(&rows, i as u16 + 1).unwrap(),
            group::write(records)
        );
    }
}

fn pair_built(truth: pair::Truth, n: u16, tag: &str) -> (rusqlite::Connection, Vec<Vec<Record>>) {
    let dir = std::env::temp_dir().join(format!("metadata-pair-{tag}-{truth:?}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let instances = group::synthetic_series(&fixture("ct1-instance.grp"), n);
    let db = pair::build(truth, &dir.join("store.db"), &fixture("ct1-series.grp"), &instances).unwrap();
    (db, instances)
}

fn page_of(instances: &[Vec<Record>]) -> Vec<group::PageValues> {
    instances
        .iter()
        .map(|r| group::page_values(r.iter().map(|r| (r.tag(), r.value.clone()))))
        .collect()
}

/// Under either truth, the series' page row is the document built from the groups' own values.
#[test]
fn the_page_row_is_the_document() {
    for truth in [pair::Truth::Groups, pair::Truth::Attributes] {
        let (db, instances) = pair_built(truth, 7, "doc");
        assert_eq!(pair::read_page(&db).unwrap(), pair::document(&page_of(&instances)), "{truth:?}");
    }
}

/// An update changes that instance's value in the page row and nothing else, and every received group's BLAKE3 still holds.
#[test]
fn an_update_changes_one_value_and_keeps_the_received_hashes() {
    for truth in [pair::Truth::Groups, pair::Truth::Attributes] {
        let (mut db, instances) = pair_built(truth, 7, "update");
        pair::update(truth, &mut db, 3, b"-1000 ").unwrap();
        pair::update(truth, &mut db, 3, b"-1012 ").unwrap();
        let mut want = page_of(&instances);
        want[2][4] = Some(b"-1012 ".to_vec());
        assert_eq!(pair::read_page(&db).unwrap(), pair::document(&want), "{truth:?}");
        assert_eq!(pair::rebuild(truth, &db).unwrap(), want, "{truth:?}");
        assert_eq!(pair::check_received(truth, &db).unwrap(), 8, "{truth:?}");
    }
}

/// One changed byte in a received group fails its BLAKE3 check, under either truth.
#[test]
fn a_changed_byte_fails_the_received_check() {
    let (db, _) = pair_built(pair::Truth::Groups, 3, "tamper");
    db.execute("UPDATE grp SET bytes = CAST(replace(CAST(bytes AS TEXT), 'MONOCHROME2', 'MONOCHROME1') AS BLOB) WHERE instance = 2", []).unwrap();
    assert!(pair::check_received(pair::Truth::Groups, &db).is_err());
    let (db, _) = pair_built(pair::Truth::Attributes, 3, "tamper");
    db.execute("UPDATE kv SET value = CAST('MONOCHROME1 ' AS BLOB) WHERE CAST(value AS TEXT) = 'MONOCHROME2 ' AND substr(key, 6, 1) = x'02'", []).unwrap();
    assert!(pair::check_received(pair::Truth::Attributes, &db).is_err());
}
