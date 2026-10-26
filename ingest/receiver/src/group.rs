//! A group file and a coded UID, as the parser writes them: docs/ingest/contract.md.

use anyhow::{bail, ensure, Context, Result};

pub const STUDY_UID: u32 = 0x0020_000D;
pub const SERIES_UID: u32 = 0x0020_000E;
pub const SOP_INSTANCE_UID: u32 = 0x0008_0018;
const NUMBER_OF_FRAMES: u32 = 0x0028_0008;
const INSTANCE_NUMBER: u32 = 0x0020_0013;

/// Bytes of a top-level key: tag (4), VR (2), charset index (2); each sequence level adds 8.
const TOP_LEVEL_KEY: usize = 8;

const ALPHABET: &[u8; 64] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";

/// A top-level attribute's value; every record is walked, so a cut group is refused whatever it holds.
pub fn value(group: &[u8], tag: u32) -> Result<Option<&[u8]>> {
    let mut found = None;
    let mut rest = group;
    while let Some((&key_len, after)) = rest.split_first() {
        let key_len = key_len as usize;
        ensure!(
            key_len >= TOP_LEVEL_KEY && key_len.is_multiple_of(TOP_LEVEL_KEY),
            "a record's key is {key_len} bytes"
        );
        ensure!(after.len() >= key_len + 4, "a record is cut short");
        let (key, after) = after.split_at(key_len);
        let (value_len, body) = after.split_at(4);
        let value_len = u32::from_le_bytes(value_len.try_into()?) as usize;
        ensure!(body.len() >= value_len, "a record's value is cut short");
        if key_len == TOP_LEVEL_KEY && u32::from_be_bytes(key[..4].try_into()?) == tag {
            found.get_or_insert(&body[..value_len]);
        }
        rest = &body[value_len..];
    }
    Ok(found)
}

/// Absent or 0 is one frame, as the parser writes it.
pub fn number_of_frames(instance_group: &[u8]) -> Result<u32> {
    let Some(raw) = value(instance_group, NUMBER_OF_FRAMES)? else {
        return Ok(1);
    };
    Ok(integer_string::<u32>(raw, "Number of Frames")?.max(1))
}

pub fn instance_number(instance_group: &[u8]) -> Result<Option<i64>> {
    value(instance_group, INSTANCE_NUMBER)?
        .map(|raw| integer_string(raw, "Instance Number"))
        .transpose()
}

/// An IS value, its padding not part of the number.
fn integer_string<T: std::str::FromStr>(raw: &[u8], name: &str) -> Result<T>
where
    T::Err: std::error::Error + Send + Sync + 'static,
{
    let text = std::str::from_utf8(raw)
        .with_context(|| format!("{name} is not text"))?
        .trim_matches([' ', '\0']);
    text.parse().with_context(|| format!("{name} {text:?}"))
}

pub fn coded(uid: &[u8]) -> Result<String> {
    let nibbles = uid
        .iter()
        .map(|&c| nibble(c))
        .collect::<Result<Vec<usize>>>()?;
    let mut out = String::with_capacity(nibbles.len().div_ceil(3) * 2);
    for chunk in nibbles.chunks(3) {
        let (high, low) = match *chunk {
            [a, b, c] => {
                let v = a << 8 | b << 4 | c;
                (v >> 6, v & 63)
            }
            [a, b] => ((a << 2) + (b >> 2), (b & 3) << 4),
            [a] => (a << 2, 0),
            _ => unreachable!("chunks(3) yields one to three"),
        };
        out.push(ALPHABET[high] as char);
        out.push(ALPHABET[low] as char);
    }
    Ok(out)
}

fn nibble(c: u8) -> Result<usize> {
    Ok(match c {
        0 => 0,
        b'\\' => 1,
        b'^' => 2,
        b'-' => 3,
        b'+' => 4,
        b'.' => 5,
        b'0'..=b'9' => 6 + (c - b'0') as usize,
        _ => bail!("{:?} cannot be coded", c as char),
    })
}

/// What a coded UID can be: pairs of the alphabet, so never `.`, `/` or empty.
pub fn is_coded(name: &str) -> bool {
    !name.is_empty() && name.len().is_multiple_of(2) && name.bytes().all(|c| ALPHABET.contains(&c))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::record;

    /// The contract's example and each remainder: three characters make two, one and two left over
    /// are coded by their own rules, and the UI pad is coded with the UID.
    #[test]
    fn a_uid_codes_as_the_contract_writes_it() {
        assert_eq!(coded(b"1.2.3\0").unwrap(), "TOMG");
        assert_eq!(coded(b"1.2.3").unwrap(), "TOMG");
        assert_eq!(coded(b"1.2.34").unwrap(), "TOMQ");
        assert_eq!(coded(b"1.2.3.4").unwrap(), "TOMLd0");
        assert!(coded(b"1.a").is_err(), "a letter was coded");
        assert!(is_coded("TOMG") && !is_coded("TOM") && !is_coded("..") && !is_coded(""));
    }

    /// A top-level value is found past a nested record, and a nested record with the same tag is
    /// not taken for it.
    #[test]
    fn a_value_is_read_at_the_top_level_only() {
        let mut nested = vec![16u8];
        nested.extend_from_slice(&0x0028_0008u32.to_be_bytes());
        nested.extend_from_slice(b"IS\0\0");
        nested.extend_from_slice(&[0; 8]);
        nested.extend_from_slice(&2u32.to_le_bytes());
        nested.extend_from_slice(b"9 ");
        let mut group = nested;
        group.extend(record(NUMBER_OF_FRAMES, b"IS", b"12"));
        assert_eq!(number_of_frames(&group).unwrap(), 12);
        assert_eq!(value(&group, STUDY_UID).unwrap(), None);
    }

    /// Absent and zero both mean one frame; padding is not part of the number.
    #[test]
    fn number_of_frames_absent_or_zero_is_one() {
        assert_eq!(number_of_frames(&[]).unwrap(), 1);
        assert_eq!(
            number_of_frames(&record(NUMBER_OF_FRAMES, b"IS", b"0 ")).unwrap(),
            1
        );
        assert_eq!(
            number_of_frames(&record(NUMBER_OF_FRAMES, b"IS", b"40")).unwrap(),
            40
        );
        assert!(number_of_frames(&record(NUMBER_OF_FRAMES, b"IS", b"x")).is_err());
    }

    /// A group cut anywhere inside a record is refused, not read short, and so is a key that is
    /// not a whole number of 8-byte levels.
    #[test]
    fn a_cut_group_is_refused() {
        let group = record(SOP_INSTANCE_UID, b"UI", b"1.2.3\0");
        for cut in 1..group.len() {
            assert!(
                value(&group[..cut], SOP_INSTANCE_UID).is_err(),
                "cut at {cut} was read"
            );
        }
        let nine = [&[9u8][..], &[0; 9], &0u32.to_le_bytes()].concat();
        assert!(
            value(&nine, SOP_INSTANCE_UID).is_err(),
            "a 9-byte key was read"
        );
    }
}
