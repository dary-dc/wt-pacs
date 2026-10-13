//! Our packers, one per arm: the frames in display order, back to back, behind each container's index.
//! Layouts and field choices: `docs/disk-layout/containers.md` §Measured.

use anyhow::{ensure, Context, Result};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Codec {
    Htj2k,
    Av1,
}

impl Codec {
    pub fn fourcc(self) -> &'static [u8; 4] {
        match self {
            Self::Htj2k => b"HTJ2",
            Self::Av1 => b"AV01",
        }
    }
}

pub struct Series {
    pub codec: Codec,
    pub width: u32,
    pub height: u32,
    pub study: String,
    pub series: String,
    pub frames: Vec<Vec<u8>>,
    pub coded: Vec<u64>,
    pub samples: Vec<u64>,
}

impl Series {
    /// Both UIDs NUL-padded to 64 B, then each frame's coded and samples XXH3-64: what the draft carries.
    pub fn identity(&self) -> Vec<u8> {
        let mut out = uid64(&self.study);
        out.extend(uid64(&self.series));
        for (c, s) in self.coded.iter().zip(&self.samples) {
            out.extend(c.to_le_bytes());
            out.extend(s.to_le_bytes());
        }
        out
    }
}

fn uid64(uid: &str) -> Vec<u8> {
    let mut b = uid.as_bytes().to_vec();
    b.resize(64, 0);
    b
}

fn write_all(path: &Path, head: &[u8], frames: &[Vec<u8>], per_frame: impl Fn(usize) -> Vec<u8>, tail: &[u8]) -> Result<()> {
    let mut out = BufWriter::with_capacity(1 << 20, File::create(path).with_context(|| format!("create {}", path.display()))?);
    out.write_all(head)?;
    for (i, f) in frames.iter().enumerate() {
        out.write_all(&per_frame(i))?;
        out.write_all(f)?;
    }
    out.write_all(tail)?;
    out.flush()?;
    Ok(())
}

// ---- .sbnd v2, layout 0 (docs/disk-layout/target.md) ----

pub const SBND2_HEADER: usize = 148;
pub const SBND2_ENTRY: usize = 28;

pub fn sbnd2(s: &Series, path: &Path) -> Result<()> {
    let n = s.frames.len();
    let mut head = Vec::with_capacity(SBND2_HEADER + SBND2_ENTRY * n);
    head.extend(b"SBND");
    head.extend(2u32.to_le_bytes());
    head.extend(s.codec.fourcc());
    head.extend(0u32.to_le_bytes());
    head.extend((n as u32).to_le_bytes());
    head.extend(uid64(&s.study));
    head.extend(uid64(&s.series));
    let mut at = (SBND2_HEADER + SBND2_ENTRY * n) as u64;
    for (i, f) in s.frames.iter().enumerate() {
        head.extend(at.to_le_bytes());
        head.extend((f.len() as u32).to_le_bytes());
        head.extend(s.coded[i].to_le_bytes());
        head.extend(s.samples[i].to_le_bytes());
        at += f.len() as u64;
    }
    write_all(path, &head, &s.frames, |_| Vec::new(), &[])
}

// ---- ISOBMFF ----

pub(crate) fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut b = Vec::with_capacity(8 + body.len());
    b.extend((8 + body.len() as u32).to_be_bytes());
    b.extend(kind);
    b.extend(body);
    b
}

pub(crate) fn fullbox(kind: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut b = vec![version];
    b.extend(&flags.to_be_bytes()[1..]);
    b.extend(body);
    bx(kind, &b)
}

fn cat(parts: &[Vec<u8>]) -> Vec<u8> {
    parts.concat()
}

/// Uuid of the box that carries `Series::identity` in both MP4 arms; no standard field holds it.
const IDENTITY_UUID: [u8; 16] = *b"wt-pacs:identity";

const MATRIX: [u32; 9] = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000];

fn mvhd(duration: u32) -> Vec<u8> {
    let mut b = Vec::new();
    for v in [0u32, 0, 1, duration, 0x10000] {
        b.extend(v.to_be_bytes());
    }
    b.extend(0x0100u16.to_be_bytes());
    b.extend([0u8; 10]);
    MATRIX.iter().for_each(|m| b.extend(m.to_be_bytes()));
    b.extend([0u8; 24]);
    b.extend(2u32.to_be_bytes());
    fullbox(b"mvhd", 0, 0, &b)
}

fn trak(s: &Series, duration: u32, stbl_tables: Vec<u8>) -> Vec<u8> {
    let mut tk = Vec::new();
    for v in [0u32, 0, 1, 0, duration, 0, 0] {
        tk.extend(v.to_be_bytes());
    }
    tk.extend([0u8; 8]);
    MATRIX.iter().for_each(|m| tk.extend(m.to_be_bytes()));
    tk.extend((s.width << 16).to_be_bytes());
    tk.extend((s.height << 16).to_be_bytes());
    let mut md = Vec::new();
    for v in [0u32, 0, 1, duration] {
        md.extend(v.to_be_bytes());
    }
    md.extend(0x55c4u16.to_be_bytes());
    md.extend(0u16.to_be_bytes());
    let mut hd = vec![0u8; 4];
    hd.extend(b"vide");
    hd.extend([0u8; 12]);
    hd.extend(b"VideoHandler\0");
    let mut entry = vec![0u8; 6];
    entry.extend(1u16.to_be_bytes());
    entry.extend([0u8; 16]);
    entry.extend((s.width as u16).to_be_bytes());
    entry.extend((s.height as u16).to_be_bytes());
    entry.extend(0x0048_0000u32.to_be_bytes());
    entry.extend(0x0048_0000u32.to_be_bytes());
    entry.extend(0u32.to_be_bytes());
    entry.extend(1u16.to_be_bytes());
    entry.extend([0u8; 32]);
    entry.extend(0x0018u16.to_be_bytes());
    entry.extend((-1i16).to_be_bytes());
    let fourcc: &[u8; 4] = match s.codec {
        Codec::Htj2k => b"mjp2",
        Codec::Av1 => b"sbav",
    };
    let mut stsd = 1u32.to_be_bytes().to_vec();
    stsd.extend(bx(fourcc, &entry));
    let stbl = bx(b"stbl", &cat(&[fullbox(b"stsd", 0, 0, &stsd), stbl_tables]));
    let mut dref = 1u32.to_be_bytes().to_vec();
    dref.extend(fullbox(b"url ", 0, 1, &[]));
    let minf = bx(b"minf", &cat(&[fullbox(b"vmhd", 0, 1, &[0u8; 8]), bx(b"dinf", &fullbox(b"dref", 0, 0, &dref)), stbl]));
    let mdia = bx(b"mdia", &cat(&[fullbox(b"mdhd", 0, 0, &md), fullbox(b"hdlr", 0, 0, &hd), minf]));
    bx(b"trak", &cat(&[fullbox(b"tkhd", 0, 3, &tk), mdia]))
}

fn identity_box(s: &Series) -> Vec<u8> {
    let mut b = IDENTITY_UUID.to_vec();
    b.extend(s.identity());
    bx(b"uuid", &b)
}

fn ftyp() -> Vec<u8> {
    bx(b"ftyp", &cat(&[b"isom".to_vec(), 0x200u32.to_be_bytes().to_vec(), b"isomiso6mp41".to_vec()]))
}

fn table(entries: impl IntoIterator<Item = Vec<u8>>) -> Vec<u8> {
    let mut n = 0u32;
    let mut body = Vec::new();
    for e in entries {
        body.extend(e);
        n += 1;
    }
    cat(&[n.to_be_bytes().to_vec(), body])
}

fn stbl_progressive(s: &Series, offsets: &[u64], wide: bool) -> Vec<u8> {
    let n = s.frames.len() as u32;
    let stts = table([cat(&[n.to_be_bytes().to_vec(), 1u32.to_be_bytes().to_vec()])]);
    let stsc = table([cat(&[1u32.to_be_bytes().to_vec(), 1u32.to_be_bytes().to_vec(), 1u32.to_be_bytes().to_vec()])]);
    let stsz = cat(&[0u32.to_be_bytes().to_vec(), table(s.frames.iter().map(|f| (f.len() as u32).to_be_bytes().to_vec()))]);
    let chunks = if wide {
        fullbox(b"co64", 0, 0, &table(offsets.iter().map(|o| o.to_be_bytes().to_vec())))
    } else {
        fullbox(b"stco", 0, 0, &table(offsets.iter().map(|&o| (o as u32).to_be_bytes().to_vec())))
    };
    cat(&[fullbox(b"stts", 0, 0, &stts), fullbox(b"stsc", 0, 0, &stsc), fullbox(b"stsz", 0, 0, &stsz), chunks])
}

/// Progressive MP4, `moov` first, one sample a chunk; `co64` once an offset passes 4 GiB.
pub fn mp4(s: &Series, path: &Path) -> Result<()> {
    let n = s.frames.len();
    let total: u64 = s.frames.iter().map(|f| f.len() as u64).sum();
    let mdat_head = if total + 8 > u32::MAX as u64 { 16 } else { 8 };
    let moov_for = |offsets: &[u64], wide| {
        bx(b"moov", &cat(&[mvhd(n as u32), trak(s, n as u32, stbl_progressive(s, offsets, wide)), identity_box(s)]))
    };
    let zeros = vec![0u64; n];
    let narrow_len = moov_for(&zeros, false).len() as u64;
    let wide = ftyp().len() as u64 + narrow_len + mdat_head + total > u32::MAX as u64;
    let data = ftyp().len() as u64 + moov_for(&zeros, wide).len() as u64 + mdat_head;
    let offsets: Vec<u64> = s.frames.iter().scan(data, |at, f| {
        let o = *at;
        *at += f.len() as u64;
        Some(o)
    }).collect();
    let mut head = cat(&[ftyp(), moov_for(&offsets, wide)]);
    if mdat_head == 16 {
        head.extend(1u32.to_be_bytes());
        head.extend(b"mdat");
        head.extend((16 + total).to_be_bytes());
    } else {
        head.extend((8 + total as u32).to_be_bytes());
        head.extend(b"mdat");
    }
    ensure!(head.len() as u64 == data, "moov changed size once its offsets were filled");
    write_all(path, &head, &s.frames, |_| Vec::new(), &[])
}

/// Fragmented MP4: `per` frames a fragment, each `moof` + `mdat`, behind one global `sidx`.
pub fn fmp4(s: &Series, path: &Path, per: usize) -> Result<()> {
    let empty = cat(&[
        fullbox(b"stts", 0, 0, &table([])),
        fullbox(b"stsc", 0, 0, &table([])),
        fullbox(b"stsz", 0, 0, &cat(&[0u32.to_be_bytes().to_vec(), table([])])),
        fullbox(b"stco", 0, 0, &table([])),
    ]);
    let mut trex = Vec::new();
    for v in [1u32, 1, 1, 0, 0] {
        trex.extend(v.to_be_bytes());
    }
    let mvex = bx(b"mvex", &fullbox(b"trex", 0, 0, &trex));
    let moov = bx(b"moov", &cat(&[mvhd(0), trak(s, 0, empty), mvex, identity_box(s)]));
    let groups: Vec<&[Vec<u8>]> = s.frames.chunks(per.max(1)).collect();
    let mut frags = Vec::with_capacity(groups.len());
    let mut first = 0u64;
    for (k, g) in groups.iter().enumerate() {
        let trun_len = 8 + 4 + 4 + 4 + 4 * g.len();
        let moof_len = 8 + 16 + 8 + 16 + 20 + trun_len;
        let mut trun = (g.len() as u32).to_be_bytes().to_vec();
        trun.extend(((moof_len + 8) as i32).to_be_bytes());
        g.iter().for_each(|f| trun.extend((f.len() as u32).to_be_bytes()));
        let traf = bx(b"traf", &cat(&[
            fullbox(b"tfhd", 0, 0x020000, &1u32.to_be_bytes()),
            fullbox(b"tfdt", 1, 0, &first.to_be_bytes()),
            fullbox(b"trun", 0, 0x000201, &trun),
        ]));
        let moof = bx(b"moof", &cat(&[fullbox(b"mfhd", 0, 0, &(k as u32 + 1).to_be_bytes()), traf]));
        ensure!(moof.len() == moof_len, "moof is {} B, planned {moof_len}", moof.len());
        let payload: u64 = g.iter().map(|f| f.len() as u64).sum();
        ensure!(payload + 8 <= u32::MAX as u64, "a fragment over 4 GiB");
        let mut head = moof;
        head.extend((8 + payload as u32).to_be_bytes());
        head.extend(b"mdat");
        frags.push((head, payload, g.len() as u32));
        first += g.len() as u64;
    }
    let mut sidx = 1u32.to_be_bytes().to_vec();
    sidx.extend(1u32.to_be_bytes());
    sidx.extend(0u64.to_be_bytes());
    sidx.extend(0u64.to_be_bytes());
    sidx.extend(0u16.to_be_bytes());
    sidx.extend((frags.len() as u16).to_be_bytes());
    ensure!(frags.len() <= u16::MAX as usize, "more fragments than one sidx counts");
    for (head, payload, count) in &frags {
        let size = head.len() as u64 + payload;
        ensure!(size < 1 << 31, "a fragment over sidx's 31-bit size");
        sidx.extend((size as u32).to_be_bytes());
        sidx.extend(count.to_be_bytes());
        sidx.extend((0x9000_0000u32).to_be_bytes());
    }
    let head = cat(&[ftyp(), moov, fullbox(b"sidx", 1, 0, &sidx)]);
    let mut out = BufWriter::with_capacity(1 << 20, File::create(path)?);
    out.write_all(&head)?;
    for ((fhead, _, _), g) in frags.iter().zip(&groups) {
        out.write_all(fhead)?;
        for f in g.iter() {
            out.write_all(f)?;
        }
    }
    out.flush()?;
    Ok(())
}

// ---- Matroska ----

/// EBML's variable-length size, in `width` bytes (1..=8), or the narrowest that holds `n`.
pub fn vint(n: u64, width: Option<usize>) -> Vec<u8> {
    let w = width.unwrap_or_else(|| (1..=8).find(|&w| n < (1u64 << (7 * w)) - 1).expect("vint over 56 bits"));
    let mut b = n.to_be_bytes()[8 - w..].to_vec();
    b[0] |= 0x80 >> (w - 1);
    b
}

fn el(id: &[u8], body: &[u8]) -> Vec<u8> {
    cat(&[id.to_vec(), vint(body.len() as u64, None), body.to_vec()])
}

fn uint(id: &[u8], v: u64) -> Vec<u8> {
    el(id, &v.to_be_bytes())
}

const CLUSTER_PAYLOAD: u64 = 5 << 20;

/// Matroska, Cues before the Clusters, one cue a frame with `CueRelativePosition`.
pub fn mkv(s: &Series, path: &Path) -> Result<()> {
    let ebml = el(&[0x1A, 0x45, 0xDF, 0xA3], &cat(&[
        uint(&[0x42, 0x86], 1), uint(&[0x42, 0xF7], 1), uint(&[0x42, 0xF2], 4), uint(&[0x42, 0xF3], 8),
        el(&[0x42, 0x82], b"matroska"), uint(&[0x42, 0x87], 4), uint(&[0x42, 0x85], 2),
    ]));
    let info = el(&[0x15, 0x49, 0xA9, 0x66], &cat(&[
        uint(&[0x2A, 0xD7, 0xB1], 1_000_000), el(&[0x4D, 0x80], b"container-bench"), el(&[0x57, 0x41], b"container-bench"),
    ]));
    let mut bih = Vec::new();
    for v in [40u32, s.width, s.height] {
        bih.extend(v.to_le_bytes());
    }
    bih.extend(1u16.to_le_bytes());
    bih.extend(24u16.to_le_bytes());
    bih.extend(match s.codec {
        Codec::Htj2k => b"MJP2",
        Codec::Av1 => b"SBAV",
    });
    bih.extend([0u8; 20]);
    let tracks = el(&[0x16, 0x54, 0xAE, 0x6B], &el(&[0xAE], &cat(&[
        uint(&[0xD7], 1), uint(&[0x73, 0xC5], 1), uint(&[0x83], 1), uint(&[0x9C], 0),
        el(&[0x86], b"V_MS/VFW/FOURCC"), el(&[0x63, 0xA2], &bih),
        el(&[0xE0], &cat(&[uint(&[0xB0], s.width as u64), uint(&[0xBA], s.height as u64)])),
    ])));
    let tags = el(&[0x12, 0x54, 0xC3, 0x67], &el(&[0x73, 0x73], &cat(&[
        el(&[0x63, 0xC0], &[]),
        el(&[0x67, 0xC8], &cat(&[el(&[0x45, 0xA3], b"WTPACS_IDENTITY"), el(&[0x44, 0x85], &s.identity())])),
    ])));

    let mut clusters: Vec<(usize, usize)> = Vec::new();
    let mut start = 0;
    let mut bytes = 0u64;
    for (i, f) in s.frames.iter().enumerate() {
        if i > start && (bytes + f.len() as u64 > CLUSTER_PAYLOAD || i - start >= 32_000) {
            clusters.push((start, i));
            start = i;
            bytes = 0;
        }
        bytes += f.len() as u64;
    }
    clusters.push((start, s.frames.len()));
    let block_head = |f: &Vec<u8>| cat(&[vec![0xA3], vint(f.len() as u64 + 4, None)]);
    let cue_point = |t: u64, cluster: u64, rel: u64| el(&[0xBB], &cat(&[
        uint(&[0xB3], t), el(&[0xB7], &cat(&[uint(&[0xF7], 1), uint(&[0xF1], cluster), uint(&[0xF0], rel)])),
    ]));
    let cues_len = el(&[0x1C, 0x53, 0xBB, 0x6B], &vec![0u8; s.frames.len() * cue_point(0, 0, 0).len()]).len() as u64;
    let mut at = (info.len() + tracks.len() + tags.len()) as u64 + cues_len;
    let mut points = Vec::new();
    let mut heads = Vec::with_capacity(clusters.len());
    for &(a, b) in &clusters {
        let ts = uint(&[0xE7], a as u64);
        let mut body = ts.len() as u64;
        for (i, f) in s.frames[a..b].iter().enumerate() {
            points.push(cue_point((a + i) as u64, at, body));
            body += block_head(f).len() as u64 + 4 + f.len() as u64;
        }
        let mut head = vec![0x1F, 0x43, 0xB6, 0x75];
        head.extend(vint(body, Some(8)));
        head.extend(ts);
        at += 12 + body;
        heads.push(head);
    }
    let cues = el(&[0x1C, 0x53, 0xBB, 0x6B], &points.concat());
    ensure!(cues.len() as u64 == cues_len, "Cues changed size once filled");
    let mut out = BufWriter::with_capacity(1 << 20, File::create(path)?);
    out.write_all(&ebml)?;
    out.write_all(&[0x18, 0x53, 0x80, 0x67])?;
    out.write_all(&vint(at, Some(8)))?;
    for part in [&info, &tracks, &tags, &cues] {
        out.write_all(part)?;
    }
    for (&(a, b), head) in clusters.iter().zip(&heads) {
        out.write_all(head)?;
        for (i, f) in s.frames[a..b].iter().enumerate() {
            out.write_all(&block_head(f))?;
            out.write_all(&[0x81])?;
            out.write_all(&(i as i16).to_be_bytes())?;
            out.write_all(&[0x80])?;
            out.write_all(f)?;
        }
    }
    out.flush()?;
    Ok(())
}

// ---- MXF OP1a, frame-wrapped, KAG 1, the index in the footer ----

pub const MXF_PREFIX: [u8; 4] = [0x06, 0x0E, 0x2B, 0x34];

fn ber(n: u64) -> Vec<u8> {
    if n < 1 << 24 {
        cat(&[vec![0x83], n.to_be_bytes()[5..].to_vec()])
    } else {
        cat(&[vec![0x88], n.to_be_bytes().to_vec()])
    }
}

fn klv(key: &[u8; 16], value: &[u8]) -> Vec<u8> {
    cat(&[key.to_vec(), ber(value.len() as u64), value.to_vec()])
}

fn partition_key(kind: u8) -> [u8; 16] {
    [0x06, 0x0E, 0x2B, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0D, 0x01, 0x02, 0x01, 0x01, kind, 0x04, 0x00]
}

const OP1A: [u8; 16] = [0x06, 0x0E, 0x2B, 0x34, 0x04, 0x01, 0x01, 0x01, 0x0D, 0x01, 0x02, 0x01, 0x01, 0x01, 0x09, 0x00];
const J2K_FRAME_WRAPPED: [u8; 16] = [0x06, 0x0E, 0x2B, 0x34, 0x04, 0x01, 0x01, 0x07, 0x0D, 0x01, 0x03, 0x01, 0x02, 0x0C, 0x01, 0x00];
pub const INDEX_KEY: [u8; 16] = [0x06, 0x0E, 0x2B, 0x34, 0x02, 0x53, 0x01, 0x01, 0x0D, 0x01, 0x02, 0x01, 0x01, 0x10, 0x01, 0x00];
pub const RIP_KEY: [u8; 16] = [0x06, 0x0E, 0x2B, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0D, 0x01, 0x02, 0x01, 0x01, 0x11, 0x01, 0x00];
/// A picture element, frame-wrapped; AV1 has no MXF mapping and rides under the same key, opaquely.
const PICTURE_ELEMENT: [u8; 16] = [0x06, 0x0E, 0x2B, 0x34, 0x01, 0x02, 0x01, 0x01, 0x0D, 0x01, 0x03, 0x01, 0x15, 0x01, 0x08, 0x01];
/// Dark metadata under a private key: the identity has no MXF field.
const IDENTITY_KEY: [u8; 16] = [0x06, 0x0E, 0x2B, 0x34, 0x01, 0x01, 0x01, 0x01, 0x0F, 0x7F, 0x7F, 0x7F, 0x7F, 0x7F, 0x7F, 0x7F];
/// Entries a local set's u16 length holds.
const INDEX_ENTRIES_PER_SEGMENT: usize = 5_000;

#[allow(clippy::too_many_arguments)]
fn partition(kind: u8, this: u64, prev: u64, footer: u64, header_bytes: u64, index_bytes: u64, index_sid: u32, body_sid: u32) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend(1u16.to_be_bytes());
    v.extend(3u16.to_be_bytes());
    v.extend(1u32.to_be_bytes());
    for x in [this, prev, footer, header_bytes, index_bytes] {
        v.extend(x.to_be_bytes());
    }
    v.extend(index_sid.to_be_bytes());
    v.extend(0u64.to_be_bytes());
    v.extend(body_sid.to_be_bytes());
    v.extend(OP1A);
    v.extend(1u32.to_be_bytes());
    v.extend(16u32.to_be_bytes());
    v.extend(J2K_FRAME_WRAPPED);
    klv(&partition_key(kind), &v)
}

fn local(tag: u16, value: &[u8]) -> Vec<u8> {
    cat(&[tag.to_be_bytes().to_vec(), (value.len() as u16).to_be_bytes().to_vec(), value.to_vec()])
}

/// Our MXF: partition packs, the essence and a footer index, no structural header metadata —
/// a layout to time, not a file a player opens.
pub fn mxf(s: &Series, path: &Path) -> Result<()> {
    let identity = klv(&IDENTITY_KEY, &s.identity());
    let header_len = partition(0x02, 0, 0, 0, 0, 0, 0, 0).len() as u64;
    let body_at = header_len + identity.len() as u64;
    let body_len = partition(0x03, 0, 0, 0, 0, 0, 0, 1).len() as u64;
    let mut offsets = Vec::with_capacity(s.frames.len());
    let mut essence = 0u64;
    for f in &s.frames {
        offsets.push(essence);
        essence += 16 + ber(f.len() as u64).len() as u64 + f.len() as u64;
    }
    let footer_at = body_at + body_len + essence;
    let mut index = Vec::new();
    for (k, chunk) in offsets.chunks(INDEX_ENTRIES_PER_SEGMENT).enumerate() {
        let mut entries = (chunk.len() as u32).to_be_bytes().to_vec();
        entries.extend(11u32.to_be_bytes());
        for o in chunk {
            entries.extend([0u8, 0, 0x80]);
            entries.extend(o.to_be_bytes());
        }
        let start = (k * INDEX_ENTRIES_PER_SEGMENT) as i64;
        let set = cat(&[
            local(0x3C0A, &[k as u8; 16]),
            local(0x3F0B, &cat(&[1i32.to_be_bytes().to_vec(), 1i32.to_be_bytes().to_vec()])),
            local(0x3F0C, &start.to_be_bytes()),
            local(0x3F0D, &(chunk.len() as i64).to_be_bytes()),
            local(0x3F05, &0u32.to_be_bytes()),
            local(0x3F06, &1u32.to_be_bytes()),
            local(0x3F07, &1u32.to_be_bytes()),
            local(0x3F08, &[0u8]),
            local(0x3F0A, &entries),
        ]);
        index.extend(klv(&INDEX_KEY, &set));
    }
    let head = cat(&[
        partition(0x02, 0, 0, footer_at, identity.len() as u64, 0, 0, 0),
        identity,
        partition(0x03, body_at, 0, footer_at, 0, 0, 0, 1),
    ]);
    ensure!(head.len() as u64 == body_at + body_len, "the header moved");
    let mut tail = partition(0x04, footer_at, body_at, footer_at, 0, index.len() as u64, 1, 0);
    tail.extend(&index);
    let mut rip = Vec::new();
    for (sid, at) in [(0u32, 0u64), (1, body_at), (0, footer_at)] {
        rip.extend(sid.to_be_bytes());
        rip.extend(at.to_be_bytes());
    }
    let rip_len = 16 + 4 + rip.len() + 4;
    rip.extend((rip_len as u32).to_be_bytes());
    tail.extend(&RIP_KEY);
    tail.extend(&ber(rip.len() as u64)[..]);
    tail.extend(rip);
    write_all(path, &head, &s.frames, |i| cat(&[PICTURE_ELEMENT.to_vec(), ber(s.frames[i].len() as u64)]), &tail)
}

// ---- IVF, the no-index bound ----

pub fn ivf(s: &Series, path: &Path) -> Result<()> {
    let mut head = b"DKIF".to_vec();
    head.extend(0u16.to_le_bytes());
    head.extend(32u16.to_le_bytes());
    head.extend(b"AV01");
    head.extend((s.width as u16).to_le_bytes());
    head.extend((s.height as u16).to_le_bytes());
    head.extend(1u32.to_le_bytes());
    head.extend(1u32.to_le_bytes());
    head.extend((s.frames.len() as u32).to_le_bytes());
    head.extend(0u32.to_le_bytes());
    write_all(path, &head, &s.frames, |i| cat(&[(s.frames[i].len() as u32).to_le_bytes().to_vec(), (i as u64).to_le_bytes().to_vec()]), &[])
}
