//! Shared + per-frame: the series as one Legacy Converted Enhanced instance (PS3.3 A.70–A.72, C.7.6.16), simulated
//! as ../../parser-output/measure_parser.py's `converted_enhanced` does, kept as its shared row and a row per frame.

use super::{hash, Change, Package};
use crate::group::{self, PageValues, Record, Tag};
use anyhow::{bail, ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{BTreeMap, BTreeSet};

pub const SCHEMA: &str = "
    CREATE TABLE shared (series TEXT PRIMARY KEY, bytes BLOB NOT NULL, xxh3 INTEGER NOT NULL);
    CREATE TABLE frame (uid TEXT PRIMARY KEY, series TEXT NOT NULL, number INTEGER NOT NULL, bytes BLOB NOT NULL,
                        xxh3 INTEGER NOT NULL);
    CREATE INDEX frame_series ON frame (series, number);";

const SHARED: Tag = [0x52, 0x00, 0x92, 0x29];
const PER_FRAME: Tag = [0x52, 0x00, 0x92, 0x30];
const UNASSIGNED_SHARED: Tag = [0x00, 0x20, 0x91, 0x70];
const UNASSIGNED_PER_FRAME: Tag = [0x00, 0x20, 0x91, 0x71];
const FRAME_CONTENT: Tag = [0x00, 0x20, 0x91, 0x11];
const CONVERSION_SOURCE: Tag = [0x00, 0x20, 0x91, 0x72];
const DERIVATION_IMAGE: Tag = [0x00, 0x08, 0x91, 0x24];
const SOP_CLASS: Tag = [0x00, 0x08, 0x00, 0x16];
const SOP_INSTANCE: Tag = [0x00, 0x08, 0x00, 0x18];
const IMAGE_TYPE: Tag = [0x00, 0x08, 0x00, 0x08];
const ACQUISITION_DATE: Tag = [0x00, 0x08, 0x00, 0x22];
const ACQUISITION_TIME: Tag = [0x00, 0x08, 0x00, 0x32];
const ACQUISITION_NUMBER: Tag = [0x00, 0x20, 0x00, 0x12];
const REFERENCED_IMAGE: Tag = [0x00, 0x08, 0x11, 0x40];
const SOURCE_IMAGE: Tag = [0x00, 0x08, 0x21, 0x12];

const MACROS: [(Tag, &[Tag]); 6] = [
    ([0x00, 0x28, 0x91, 0x10], &[[0x00, 0x28, 0x00, 0x30], [0x00, 0x18, 0x00, 0x50], [0x00, 0x18, 0x00, 0x88]]),
    ([0x00, 0x20, 0x91, 0x13], &[[0x00, 0x20, 0x00, 0x32]]),
    ([0x00, 0x20, 0x91, 0x16], &[[0x00, 0x20, 0x00, 0x37]]),
    ([0x00, 0x28, 0x91, 0x32], &[[0x00, 0x28, 0x10, 0x50], [0x00, 0x28, 0x10, 0x51], [0x00, 0x28, 0x10, 0x55]]),
    ([0x00, 0x28, 0x91, 0x45], &[[0x00, 0x28, 0x10, 0x52], [0x00, 0x28, 0x10, 0x53], [0x00, 0x28, 0x10, 0x54]]),
    ([0x00, 0x18, 0x94, 0x77], &[[0x00, 0x08, 0x30, 0x10]]),
];

const TOP_LEVEL: [Tag; 25] = [
    [0x00, 0x08, 0x00, 0x08], [0x00, 0x08, 0x00, 0x12], [0x00, 0x08, 0x00, 0x13], [0x00, 0x08, 0x00, 0x14],
    [0x00, 0x08, 0x00, 0x16], [0x00, 0x08, 0x00, 0x18], [0x00, 0x08, 0x00, 0x23], [0x00, 0x08, 0x00, 0x33],
    [0x00, 0x20, 0x00, 0x13], [0x00, 0x28, 0x00, 0x02], [0x00, 0x28, 0x00, 0x04], [0x00, 0x28, 0x00, 0x06],
    [0x00, 0x28, 0x00, 0x08], [0x00, 0x28, 0x00, 0x10], [0x00, 0x28, 0x00, 0x11], [0x00, 0x28, 0x00, 0x34],
    [0x00, 0x28, 0x01, 0x00], [0x00, 0x28, 0x01, 0x01], [0x00, 0x28, 0x01, 0x02], [0x00, 0x28, 0x01, 0x03],
    [0x00, 0x28, 0x03, 0x01], [0x00, 0x28, 0x21, 0x10], [0x00, 0x28, 0x21, 0x12], [0x00, 0x28, 0x21, 0x14],
    [0x20, 0x50, 0x00, 0x20],
];

fn converted_class(modality: &str) -> Option<(&'static [u8], Tag)> {
    match modality {
        "CT" => Some((b"1.2.840.10008.5.1.4.1.1.2.2", [0x00, 0x18, 0x93, 0x29])),
        "MR" => Some((b"1.2.840.10008.5.1.4.1.1.4.4", [0x00, 0x18, 0x92, 0x26])),
        "PT" => Some((b"1.2.840.10008.5.1.4.1.1.128.1", [0x00, 0x18, 0x97, 0x51])),
        _ => None,
    }
}

pub fn applies(modality: &str) -> bool {
    converted_class(modality).is_some()
}

/// An item's level in DECK's key: the sequence's tag and the item number, big-endian.
fn item(tag: Tag, number: u32) -> [u8; 8] {
    let mut out = [0; 8];
    out[..4].copy_from_slice(&tag);
    out[4..].copy_from_slice(&number.to_be_bytes());
    out
}

fn top_key(tag: Tag, vr: &[u8; 2]) -> Vec<u8> {
    [tag.as_slice(), vr, &[0, 0]].concat()
}

fn nested(levels: &[[u8; 8]], r: &Record) -> Record {
    Record { key: [levels.concat(), r.key.clone()].concat(), value: r.value.clone() }
}

fn root(r: &Record) -> Tag {
    r.key[..4].try_into().unwrap()
}

type Frame = BTreeMap<Tag, Vec<Record>>;

fn get<'a>(f: &'a Frame, tag: &Tag) -> &'a [Record] {
    f.get(tag).map_or(&[], Vec::as_slice)
}

/// The series' converted-enhanced records, sorted by key then value.
pub fn converted(p: &Package) -> Result<Vec<Record>> {
    let (class, frame_type) = converted_class(&p.modality).context("no Legacy Converted class for this modality")?;
    let mut frames = Vec::with_capacity(p.instances.len());
    for i in &p.instances {
        let mut f = Frame::new();
        for r in group::parse(&i.group)?.into_iter().chain(group::parse(&i.private)?) {
            f.entry(root(&r)).or_default().push(r);
        }
        frames.push(f);
    }
    let mut out = Vec::new();
    let mut taken = BTreeSet::new();
    for (t, records) in &frames[0] {
        if t[..2] == [0, 2] || TOP_LEVEL.contains(t) {
            out.extend(records.iter().cloned());
            taken.insert(*t);
        }
    }
    let n = frames.len().to_string();
    let pad = if n.len() % 2 == 1 { " " } else { "" };
    out.push(Record { key: top_key([0x00, 0x28, 0x00, 0x08], b"IS"), value: format!("{n}{pad}").into_bytes() });
    let class = [class, &vec![0; class.len() % 2]].concat();
    for r in out.iter_mut().filter(|r| root(r) == SOP_CLASS) {
        r.value = class.clone();
    }

    for (macro_tag, members) in MACROS {
        let per_frame: Vec<Vec<Record>> =
            frames.iter().map(|f| members.iter().flat_map(|m| get(f, m).iter().cloned()).collect()).collect();
        if per_frame.iter().any(|f| !f.is_empty()) {
            placed(per_frame, &[item(macro_tag, 1)], &mut out);
        }
        taken.extend(members.iter().copied());
    }
    if frames.iter().any(|f| f.contains_key(&IMAGE_TYPE)) {
        let per_frame = frames
            .iter()
            .map(|f| {
                let key = top_key([0x00, 0x08, 0x90, 0x07], b"CS");
                get(f, &IMAGE_TYPE).iter().map(|r| Record { key: key.clone(), value: r.value.clone() }).collect()
            })
            .collect();
        placed(per_frame, &[item(frame_type, 1)], &mut out);
    }
    for (sequence, wrap) in [(REFERENCED_IMAGE, vec![]), (SOURCE_IMAGE, vec![item(DERIVATION_IMAGE, 1)])] {
        if frames.iter().any(|f| f.contains_key(&sequence)) {
            placed(frames.iter().map(|f| get(f, &sequence).to_vec()).collect(), &wrap, &mut out);
            taken.insert(sequence);
        }
    }

    let dated = frames.iter().all(|f| f.contains_key(&ACQUISITION_DATE) && f.contains_key(&ACQUISITION_TIME));
    let numbered = frames.iter().all(|f| get(f, &ACQUISITION_NUMBER).first().is_some_and(|r| !r.value.trim_ascii().is_empty()));
    for (n, f) in frames.iter().enumerate() {
        let number = n as u32 + 1;
        let mut content = Vec::new();
        if dated {
            let date = get(f, &ACQUISITION_DATE)[0].value.trim_ascii_end();
            let stamp = [date, &get(f, &ACQUISITION_TIME)[0].value].concat();
            content.push(Record { key: top_key([0x00, 0x18, 0x90, 0x74], b"DT"), value: stamp });
        }
        if numbered {
            let text = std::str::from_utf8(get(f, &ACQUISITION_NUMBER)[0].value.trim_ascii())?;
            let value = text.parse::<u16>()?.to_le_bytes().to_vec();
            content.push(Record { key: top_key([0x00, 0x20, 0x91, 0x56], b"US"), value });
        }
        let levels = [item(PER_FRAME, number), item(FRAME_CONTENT, 1)];
        out.extend(content.iter().map(|r| nested(&levels, r)));
        let class = get(f, &SOP_CLASS).first().context("an instance without its SOP class")?;
        let uid = get(f, &SOP_INSTANCE).first().context("an instance without its UID")?;
        let source = [
            Record { key: top_key([0x00, 0x08, 0x11, 0x50], b"UI"), value: class.value.clone() },
            Record { key: top_key([0x00, 0x08, 0x11, 0x55], b"UI"), value: uid.value.clone() },
        ];
        let levels = [item(PER_FRAME, number), item(CONVERSION_SOURCE, 1)];
        out.extend(source.iter().map(|r| nested(&levels, r)));
    }
    if dated {
        taken.extend([ACQUISITION_DATE, ACQUISITION_TIME]);
    }
    if numbered {
        taken.insert(ACQUISITION_NUMBER);
    }

    let every: BTreeSet<Tag> = frames.iter().flat_map(|f| f.keys().copied()).collect();
    for t in every {
        if t[..2] == [0, 2] || t == SOP_CLASS || t == SOP_INSTANCE {
            continue;
        }
        let values: Vec<Option<&Vec<Record>>> = frames.iter().map(|f| f.get(&t)).collect();
        let equal = values.iter().all(|v| *v == values[0]);
        if taken.contains(&t) && (!TOP_LEVEL.contains(&t) || equal) {
            continue;
        }
        if equal && values[0].is_some() {
            let levels = [item(SHARED, 1), item(UNASSIGNED_SHARED, 1)];
            out.extend(values[0].unwrap().iter().map(|r| nested(&levels, r)));
        } else {
            for (n, v) in values.iter().enumerate() {
                let levels = [item(PER_FRAME, n as u32 + 1), item(UNASSIGNED_PER_FRAME, 1)];
                out.extend(v.iter().flat_map(|rs| rs.iter()).map(|r| nested(&levels, r)));
            }
        }
    }
    sort(&mut out);
    Ok(out)
}

/// The Shared item when every frame has the same records, else each frame's own Per-Frame item.
fn placed(per_frame: Vec<Vec<Record>>, wrap: &[[u8; 8]], out: &mut Vec<Record>) {
    if per_frame.iter().all(|f| *f == per_frame[0]) {
        let levels = [&[item(SHARED, 1)], wrap].concat();
        out.extend(per_frame[0].iter().map(|r| nested(&levels, r)));
    } else {
        for (n, records) in per_frame.iter().enumerate() {
            let levels = [&[item(PER_FRAME, n as u32 + 1)], wrap].concat();
            out.extend(records.iter().map(|r| nested(&levels, r)));
        }
    }
}

fn sort(records: &mut [Record]) {
    records.sort_by(|a, b| (&a.key, &a.value).cmp(&(&b.key, &b.value)));
}

fn frame_number(r: &Record) -> Option<u32> {
    (r.key[..4] == PER_FRAME).then(|| u32::from_be_bytes(r.key[4..8].try_into().unwrap()))
}

pub fn insert(tx: &Connection, p: &Package) -> Result<()> {
    let records = converted(p)?;
    let split = records.iter().position(|r| frame_number(r).is_some()).unwrap_or(records.len());
    let shared = group::write(&records[..split]);
    tx.execute("INSERT INTO shared VALUES (?1, ?2, ?3)", params![p.series_uid, shared, hash(&shared)])?;
    let mut insert = tx.prepare_cached("INSERT INTO frame VALUES (?1, ?2, ?3, ?4, ?5)")?;
    let mut rest = &records[split..];
    for (n, i) in p.instances.iter().enumerate() {
        let number = n as u32 + 1;
        let end = rest.iter().position(|r| frame_number(r) != Some(number)).unwrap_or(rest.len());
        let bytes = group::write(&rest[..end]);
        insert.execute(params![i.uid, p.series_uid, number, bytes, hash(&bytes)])?;
        rest = &rest[end..];
    }
    ensure!(rest.is_empty(), "records past the last frame");
    Ok(())
}

fn shared_row(db: &Connection, series: &str) -> Result<Vec<Record>> {
    let mut q = db.prepare_cached("SELECT bytes FROM shared WHERE series = ?1")?;
    q.query_row([series], |r| Ok(group::parse(r.get_ref(0)?.as_blob()?)))?
}

fn frame_rows(db: &Connection, series: &str) -> Result<Vec<(String, Vec<Record>)>> {
    let mut q = db.prepare_cached("SELECT uid, bytes FROM frame WHERE series = ?1 ORDER BY number")?;
    let mut rows = q.query([series])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push((row.get(0)?, group::parse(row.get_ref(1)?.as_blob()?)?));
    }
    Ok(out)
}

/// A page tag's value at the top level, overridden by a functional group or unassigned attribute one level down,
/// the shared row's first and then the frame's.
pub fn paint(db: &Connection, series: &str) -> Result<Vec<PageValues>> {
    let shared = shared_row(db, series)?;
    let pick = |base: &mut PageValues, records: &[Record], depth: usize| {
        for r in records.iter().filter(|r| r.key.len() == depth) {
            if let Some(i) = group::PAGE_TAGS.iter().position(|t| *t == r.tag()) {
                base[i] = Some(r.value.clone());
            }
        }
    };
    let mut base = PageValues::default();
    pick(&mut base, &shared, 8);
    pick(&mut base, &shared, 24);
    let mut out = Vec::new();
    for (_, records) in frame_rows(db, series)? {
        let mut values = base.clone();
        pick(&mut values, &records, 24);
        out.push(values);
    }
    Ok(out)
}

pub fn full(db: &Connection, series: &str) -> Result<(Vec<Record>, Vec<Vec<Record>>)> {
    Ok((shared_row(db, series)?, frame_rows(db, series)?.into_iter().map(|(_, r)| r).collect()))
}

/// Where an attribute lives: a functional group macro, or its own root in Unassigned Shared or Per-Frame.
fn unit(tag: Tag) -> (Option<Tag>, Tag) {
    match MACROS.iter().find(|(_, members)| members.contains(&tag)) {
        Some((m, _)) => (Some(*m), tag),
        None => (None, tag),
    }
}

/// The 16 key bytes above the unit's records in the shared row (`frame` None) or a frame's, and what they match.
fn level(unit: (Option<Tag>, Tag), frame: Option<u32>) -> (Vec<u8>, Vec<u8>) {
    let top = frame.map_or(item(SHARED, 1), |n| item(PER_FRAME, n));
    let (inner, root) = match unit {
        (Some(m), _) => (item(m, 1), vec![]),
        (None, t) => (item(if frame.is_some() { UNASSIGNED_PER_FRAME } else { UNASSIGNED_SHARED }, 1), t.to_vec()),
    };
    let level = [top, inner].concat();
    (level.clone(), [level, root].concat())
}

/// Takes the unit's records out of a row, keyed below its level.
fn take(row: &mut Vec<Record>, unit: (Option<Tag>, Tag), frame: Option<u32>) -> Vec<Record> {
    let (_, matched) = level(unit, frame);
    let (inside, rest): (Vec<Record>, Vec<Record>) = std::mem::take(row).into_iter().partition(|r| r.key.starts_with(&matched));
    *row = rest;
    inside.into_iter().map(|r| Record { key: r.key[16..].to_vec(), value: r.value }).collect()
}

fn put(row: &mut Vec<Record>, unit: (Option<Tag>, Tag), frame: Option<u32>, records: &[Record]) {
    let (above, _) = level(unit, frame);
    row.extend(records.iter().map(|r| Record { key: [above.as_slice(), &r.key].concat(), value: r.value.clone() }));
    sort(row);
}

fn set(records: &mut [Record], tag: Tag, value: &[u8]) -> Result<Vec<u8>> {
    let r = records.iter_mut().find(|r| r.key.len() == 8 && r.tag() == tag).context("no such attribute here")?;
    Ok(std::mem::replace(&mut r.value, value.to_vec()))
}

fn write_frame(tx: &Connection, uid: &str, records: &[Record]) -> Result<()> {
    let bytes = group::write(records);
    tx.execute("UPDATE frame SET bytes = ?1, xxh3 = ?2 WHERE uid = ?3", params![bytes, hash(&bytes), uid])?;
    Ok(())
}

/// A shared attribute set in one frame splits its unit into every frame; set in every frame to one result, a
/// per-frame unit joins the shared row. A change to one frame of a per-frame unit never joins.
pub fn correct(tx: &Connection, series: &str, uid: Option<&str>, tag: Tag, value: &[u8]) -> Result<(Change, Vec<u8>)> {
    let u = unit(tag);
    let mut shared = shared_row(tx, series)?;
    let mut common = take(&mut shared, u, None);
    let write_shared = |shared: &[Record]| -> Result<()> {
        let bytes = group::write(shared);
        tx.execute("UPDATE shared SET bytes = ?1, xxh3 = ?2 WHERE series = ?3", params![bytes, hash(&bytes), series])?;
        Ok(())
    };
    if !common.is_empty() {
        let old = common.clone();
        let prior = set(&mut common, tag, value)?;
        let Some(uid) = uid else {
            put(&mut shared, u, None, &common);
            write_shared(&shared)?;
            return Ok((Change { rows: 1, shared: Some(true) }, prior));
        };
        let mut frames = frame_rows(tx, series)?;
        for (n, (frame_uid, records)) in frames.iter_mut().enumerate() {
            put(records, u, Some(n as u32 + 1), if frame_uid == uid { &common } else { &old });
            write_frame(tx, frame_uid, records)?;
        }
        write_shared(&shared)?;
        return Ok((Change { rows: frames.len() + 1, shared: Some(false) }, prior));
    }
    if let Some(uid) = uid {
        let (number, bytes): (u32, Vec<u8>) = tx
            .query_row("SELECT number, bytes FROM frame WHERE uid = ?1", [uid], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?
            .context("no such frame")?;
        let mut records = group::parse(&bytes)?;
        let mut own = take(&mut records, u, Some(number));
        let prior = set(&mut own, tag, value)?;
        put(&mut records, u, Some(number), &own);
        write_frame(tx, uid, &records)?;
        return Ok((Change { rows: 1, shared: Some(false) }, prior));
    }
    let mut frames = frame_rows(tx, series)?;
    let mut units = Vec::with_capacity(frames.len());
    let mut prior = None;
    for (n, (_, records)) in frames.iter_mut().enumerate() {
        let mut own = take(records, u, Some(n as u32 + 1));
        prior.get_or_insert(set(&mut own, tag, value)?);
        units.push(own);
    }
    let Some(prior) = prior else { bail!("no frame") };
    if units.iter().all(|x| *x == units[0]) {
        for (uid, records) in &frames {
            write_frame(tx, uid, records)?;
        }
        put(&mut shared, u, None, &units[0]);
        write_shared(&shared)?;
        return Ok((Change { rows: frames.len() + 1, shared: Some(true) }, prior));
    }
    for (n, ((uid, records), own)) in frames.iter_mut().zip(&units).enumerate() {
        put(records, u, Some(n as u32 + 1), own);
        write_frame(tx, uid, records)?;
    }
    Ok((Change { rows: frames.len(), shared: Some(false) }, prior))
}
