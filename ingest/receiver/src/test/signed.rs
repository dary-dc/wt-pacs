//! docs/av1/payload-format.md §Is the split safe? §5 case 1 (P4) through the receiver: signed
//! 16-bit sources whose range after the offset is 8 bits, at split 0 and 1. The receiver never
//! types a sample; these tests hold that it carries the payload headers and the range unchanged.

use super::*;
use crate::Outcome;
use xxhash_rust::xxh3::xxh3_64;

const I1: &str = "1.2.826.0.1.7.1.1";
const I2: &str = "1.2.826.0.1.7.1.2";
const I3: &str = "1.2.826.0.1.7.1.3";

/// −10…200, 0…200 and −200…0 wrapped in Int8 before P4's fix; −128…127 is the control.
const SOURCES: [(i32, i32); 4] = [(-10, 200), (0, 200), (-200, 0), (-128, 127)];

/// The samples of one frame: its source's whole range, each value once.
fn samples(min: i32, max: i32) -> Vec<i32> {
    (min..=max).collect()
}

/// `av1-frame.js`'s and `ingest.py`'s rule: two bytes a sample unless the range fits Int8.
fn wide(bits: u32, offset: i32) -> bool {
    bits > 8 || !(offset <= 128 && (1 << bits) - 1 - offset <= 127)
}

/// One frame as `ingest.py` writes it (header, one length, a stand-in unit) and its digest.
fn frame(min: i32, max: i32, split: u8) -> (Vec<u8>, String) {
    let offset = if min < 0 { -min } else { 0 };
    let bits = 32 - ((max + offset) as u32).leading_zeros();
    let depth = match bits - u32::from(split) {
        ..=8 => 8u8,
        9..=10 => 10,
        _ => 12,
    };
    let values = samples(min, max);
    let unit: Vec<u8> = values
        .iter()
        .flat_map(|&v| ((v + offset) as u16).to_le_bytes())
        .collect();
    let mut payload = vec![1, bits as u8, depth, split, 1, 0, 0, 0];
    payload.extend((offset as u32).to_le_bytes());
    payload.extend(1u32.to_le_bytes());
    payload.extend((unit.len() as u32).to_le_bytes());
    payload.extend(unit);
    let digested: Vec<u8> = match wide(bits, offset) {
        true => values
            .iter()
            .flat_map(|&v| (v as i16).to_le_bytes())
            .collect(),
        false => values.iter().map(|&v| v as i8 as u8).collect(),
    };
    (payload, format!("{:016x}", xxh3_64(&digested)))
}

/// A signed 16-bit AV1 series of `n` frames of one source, its metadata as the ingest writes it.
fn signed_bundle(
    n: u32,
    (min, max): (i32, i32),
    split: u8,
) -> (Vec<u8>, Vec<Vec<u8>>, Vec<String>) {
    let (payload, digest) = frame(min, max, split);
    let (payloads, digests) = (vec![payload; n as usize], vec![digest; n as usize]);
    let metadata = serde_json::json!({
        "frameCount": n, "codec": "av1", "bitsStored": 16, "signed": true, "min": min, "max": max,
        "digests": { "algorithm": "xxh3-64", "frames": digests },
    });
    let dir = scratch("signed-bundle");
    let path = dir.join("b.sbnd");
    let refs: Vec<&[u8]> = payloads.iter().map(|p| p.as_slice()).collect();
    series_bundle::write_bundle(&path, metadata.to_string().as_bytes(), &refs).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    std::fs::remove_dir_all(dir).unwrap();
    (bytes, payloads, digests)
}

fn with_bundle(mut p: Package, bytes: Vec<u8>) -> Package {
    p.members.retain(|m| !m.0.ends_with(".sbnd"));
    p.members
        .push((format!("{}/series.sbnd", c(SERIES)), bytes));
    p
}

/// Each of case 1's sources at split 0 and 1 is stored with its frames byte for byte, its range
/// signed and unchanged, and its digests in order.
#[test]
fn signed_sources_are_served_as_sent() {
    for source in SOURCES {
        for split in [0, 1] {
            let site = Site::new("signed");
            let (bytes, payloads, digests) = signed_bundle(2, source, split);
            let p = with_bundle(Package::series(SERIES, 1, "DOE^JANE", &[(I1, 2)], 0), bytes);
            assert_eq!(
                site.receive(&p),
                Outcome::Stored,
                "{source:?} split {split}"
            );
            let (frames, meta) = read_bundle(&site.bundle_path(SERIES));
            assert_eq!(frames, payloads, "{source:?} split {split}");
            assert_eq!(
                (meta["min"].as_i64(), meta["max"].as_i64()),
                (Some(source.0.into()), Some(source.1.into()))
            );
            assert_eq!(meta["digests"]["frames"], serde_json::json!(digests));
        }
    }
}

/// An addition coded with another offset than its series keeps each frame's own header, and the
/// merged range is the signed union: the control's −128 and the addition's 200.
#[test]
fn an_addition_with_another_offset_merges_to_the_signed_union() {
    let site = Site::new("signed-addition");
    let instances = [(I1, 1), (I3, 1)];
    let (bytes, served, served_digests) = signed_bundle(2, (-128, 127), 0);
    let series = with_bundle(Package::series(SERIES, 1, "DOE^JANE", &instances, 0), bytes);
    assert_eq!(site.receive(&series), Outcome::Stored);

    let (bytes, added, added_digests) = signed_bundle(1, (-10, 200), 0);
    let addition = with_bundle(Package::addition(SERIES, 2, &[(I2, 1)], 0), bytes);
    assert_eq!(site.receive(&addition), Outcome::Stored);

    let (frames, meta) = read_bundle(&site.bundle_path(SERIES));
    assert_eq!(
        frames,
        vec![served[0].clone(), added[0].clone(), served[1].clone()]
    );
    assert_eq!(
        (meta["min"].as_i64(), meta["max"].as_i64()),
        (Some(-128), Some(200))
    );
    let digests = vec![&served_digests[0], &added_digests[0], &served_digests[1]];
    assert_eq!(meta["digests"]["frames"], serde_json::json!(digests));
}
