//! Each arm's open: the container's own index read into the server's (offset, length) table.

use crate::pack::{INDEX_KEY, MXF_PREFIX, RIP_KEY, SBND2_ENTRY, SBND2_HEADER};
use crate::source::{Cursor, Source};
use anyhow::{bail, ensure, Context, Result};

pub type Index = Vec<(u64, u32)>;

/// Bytes a header walk reads at a time.
const WINDOW: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Container {
    Sbnd1,
    Sbnd2,
    Mp4,
    Fmp4,
    Mkv,
    Dicom,
    Mxf,
    Ivf,
}

impl Container {
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "sbnd1" => Self::Sbnd1,
            "sbnd2" => Self::Sbnd2,
            "mp4" => Self::Mp4,
            "fmp4" => Self::Fmp4,
            "mkv" => Self::Mkv,
            "dicom" => Self::Dicom,
            "mxf" => Self::Mxf,
            "ivf" => Self::Ivf,
            _ => bail!("unknown container {s}"),
        })
    }
}

pub fn index(kind: Container, src: &Source) -> Result<Index> {
    let index = match kind {
        Container::Sbnd1 => sbnd1(src),
        Container::Sbnd2 => sbnd2(src),
        Container::Mp4 => mp4(src),
        Container::Fmp4 => fmp4(src),
        Container::Mkv => mkv(src),
        Container::Dicom => dicom(src),
        Container::Mxf => mxf(src),
        Container::Ivf => ivf(src),
    }?;
    for (i, &(at, len)) in index.iter().enumerate() {
        ensure!(at + len as u64 <= src.len(), "frame {i} ({at}, {len}) runs past the file ({})", src.len());
    }
    Ok(index)
}

fn u16be(b: &[u8], at: usize) -> u16 {
    u16::from_be_bytes(b[at..at + 2].try_into().unwrap())
}
fn u32be(b: &[u8], at: usize) -> u32 {
    u32::from_be_bytes(b[at..at + 4].try_into().unwrap())
}
fn u64be(b: &[u8], at: usize) -> u64 {
    u64::from_be_bytes(b[at..at + 8].try_into().unwrap())
}
fn u32le(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn u64le(b: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}

/// The product's two reads: the header, then everything before the first frame.
fn sbnd1(src: &Source) -> Result<Index> {
    let head = src.read(0, 16)?;
    ensure!(&head[..4] == b"SBND" && u32le(&head, 4) == 1, "not an .sbnd v1");
    let n = u32le(&head, 12) as usize;
    let prefix = src.read(0, 16 + 12 * n + u32le(&head, 8) as usize)?;
    Ok((0..n).map(|i| (u64le(&prefix, 16 + 12 * i), u32le(&prefix, 24 + 12 * i))).collect())
}

fn sbnd2(src: &Source) -> Result<Index> {
    let head = src.read(0, SBND2_HEADER)?;
    ensure!(&head[..4] == b"SBND" && u32le(&head, 4) == 2, "not an .sbnd v2");
    let n = u32le(&head, 16) as usize;
    let table = src.read(SBND2_HEADER as u64, SBND2_ENTRY * n)?;
    Ok((0..n).map(|i| (u64le(&table, SBND2_ENTRY * i), u32le(&table, SBND2_ENTRY * i + 8))).collect())
}

// ---- ISOBMFF ----

/// (type, header length, total length) of the box at the start of `b`.
fn box_at(b: &[u8], file_rest: u64) -> Result<([u8; 4], usize, u64)> {
    ensure!(b.len() >= 8, "a box header cut short");
    let kind: [u8; 4] = b[4..8].try_into().unwrap();
    Ok(match u32be(b, 0) {
        1 => {
            ensure!(b.len() >= 16, "a large box header cut short");
            (kind, 16, u64be(b, 8))
        }
        0 => (kind, 8, file_rest),
        n => (kind, 8, n as u64),
    })
}

/// The children of a box body, by type.
fn children(body: &[u8]) -> Result<Vec<([u8; 4], &[u8])>> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + 8 <= body.len() {
        let (kind, hl, len) = box_at(&body[at..], (body.len() - at) as u64)?;
        let end = at + len as usize;
        ensure!(len as usize >= hl && end <= body.len(), "box {} overruns its parent", String::from_utf8_lossy(&kind));
        out.push((kind, &body[at + hl..end]));
        at = end;
    }
    Ok(out)
}

fn child<'a>(body: &'a [u8], kind: &[u8; 4]) -> Result<&'a [u8]> {
    children(body)?
        .into_iter()
        .find(|(k, _)| k == kind)
        .map(|(_, b)| b)
        .with_context(|| format!("no {} box", String::from_utf8_lossy(kind)))
}

/// Top-level boxes in order, header by header, until `want` is found: its offset and body.
fn top_level(src: &Source, cur: &mut Cursor, want: &[u8; 4]) -> Result<(u64, Vec<u8>)> {
    let mut at = 0u64;
    while at + 8 <= src.len() {
        let head = cur.get(at, 16.min((src.len() - at) as usize))?.to_vec();
        let (kind, hl, len) = box_at(&head, src.len() - at)?;
        ensure!(len >= hl as u64, "a zero-length box at {at}");
        if &kind == want {
            return Ok((at, cur.get(at + hl as u64, (len - hl as u64) as usize)?.to_vec()));
        }
        at += len;
    }
    bail!("no top-level {} box", String::from_utf8_lossy(want))
}

/// Progressive MP4, any chunking: the video track's `stsz`, `stsc` and `stco`/`co64`.
fn mp4(src: &Source) -> Result<Index> {
    let mut cur = Cursor::new(src, WINDOW);
    let (_, moov) = top_level(src, &mut cur, b"moov")?;
    let stbl = video_stbl(&moov)?;
    let stsz = child(stbl, b"stsz")?;
    let fixed = u32be(stsz, 4);
    let n = u32be(stsz, 8) as usize;
    let size = |i: usize| if fixed != 0 { fixed } else { u32be(stsz, 12 + 4 * i) };
    let chunks: Vec<u64> = match child(stbl, b"co64") {
        Ok(co) => (0..u32be(co, 4) as usize).map(|i| u64be(co, 8 + 8 * i)).collect(),
        Err(_) => {
            let co = child(stbl, b"stco")?;
            (0..u32be(co, 4) as usize).map(|i| u32be(co, 8 + 4 * i) as u64).collect()
        }
    };
    let stsc = child(stbl, b"stsc")?;
    let runs: Vec<(usize, usize)> =
        (0..u32be(stsc, 4) as usize).map(|i| (u32be(stsc, 8 + 12 * i) as usize, u32be(stsc, 12 + 12 * i) as usize)).collect();
    let mut index = Vec::with_capacity(n);
    for (c, &chunk_at) in chunks.iter().enumerate() {
        let per = runs.iter().rev().find(|(first, _)| *first <= c + 1).map(|r| r.1).context("a chunk before stsc's first run")?;
        let mut at = chunk_at;
        for _ in 0..per {
            if index.len() == n {
                break;
            }
            let len = size(index.len());
            index.push((at, len));
            at += len as u64;
        }
    }
    ensure!(index.len() == n, "chunks hold {} of {n} samples", index.len());
    Ok(index)
}

fn video_stbl(moov: &[u8]) -> Result<&[u8]> {
    for (kind, trak) in children(moov)? {
        if &kind != b"trak" {
            continue;
        }
        let mdia = child(trak, b"mdia")?;
        if &child(mdia, b"hdlr")?[8..12] == b"vide" {
            return child(child(mdia, b"minf")?, b"stbl");
        }
    }
    bail!("no video track")
}

/// Fragmented MP4: the global `sidx`, then one read a fragment for its `moof`.
fn fmp4(src: &Source) -> Result<Index> {
    let mut cur = Cursor::new(src, WINDOW);
    let (sidx_at, sidx) = top_level(src, &mut cur, b"sidx")?;
    let v = sidx[0];
    let (first_offset, rest) = if v == 0 { (u32be(&sidx, 16) as u64, 20) } else { (u64be(&sidx, 20), 28) };
    let count = u16be(&sidx, rest + 2) as usize;
    let sidx_end = sidx_at + 8 + sidx.len() as u64;
    let mut at = sidx_end + first_offset;
    let mut index = Vec::new();
    let mut guess = 1024usize;
    for r in 0..count {
        let e = rest + 4 + 12 * r;
        let size = (u32be(&sidx, e) & 0x7FFF_FFFF) as u64;
        ensure!(u32be(&sidx, e) >> 31 == 0, "a sidx reference to a sidx");
        let mut head = src.read(at, guess.min(size as usize))?;
        let (kind, hl, moof_len) = box_at(&head, size)?;
        ensure!(&kind == b"moof", "fragment {r} starts with {}", String::from_utf8_lossy(&kind));
        if moof_len as usize > head.len() {
            head = src.read(at, moof_len as usize)?;
        }
        guess = moof_len as usize + 16;
        let traf = child(&head[hl..moof_len as usize], b"traf")?;
        let tfhd = child(traf, b"tfhd")?;
        let flags = u32be(tfhd, 0) & 0xFF_FFFF;
        let base = if flags & 1 != 0 { u64be(tfhd, 8) } else { at };
        let default_at = 8 + [0x1, 0x2, 0x8].iter().map(|&f| if flags & f == 0 { 0 } else if f == 1 { 8 } else { 4 }).sum::<usize>();
        let default_size = (flags & 0x10 != 0).then(|| u32be(tfhd, default_at));
        let trun = child(traf, b"trun")?;
        let tflags = u32be(trun, 0) & 0xFF_FFFF;
        ensure!(tflags & 1 != 0, "trun without a data offset");
        ensure!(tflags & 0x200 != 0 || default_size.is_some(), "no sample sizes in trun or tfhd");
        let n = u32be(trun, 4) as usize;
        let mut p = 12 + if tflags & 4 != 0 { 4 } else { 0 };
        let mut data = (base as i64 + u32be(trun, 8) as i32 as i64) as u64;
        let stride = [0x100, 0x200, 0x400, 0x800].iter().filter(|&&f| tflags & f != 0).count() * 4;
        let size_at = if tflags & 0x100 != 0 { 4 } else { 0 };
        for _ in 0..n {
            let len = if tflags & 0x200 != 0 { u32be(trun, p + size_at) } else { default_size.unwrap_or(0) };
            index.push((data, len));
            data += len as u64;
            p += stride;
        }
        at += size;
    }
    Ok(index)
}

// ---- Matroska ----

/// An EBML ID (marker kept) and its width.
fn ebml_id(b: &[u8]) -> Result<(u32, usize)> {
    let w = b.first().map(|x| x.leading_zeros() as usize + 1).filter(|&w| w <= 4).context("a bad EBML ID")?;
    ensure!(b.len() >= w, "an EBML ID cut short");
    Ok((b[..w].iter().fold(0u32, |a, &x| a << 8 | x as u32), w))
}

/// An EBML size (marker removed) and its width.
fn ebml_size(b: &[u8]) -> Result<(u64, usize)> {
    let w = b.first().map(|x| x.leading_zeros() as usize + 1).filter(|&w| w <= 8).context("a bad EBML size")?;
    ensure!(b.len() >= w, "an EBML size cut short");
    let v = b[..w].iter().fold(0u64, |a, &x| a << 8 | x as u64);
    Ok((v & ((1u64 << (7 * w)) - 1), w))
}

/// (id, header length, body length) of the element at the start of `b`.
fn element(b: &[u8]) -> Result<(u32, usize, u64)> {
    let (id, iw) = ebml_id(b)?;
    let (len, sw) = ebml_size(&b[iw..])?;
    Ok((id, iw + sw, len))
}

fn ebml_uint(b: &[u8]) -> u64 {
    b.iter().fold(0u64, |a, &x| a << 8 | x as u64)
}

fn elements(mut b: &[u8]) -> Result<Vec<(u32, &[u8])>> {
    let mut out = Vec::new();
    while !b.is_empty() {
        let (id, hl, len) = element(b)?;
        let end = hl + len as usize;
        ensure!(end <= b.len(), "element {id:#x} overruns its parent");
        out.push((id, &b[hl..end]));
        b = &b[end..];
    }
    Ok(out)
}

const SEGMENT: u32 = 0x1853_8067;
const CUES: u32 = 0x1C53_BB6B;
const CLUSTER: u32 = 0x1F43_B675;

/// Matroska: the Cues, then each block's header — the index holds no length — a read apiece.
fn mkv(src: &Source) -> Result<Index> {
    let mut cur = Cursor::new(src, WINDOW);
    let (_, hl, len) = element(cur.get(0, 12)?)?;
    let seg_at = hl as u64 + len;
    let (id, shl, _) = element(cur.get(seg_at, 12)?)?;
    ensure!(id == SEGMENT, "no Segment after the EBML header");
    let data = seg_at + shl as u64;
    let mut at = data;
    let cues = loop {
        let (id, hl, len) = element(cur.get(at, 12)?)?;
        if id == CUES {
            break cur.get(at + hl as u64, len as usize)?.to_vec();
        }
        ensure!(id != CLUSTER, "a Cluster before the Cues: this open reads Cues at the front only");
        at += hl as u64 + len;
    };
    let mut points = Vec::new();
    for (id, point) in elements(&cues)? {
        if id != 0xBB {
            continue;
        }
        let fields = elements(point)?;
        let time = fields.iter().find(|f| f.0 == 0xB3).map(|f| ebml_uint(f.1)).context("a CuePoint without a time")?;
        let pos = fields.iter().find(|f| f.0 == 0xB7).context("a CuePoint without positions")?.1;
        let pos = elements(pos)?;
        let get = |id: u32| pos.iter().find(|f| f.0 == id).map(|f| ebml_uint(f.1));
        points.push((time, get(0xF1).context("no CueClusterPosition")?, get(0xF0).context("no CueRelativePosition")?));
    }
    points.sort_unstable();
    let mut cluster_data = (u64::MAX, 0u64);
    let mut index = Vec::with_capacity(points.len());
    for (_, cluster, rel) in points {
        if cluster_data.0 != cluster {
            let (id, hl, _) = element(&src.read(data + cluster, 12)?)?;
            ensure!(id == CLUSTER, "a cue at {cluster} that is not a Cluster");
            cluster_data = (cluster, data + cluster + hl as u64);
        }
        let at = cluster_data.1 + rel;
        let head = src.read(at, 16)?;
        let (id, hl, len) = element(&head)?;
        ensure!(id == 0xA3, "a cue that is not a SimpleBlock ({id:#x})");
        let (_, tw) = ebml_size(&head[hl..])?;
        ensure!(head[hl + tw + 2] & 0x06 == 0, "a laced block");
        let skip = tw as u64 + 3;
        index.push((at + hl as u64 + skip, (len - skip) as u32));
    }
    Ok(index)
}

// ---- DICOM ----

/// Explicit VR little endian, as every encapsulated transfer syntax is.
fn dicom(src: &Source) -> Result<Index> {
    let mut cur = Cursor::new(src, WINDOW);
    ensure!(cur.get(128, 4)? == b"DICM", "no DICM prefix");
    let mut at = 132u64;
    let (mut eot, mut eot_len) = (None, None);
    loop {
        let (tag, vr, hl, len) = dicom_element(&mut cur, at)?;
        if tag == 0x7FE0_0010 {
            ensure!(len == u64::MAX, "PixelData is not encapsulated");
            let item = cur.get(at + hl as u64, 8)?.to_vec();
            ensure!(u32le(&item, 0) == 0xE000_FFFE, "no Basic Offset Table item");
            let first = at + hl as u64 + 8 + u32le(&item, 4) as u64;
            let offsets: Vec<u64> = eot.context("no Extended Offset Table")?;
            let lengths: Vec<u64> = eot_len.context("no Extended Offset Table Lengths")?;
            ensure!(offsets.len() == lengths.len(), "the offset table and its lengths disagree");
            return Ok(offsets.iter().zip(&lengths).map(|(&o, &l)| (first + o + 8, l as u32)).collect());
        }
        let body = at + hl as u64;
        if len == u64::MAX {
            ensure!(vr == *b"SQ" || vr == *b"UN", "undefined length on a {}", String::from_utf8_lossy(&vr));
            at = skip_sequence(&mut cur, body)?;
            continue;
        }
        if tag == 0x7FE0_0001 || tag == 0x7FE0_0002 {
            let b = cur.get(body, len as usize)?;
            let v = (0..len as usize / 8).map(|i| u64le(b, 8 * i)).collect();
            if tag == 0x7FE0_0001 {
                eot = Some(v);
            } else {
                eot_len = Some(v);
            }
        }
        at = body + len;
    }
}

const LONG_VRS: [&[u8; 2]; 12] = [b"OB", b"OD", b"OF", b"OL", b"OV", b"OW", b"SQ", b"SV", b"UC", b"UN", b"UR", b"UT"];

/// (tag, VR, header length, value length or `u64::MAX` for undefined) of the element at `at`.
fn dicom_element(cur: &mut Cursor, at: u64) -> Result<(u32, [u8; 2], usize, u64)> {
    let b = cur.get(at, 12.min((cur.src().len() - at) as usize))?;
    ensure!(b.len() >= 8, "an element cut short at {at}");
    let tag = (u16::from_le_bytes([b[0], b[1]]) as u32) << 16 | u16::from_le_bytes([b[2], b[3]]) as u32;
    if tag >> 16 == 0xFFFE {
        return Ok((tag, *b"--", 8, undefined(u32le(b, 4))));
    }
    let vr = [b[4], b[5]];
    if LONG_VRS.contains(&&vr) {
        ensure!(b.len() >= 12, "a long element cut short at {at}");
        Ok((tag, vr, 12, undefined(u32le(b, 8))))
    } else {
        Ok((tag, vr, 8, u16::from_le_bytes([b[6], b[7]]) as u64))
    }
}

fn undefined(len: u32) -> u64 {
    if len == u32::MAX {
        u64::MAX
    } else {
        len as u64
    }
}

/// Past a sequence of undefined length: the offset after its delimiter.
fn skip_sequence(cur: &mut Cursor, mut at: u64) -> Result<u64> {
    loop {
        let (tag, _, hl, len) = dicom_element(cur, at)?;
        at += hl as u64;
        match tag {
            0xFFFE_E0DD => return Ok(at),
            0xFFFE_E000 if len == u64::MAX => at = skip_item(cur, at)?,
            0xFFFE_E000 => at += len,
            _ => bail!("{tag:#010x} inside a sequence"),
        }
    }
}

fn skip_item(cur: &mut Cursor, mut at: u64) -> Result<u64> {
    loop {
        let (tag, _, hl, len) = dicom_element(cur, at)?;
        at += hl as u64;
        if tag == 0xFFFE_E00D {
            return Ok(at);
        }
        at = if len == u64::MAX { skip_sequence(cur, at)? } else { at + len };
    }
}

// ---- MXF ----

/// A KLV's key, header length and value length at the start of `b`.
fn klv_at(b: &[u8]) -> Result<([u8; 16], usize, u64)> {
    ensure!(b.len() >= 17 && b[..4] == MXF_PREFIX, "not a KLV");
    let key: [u8; 16] = b[..16].try_into().unwrap();
    let first = b[16];
    if first < 0x80 {
        return Ok((key, 17, first as u64));
    }
    let w = (first & 0x7F) as usize;
    ensure!(w <= 8 && b.len() >= 17 + w, "a BER length cut short");
    Ok((key, 17 + w, b[17..17 + w].iter().fold(0u64, |a, &x| a << 8 | x as u64)))
}

fn is_partition(key: &[u8; 16]) -> bool {
    key[4..13] == [0x02, 0x05, 0x01, 0x01, 0x0D, 0x01, 0x02, 0x01, 0x01] && (2..=4).contains(&key[13])
}

fn is_fill(key: &[u8; 16]) -> bool {
    key[8..16] == [0x03, 0x01, 0x02, 0x10, 0x01, 0x00, 0x00, 0x00]
}

/// MXF: the Random Index Pack, each partition pack, the index segments, then each element's
/// KLV header — the index holds no length — a read apiece.
fn mxf(src: &Source) -> Result<Index> {
    let tail = src.read(src.len() - 4, 4)?;
    let rip_len = u32be(&tail, 0) as u64;
    let rip = src.read(src.len() - rip_len, rip_len as usize)?;
    let (key, hl, len) = klv_at(&rip)?;
    ensure!(key[..13] == RIP_KEY[..13], "no Random Index Pack");
    let pairs: Vec<(u32, u64)> = (0..(len as usize - 4) / 12).map(|i| (u32be(&rip, hl + 12 * i), u64be(&rip, hl + 12 * i + 4))).collect();
    let mut entries: Vec<(i64, u64)> = Vec::new();
    let mut bodies: Vec<(u64, u64)> = Vec::new();
    let mut index_sid_body = None;
    for (i, &(_, at)) in pairs.iter().enumerate() {
        let end = pairs.get(i + 1).map_or(src.len() - rip_len, |p| p.1);
        let mut region = src.read(at, ((end - at) as usize).min(WINDOW))?;
        let (key, hl, len) = klv_at(&region)?;
        ensure!(is_partition(&key), "no partition pack at {at}");
        let v = &region[hl..];
        let (header_bytes, index_bytes) = (u64be(v, 32) as usize, u64be(v, 40) as usize);
        let (body_offset, body_sid) = (u64be(v, 52), u32be(v, 60));
        let mut after = hl + len as usize + header_bytes;
        let index_end = after + index_bytes;
        if index_end > region.len() {
            region = src.read(at, index_end)?;
        }
        while after < index_end {
            let (key, khl, klen) = klv_at(&region[after..])?;
            if key[..13] == INDEX_KEY[..13] {
                let (sid, list) = index_segment(&region[after + khl..after + khl + klen as usize])?;
                index_sid_body = Some(sid);
                entries.extend(list);
            }
            after += khl + klen as usize;
        }
        if body_sid != 0 {
            let next = src.read(at + after as u64, 25.min((end - at) as usize - after))?;
            if let Ok((key, khl, klen)) = klv_at(&next) {
                if is_fill(&key) {
                    after += khl + klen as usize;
                }
            }
            bodies.push((body_offset, at + after as u64));
        }
    }
    ensure!(index_sid_body.is_some(), "no index table segment");
    entries.sort_unstable();
    bodies.sort_unstable();
    let mut index = Vec::with_capacity(entries.len());
    for (_, stream) in entries {
        let &(base, file) = bodies.iter().rev().find(|b| b.0 <= stream).context("an edit unit before any body")?;
        let start = file + (stream - base);
        let mut unit = Cursor::new(src, 1024);
        let mut at = start;
        loop {
            let (key, hl, len) = klv_at(unit.get(at, 25.min((src.len() - at) as usize))?)?;
            if key[4] == 0x01 && key[12] == 0x15 {
                index.push((at + hl as u64, len as u32));
                break;
            }
            ensure!(at - start < 1 << 20, "no picture element in the edit unit at {start}");
            at += hl as u64 + len;
        }
    }
    Ok(index)
}

/// (BodySID, [(position, stream offset)]) of one index table segment's local set.
fn index_segment(set: &[u8]) -> Result<(u32, Vec<(i64, u64)>)> {
    let (mut start, mut body_sid, mut list) = (0i64, 0u32, Vec::new());
    let mut p = 0usize;
    let mut raw = None;
    while p + 4 <= set.len() {
        let tag = u16be(set, p);
        let len = u16be(set, p + 2) as usize;
        let v = &set[p + 4..p + 4 + len];
        match tag {
            0x3F0C => start = u64be(v, 0) as i64,
            0x3F07 => body_sid = u32be(v, 0),
            0x3F0A => raw = Some(v),
            _ => {}
        }
        p += 4 + len;
    }
    if let Some(v) = raw {
        let (n, each) = (u32be(v, 0) as usize, u32be(v, 4) as usize);
        for i in 0..n {
            list.push((start + i as i64, u64be(v, 8 + each * i + 3)));
        }
    }
    Ok((body_sid, list))
}

// ---- IVF ----

/// IVF has no index: each frame's 12-byte header follows the last frame, a read apiece.
fn ivf(src: &Source) -> Result<Index> {
    let head = src.read(0, 32)?;
    ensure!(&head[..4] == b"DKIF", "not an IVF");
    let mut at = u16::from_le_bytes([head[6], head[7]]) as u64;
    let mut index = Vec::new();
    while at + 12 <= src.len() {
        let len = u32le(&src.read(at, 12)?, 0);
        index.push((at + 12, len));
        at += 12 + len as u64;
    }
    Ok(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::{self, Codec, Series};
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("container-bench-{name}-{}", std::process::id()))
    }

    /// Odd and even lengths, one empty-ish, one large enough to pass a 64 KiB window.
    fn series(codec: Codec) -> Series {
        let lens = [7usize, 4096, 1, 70_001, 300, 2];
        let frames: Vec<Vec<u8>> = lens.iter().enumerate().map(|(i, &n)| (0..n).map(|b| (b * 31 + i * 7) as u8).collect()).collect();
        Series {
            codec,
            width: 64,
            height: 48,
            study: "1.2.3".into(),
            series: "1.2.3.4".into(),
            coded: frames.iter().map(|f| xxhash_rust::xxh3::xxh3_64(f)).collect(),
            samples: (0..frames.len() as u64).collect(),
            frames,
        }
    }

    fn round_trip(name: &str, kind: Container, write: impl Fn(&Series, &std::path::Path) -> Result<()>) {
        for codec in [Codec::Htj2k, Codec::Av1] {
            let s = series(codec);
            let path = scratch(name);
            write(&s, &path).unwrap();
            let bytes = std::fs::read(&path).unwrap();
            let got = index(kind, &Source::open(&path, false).unwrap()).unwrap();
            let cold = index(kind, &Source::open(&path, true).unwrap()).unwrap();
            let _ = std::fs::remove_file(&path);
            assert_eq!(got, cold, "{name}: the cold open read another table");
            assert_eq!(got.len(), s.frames.len(), "{name}: frame count");
            for (i, (&(at, len), want)) in got.iter().zip(&s.frames).enumerate() {
                assert_eq!(&bytes[at as usize..at as usize + len as usize], &want[..], "{name}: frame {i}");
            }
        }
    }

    /// Each of our packers writes a file whose own open finds every frame, byte for byte, warm and cold.
    #[test]
    fn every_packer_round_trips_through_its_open() {
        round_trip("sbnd2", Container::Sbnd2, pack::sbnd2);
        round_trip("mp4", Container::Mp4, pack::mp4);
        round_trip("fmp4-1", Container::Fmp4, |s, p| pack::fmp4(s, p, 1));
        round_trip("fmp4-4", Container::Fmp4, |s, p| pack::fmp4(s, p, 4));
        round_trip("mkv", Container::Mkv, pack::mkv);
        round_trip("mxf", Container::Mxf, pack::mxf);
        round_trip("ivf", Container::Ivf, pack::ivf);
    }

    /// The v1 open reads the table the product's own parser reads.
    #[test]
    fn the_sbnd1_open_agrees_with_the_product() {
        let s = series(Codec::Htj2k);
        let path = scratch("sbnd1");
        let frames: Vec<&[u8]> = s.frames.iter().map(|f| &f[..]).collect();
        series_bundle::write_bundle(&path, br#"{"frameCount":6}"#, &frames).unwrap();
        let ours = index(Container::Sbnd1, &Source::open(&path, false).unwrap()).unwrap();
        let theirs = series_bundle::read_layout(&std::fs::File::open(&path).unwrap()).unwrap().index;
        let _ = std::fs::remove_file(&path);
        assert_eq!(ours, theirs);
    }

    /// An open reads what it claims to: the v2 table is two reads, IVF one a frame plus its header.
    #[test]
    fn reads_are_counted_per_container() {
        let s = series(Codec::Av1);
        for (name, kind, reads) in [("sbnd2-r", Container::Sbnd2, 2u32), ("ivf-r", Container::Ivf, 1 + 6)] {
            let path = scratch(name);
            match kind {
                Container::Sbnd2 => pack::sbnd2(&s, &path),
                _ => pack::ivf(&s, &path),
            }
            .unwrap();
            let src = Source::open(&path, false).unwrap();
            index(kind, &src).unwrap();
            let _ = std::fs::remove_file(&path);
            assert_eq!(src.reads(), reads, "{name}");
        }
    }

    /// A table that points past the end of its file is refused at open.
    #[test]
    fn an_index_past_the_file_is_refused() {
        let s = series(Codec::Htj2k);
        let path = scratch("sbnd2-cut");
        pack::sbnd2(&s, &path).unwrap();
        let len = std::fs::metadata(&path).unwrap().len();
        std::fs::OpenOptions::new().write(true).open(&path).unwrap().set_len(len - 1).unwrap();
        let got = index(Container::Sbnd2, &Source::open(&path, false).unwrap());
        let _ = std::fs::remove_file(&path);
        assert!(got.is_err(), "a table running one byte past the file was accepted");
    }
    /// A moov laid out by hand with `stsc` runs of two samples then one, and 64-bit chunk offsets:
    /// the chunking FFmpeg writes and the table past 4 GiB, neither of which our packer emits.
    #[test]
    fn mp4_chunk_runs_and_co64_are_followed() {
        use crate::pack::{bx, fullbox};
        let frames: Vec<Vec<u8>> = (0..5u8).map(|i| vec![i; 3 + i as usize]).collect();
        for wide in [false, true] {
            let chunks: [&[usize]; 3] = [&[0, 1], &[2, 3], &[4]];
            let mut stsz = vec![0u8; 4];
            stsz.extend(5u32.to_be_bytes());
            frames.iter().for_each(|f| stsz.extend((f.len() as u32).to_be_bytes()));
            let mut stsc = 2u32.to_be_bytes().to_vec();
            for (first, per) in [(1u32, 2u32), (3, 1)] {
                for v in [first, per, 1] {
                    stsc.extend(v.to_be_bytes());
                }
            }
            let mdat_at = 4096u64;
            let mut co = 3u32.to_be_bytes().to_vec();
            let mut at = mdat_at + 8 + 100;
            let mut body = vec![0xEEu8; 100];
            for c in chunks {
                if wide {
                    co.extend(at.to_be_bytes());
                } else {
                    co.extend((at as u32).to_be_bytes());
                }
                for &i in c {
                    body.extend(&frames[i]);
                    at += frames[i].len() as u64;
                }
                body.extend([0xEE; 7]);
                at += 7;
            }
            let stbl = bx(b"stbl", &[fullbox(b"stsc", 0, 0, &stsc), fullbox(b"stsz", 0, 0, &stsz),
                fullbox(if wide { b"co64" } else { b"stco" }, 0, 0, &co)].concat());
            let mut hdlr = vec![0u8; 4];
            hdlr.extend(b"vide");
            hdlr.extend([0u8; 13]);
            let mdia = bx(b"mdia", &[fullbox(b"hdlr", 0, 0, &hdlr), bx(b"minf", &stbl)].concat());
            let moov = bx(b"moov", &bx(b"trak", &mdia));
            let mut file = bx(b"ftyp", b"isom");
            file.extend(moov);
            file.extend(bx(b"free", &vec![0u8; mdat_at as usize - file.len() - 8]));
            file.extend(bx(b"mdat", &body));
            let path = scratch(if wide { "mp4-co64" } else { "mp4-stco" });
            std::fs::write(&path, &file).unwrap();
            let got = index(Container::Mp4, &Source::open(&path, false).unwrap()).unwrap();
            let _ = std::fs::remove_file(&path);
            let read: Vec<&[u8]> = got.iter().map(|&(o, l)| &file[o as usize..o as usize + l as usize]).collect();
            assert_eq!(read, frames.iter().map(|f| &f[..]).collect::<Vec<_>>(), "co64 {wide}");
        }
    }

    fn dicom_element(tag: (u16, u16), vr: &[u8; 2], value: &[u8]) -> Vec<u8> {
        let mut b = tag.0.to_le_bytes().to_vec();
        b.extend(tag.1.to_le_bytes());
        b.extend(vr);
        if LONG_VRS.contains(&vr) {
            b.extend([0, 0]);
            b.extend((value.len() as u32).to_le_bytes());
        } else {
            b.extend((value.len() as u16).to_le_bytes());
        }
        b.extend(value);
        b
    }

    fn item(tag: u16, len: u32) -> Vec<u8> {
        let mut b = 0xFFFEu16.to_le_bytes().to_vec();
        b.extend(tag.to_le_bytes());
        b.extend(len.to_le_bytes());
        b
    }

    /// A file laid out by hand: a sequence of undefined length nested in an item of undefined length
    /// before the offset table, a Basic Offset Table that is not empty, and odd frames padded to even
    /// items — the open must land on each frame's first byte and stop at its true length.
    #[test]
    fn dicom_open_skips_nested_sequences_and_stops_at_true_lengths() {
        let frames: Vec<Vec<u8>> = vec![vec![1; 5], vec![2; 8], vec![3; 1]];
        let mut f = vec![0u8; 128];
        f.extend(b"DICM");
        f.extend(dicom_element((2, 0x10), b"UI", b"1.2.840.10008.1.2.4.201\0"));
        f.extend(dicom_element((8, 0x60), b"CS", b"CT"));
        let mut seq = 0x5200u16.to_le_bytes().to_vec();
        seq.extend(0x9230u16.to_le_bytes());
        seq.extend(b"SQ\0\0");
        seq.extend(u32::MAX.to_le_bytes());
        f.extend(seq);
        f.extend(item(0xE000, u32::MAX));
        f.extend(dicom_element((0x20, 0x32), b"DS", b"0\\0\\0 "));
        let mut inner = 0x0020u16.to_le_bytes().to_vec();
        inner.extend(0x9111u16.to_le_bytes());
        inner.extend(b"SQ\0\0");
        inner.extend(u32::MAX.to_le_bytes());
        f.extend(inner);
        f.extend(item(0xE000, 4));
        f.extend([9, 9, 9, 9]);
        f.extend(item(0xE0DD, 0));
        f.extend(item(0xE00D, 0));
        f.extend(item(0xE0DD, 0));
        let (mut offsets, mut lengths, mut at) = (Vec::new(), Vec::new(), 0u64);
        for fr in &frames {
            offsets.extend(at.to_le_bytes());
            lengths.extend((fr.len() as u64).to_le_bytes());
            at += 8 + fr.len() as u64 + fr.len() as u64 % 2;
        }
        f.extend(dicom_element((0x7FE0, 1), b"OV", &offsets));
        f.extend(dicom_element((0x7FE0, 2), b"OV", &lengths));
        let mut px = 0x7FE0u16.to_le_bytes().to_vec();
        px.extend(0x0010u16.to_le_bytes());
        px.extend(b"OB\0\0");
        px.extend(u32::MAX.to_le_bytes());
        f.extend(px);
        f.extend(item(0xE000, 4));
        f.extend([0xAA; 4]);
        for fr in &frames {
            let padded = fr.len() + fr.len() % 2;
            f.extend(item(0xE000, padded as u32));
            f.extend(fr);
            f.extend(vec![0u8; padded - fr.len()]);
        }
        f.extend(item(0xE0DD, 0));
        let path = scratch("dicom");
        std::fs::write(&path, &f).unwrap();
        let got = index(Container::Dicom, &Source::open(&path, false).unwrap()).unwrap();
        let _ = std::fs::remove_file(&path);
        let read: Vec<&[u8]> = got.iter().map(|&(o, l)| &f[o as usize..o as usize + l as usize]).collect();
        assert_eq!(read, frames.iter().map(|f| &f[..]).collect::<Vec<_>>());
    }
}
