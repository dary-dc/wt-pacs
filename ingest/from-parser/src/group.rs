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
mod tests;
