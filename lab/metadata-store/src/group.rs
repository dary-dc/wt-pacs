//! The parser's group format: docs/ingest/contract.md §Group files.

use anyhow::{ensure, Result};

pub type Tag = [u8; 4];

#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub key: Vec<u8>,
    pub value: Vec<u8>,
}

impl Record {
    pub fn tag(&self) -> Tag {
        self.key[self.key.len() - 8..][..4].try_into().unwrap()
    }
}

pub fn parse(mut bytes: &[u8]) -> Result<Vec<Record>> {
    let mut records = Vec::new();
    while !bytes.is_empty() {
        let kl = bytes[0] as usize;
        ensure!(bytes.len() >= 1 + kl + 4, "record cut short");
        let key = bytes[1..1 + kl].to_vec();
        let vl = u32::from_le_bytes(bytes[1 + kl..5 + kl].try_into()?) as usize;
        ensure!(bytes.len() >= 5 + kl + vl, "value cut short");
        records.push(Record {
            key,
            value: bytes[5 + kl..5 + kl + vl].to_vec(),
        });
        bytes = &bytes[5 + kl + vl..];
    }
    Ok(records)
}

pub fn write(records: &[Record]) -> Vec<u8> {
    let mut out = Vec::new();
    for r in records {
        out.push(r.key.len() as u8);
        out.extend_from_slice(&r.key);
        out.extend_from_slice(&(r.value.len() as u32).to_le_bytes());
        out.extend_from_slice(&r.value);
    }
    out
}

pub const SOP_INSTANCE_UID: Tag = [0x00, 0x08, 0x00, 0x18];
pub const INSTANCE_NUMBER: Tag = [0x00, 0x20, 0x00, 0x13];
pub const IMAGE_POSITION: Tag = [0x00, 0x20, 0x00, 0x32];

/// What the page reads per instance (client/viewer/viewer.js), in tag order.
pub const PAGE_TAGS: [Tag; 6] = [
    INSTANCE_NUMBER,
    [0x00, 0x28, 0x00, 0x04],
    [0x00, 0x28, 0x10, 0x50],
    [0x00, 0x28, 0x10, 0x51],
    [0x00, 0x28, 0x10, 0x52],
    [0x00, 0x28, 0x10, 0x53],
];

/// One instance's page values, in `PAGE_TAGS` order; `None` where the group lacks the tag.
pub type PageValues = [Option<Vec<u8>>; 6];

pub fn page_values(records: impl IntoIterator<Item = (Tag, Vec<u8>)>) -> PageValues {
    let mut out: PageValues = Default::default();
    for (tag, value) in records {
        if let Some(i) = PAGE_TAGS.iter().position(|t| *t == tag) {
            out[i] = Some(value);
        }
    }
    out
}

fn even(mut text: Vec<u8>, pad: u8) -> Vec<u8> {
    if text.len() % 2 == 1 {
        text.push(pad);
    }
    text
}

/// A series of `n` instances from one instance group: each gets its own UID, number and slice position.
pub fn synthetic_series(template: &[Record], n: u16) -> Vec<Vec<Record>> {
    let uid = template
        .iter()
        .find(|r| r.tag() == SOP_INSTANCE_UID)
        .map(|r| r.value.clone())
        .unwrap_or_default();
    let uid = String::from_utf8_lossy(&uid)
        .trim_end_matches('\0')
        .to_string();
    (1..=n)
        .map(|i| {
            template
                .iter()
                .map(|r| {
                    let value = match r.tag() {
                        SOP_INSTANCE_UID => even(format!("{uid}.{i}").into_bytes(), 0),
                        INSTANCE_NUMBER => even(i.to_string().into_bytes(), b' '),
                        IMAGE_POSITION => even(
                            format!("-158.135803\\-179.035797\\{:.6}", -77.2 + 5.0 * i as f64)
                                .into_bytes(),
                            b' ',
                        ),
                        _ => r.value.clone(),
                    };
                    Record {
                        key: r.key.clone(),
                        value,
                    }
                })
                .collect()
        })
        .collect()
}
