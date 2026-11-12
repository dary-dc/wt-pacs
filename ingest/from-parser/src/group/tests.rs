use super::*;

fn record(key: &[u8], value: &[u8]) -> Vec<u8> {
    let mut r = vec![key.len() as u8];
    r.extend_from_slice(key);
    r.extend_from_slice(&(value.len() as u32).to_le_bytes());
    r.extend_from_slice(value);
    r
}

/// A top-level key's tag is read big-endian and its value little-endian; a nested item's record is skipped.
#[test]
fn reads_top_level_records_and_skips_nested_ones() {
    let mut file = record(b"\x00\x28\x00\x10US\x00\x00", &512u16.to_le_bytes());
    file.extend(record(&[0u8; 16], b"nested"));
    file.extend(record(b"\x00\x28\x00\x04CS\x00\x00", b"RGB "));
    let r = records(&file).unwrap();
    assert_eq!(us(&r, (0x0028, 0x0010)).unwrap(), 512);
    assert_eq!(text(&r, (0x0028, 0x0004)).as_deref(), Some("RGB"));
    assert_eq!(r.len(), 2);
}

/// A value whose length runs past the end of the file is refused, not read short.
#[test]
fn refuses_a_truncated_value() {
    let mut file = record(b"\x00\x28\x00\x10US\x00\x00", &512u16.to_le_bytes());
    file.pop();
    assert!(records(&file).is_err());
}
