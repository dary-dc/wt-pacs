//! A parser group file read back: docs/ingest/contract.md §Group files.

use anyhow::{bail, ensure, Context, Result};
use std::collections::HashMap;

/// (group, element) → the value as written; nested items (keys over 8 bytes) are skipped.
pub fn records(bytes: &[u8]) -> Result<HashMap<(u16, u16), Vec<u8>>> {
    let mut out = HashMap::new();
    let mut at = 0;
    while at < bytes.len() {
        let key_len = bytes[at] as usize;
        let value_at = at + 1 + key_len + 4;
        ensure!(value_at <= bytes.len(), "a record at byte {at} runs past the file");
        let key = &bytes[at + 1..at + 1 + key_len];
        let value_len = u32::from_le_bytes(bytes[value_at - 4..value_at].try_into()?) as usize;
        let end = value_at.checked_add(value_len).filter(|&e| e <= bytes.len());
        let end = end.with_context(|| format!("the value at byte {value_at} runs past the file"))?;
        if key_len == 8 {
            let tag = (u16::from_be_bytes([key[0], key[1]]), u16::from_be_bytes([key[2], key[3]]));
            out.insert(tag, bytes[value_at..end].to_vec());
        } else if key_len == 0 || key_len % 8 != 0 {
            bail!("a key of {key_len} bytes at byte {at}");
        }
        at = end;
    }
    Ok(out)
}

pub fn us(records: &HashMap<(u16, u16), Vec<u8>>, tag: (u16, u16)) -> Result<u16> {
    let v = records.get(&tag).with_context(|| format!("no ({:04X},{:04X})", tag.0, tag.1))?;
    let v: [u8; 2] = v.as_slice().try_into().with_context(|| format!("({:04X},{:04X}) is not one US", tag.0, tag.1))?;
    Ok(u16::from_le_bytes(v))
}

/// A string value without its padding (trailing spaces and NULs).
pub fn text(records: &HashMap<(u16, u16), Vec<u8>>, tag: (u16, u16)) -> Option<String> {
    let v = records.get(&tag)?;
    Some(String::from_utf8_lossy(v).trim_end_matches([' ', '\0']).trim_start().to_owned())
}

#[cfg(test)]
mod tests {
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
}
