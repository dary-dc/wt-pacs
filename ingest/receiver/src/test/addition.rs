use super::*;
use crate::Step;
use std::fs;

const I1: &str = "1.2.826.0.1.7.1.1";
const I2: &str = "1.2.826.0.1.7.1.2";
const I3: &str = "1.2.826.0.1.7.1.3";
/// Number 10: after 3 in display order, before 2 by its UID.
const I10: &str = "1.2.826.0.1.7.1.10";

/// Instances 1 and 3 stored; 2 is the late one.
fn stored(site: &Site) {
    let first = Package::series(SERIES, 1, "DOE^JANE", &[(I1, 2), (I3, 1)], 10);
    assert_eq!(site.receive(&first), Outcome::Stored);
}

fn refused(outcome: &Outcome, says: &str) {
    match outcome {
        Outcome::Refused(why) => assert!(why.contains(says), "refused for {why:?}, not {says:?}"),
        other => panic!("{other:?}, not refused for {says:?}"),
    }
}

fn digests(frames: &[Vec<u8>]) -> Vec<String> {
    frames
        .iter()
        .map(|f| format!("{:016x}", xxh3_64(f)))
        .collect()
}

/// An addition's frames go into the series' one bundle in display order, a late instance in the
/// middle and one at the end, the metadata's count, range and digests with them; its instance
/// groups are added beside the stored ones, and its audit row lists only them.
#[test]
fn an_addition_is_merged_into_the_series_bundle_in_display_order() {
    let site = Site::new("addition");
    stored(&site);
    let (old, middle, end) = (frames(3, 10), frames(2, 50), frames(1, 90));
    assert_eq!(
        site.receive(&Package::addition(SERIES, 2, &[(I2, 2)], 50)),
        Outcome::Stored
    );
    let want = [&old[..2], &middle, &old[2..]].concat();
    assert_eq!(read_bundle(&site.bundle_path(SERIES)).0, want);

    assert_eq!(
        site.receive(&Package::addition(SERIES, 3, &[(I10, 1)], 90)),
        Outcome::Stored
    );
    let want = [want, end].concat();
    let (served, metadata) = read_bundle(&site.bundle_path(SERIES));
    assert_eq!(served, want);
    assert_eq!(metadata["frameCount"], 6);
    assert_eq!(
        (metadata["min"].as_u64(), metadata["max"].as_u64()),
        (Some(10), Some(91))
    );
    assert_eq!(
        metadata["digests"]["frames"],
        serde_json::json!(digests(&want))
    );
    assert_eq!(metadata["codec"], "htj2k");

    let instances: Vec<String> = site
        .rows()
        .into_iter()
        .filter(|r| r.0 == "instance")
        .map(|r| r.1)
        .collect();
    let mut all = vec![c(I1), c(I2), c(I3), c(I10)];
    assert!(
        c(I10) < c(I2),
        "the test needs UID order to differ from display order"
    );
    all.sort();
    assert_eq!(instances, all);
    let (unit, revision, changes) = site.audit().pop().unwrap();
    assert_eq!((unit, revision), (c(SERIES), 3));
    let hash = format!("{:016x}", xxh3_64(&instance_group(I10, 1)));
    assert_eq!(changes, format!("instance {} - {hash}", c(I10)));
}

/// The stored addition sent again is stored again, and the bundle keeps each frame once.
#[test]
fn an_addition_sent_again_merges_nothing_twice() {
    let site = Site::new("addition-again");
    stored(&site);
    let addition = Package::addition(SERIES, 2, &[(I2, 2)], 50);
    assert_eq!(site.receive(&addition), Outcome::Stored);
    let (bundle, rows) = (fs::read(site.bundle_path(SERIES)).unwrap(), site.rows());
    assert_eq!(site.receive(&addition), Outcome::Stored);
    assert_eq!(fs::read(site.bundle_path(SERIES)).unwrap(), bundle);
    assert_eq!((site.rows(), site.audit().len()), (rows, 2));
}

/// An addition is refused, the series untouched, when its study or series is not stored, its exam
/// or series group is not the stored one, an instance is already stored, its bundle's frames are
/// not its instances', its bundle's frame attributes differ from the series', or the served bundle
/// does not hold its rows' frames.
#[test]
fn an_addition_that_does_not_fit_its_series_is_refused() {
    let site = Site::new("addition-refused");
    refused(
        &site.receive(&Package::addition(SERIES, 2, &[(I2, 1)], 50)),
        "addition to study",
    );
    stored(&site);
    let (served, rows) = (fs::read(site.bundle_path(SERIES)).unwrap(), site.rows());

    let mut other_patient = Package::series(SERIES, 2, "ROE^JOHN", &[(I2, 1)], 50);
    other_patient.header = other_patient.header.replace("kind series", "kind addition");
    let mut other_series = Package::addition(SERIES, 2, &[(I2, 1)], 50);
    other_series.members.remove(1);
    other_series.group(
        format!("{}/---", c(SERIES)),
        series_group(SERIES, "coronal"),
    );
    let mut short_bundle = Package::addition(SERIES, 2, &[(I2, 2)], 50);
    short_bundle.members.last_mut().unwrap().1 = bundle(1, 50);
    let mut other_codec = Package::addition(SERIES, 2, &[(I2, 1)], 50);
    other_codec.members.last_mut().unwrap().1 =
        bundle_with(1, 50, r#"{"frameCount": 1, "codec": "av1"}"#);
    for (package, says) in [
        (
            Package::addition(SERIES_B, 1, &[(I2, 1)], 50),
            "an addition to series",
        ),
        (other_patient, "exam group is not the stored one"),
        (other_series, "series group is not the stored one"),
        (
            Package::addition(SERIES, 2, &[(I1, 2)], 50),
            "is already stored",
        ),
        (short_bundle, "hold 2 frames, the bundle 1"),
        (other_codec, "the addition's codec"),
    ] {
        refused(&site.receive(&package), says);
        assert_eq!(fs::read(site.bundle_path(SERIES)).unwrap(), served);
        assert_eq!((site.rows(), site.audit().len()), (rows.clone(), 1));
    }
    fs::write(site.bundle_path(SERIES), bundle(5, 10)).unwrap();
    refused(
        &site.receive(&Package::addition(SERIES, 2, &[(I2, 1)], 60)),
        "the served bundle holds 5 frames",
    );
}

/// The merged bundle is read back from the device, not from the page cache its write left it in:
/// between staged and read back, the device serves at least its every byte.
#[test]
fn the_merged_bundle_is_read_back_from_the_device() {
    let site = Site::new("addition-device");
    let first = Package::series(SERIES, 1, "DOE^JANE", &[(I1, 2000), (I3, 1)], 10);
    assert_eq!(site.receive(&first), Outcome::Stored);
    let name = site.arrive(&Package::addition(SERIES, 2, &[(I2, 1)], 50));
    let (mut at_staged, mut read) = (0, 0);
    let outcome = site.receiver().receive_at(&name, &mut |s| {
        if s == Step::Staged {
            at_staged = device_reads();
        } else if s == Step::ReadBack {
            read = device_reads() - at_staged;
        }
    });
    assert_eq!(outcome.unwrap(), Outcome::Stored);
    let merged = fs::metadata(site.bundle_path(SERIES)).unwrap().len();
    assert!(
        read >= merged,
        "the device served {read} of {merged} merged bytes"
    );
}
