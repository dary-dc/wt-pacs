//! `tail-merge build FILE front|end N` packs N synthetic frames as a layout-0 series;
//! `tail-merge merge FILE front|end full|tail AT durable|warm` inserts one late frame before entry AT,
//! stages the result in `<dir>/incoming/`, reads back what it wrote, and renames it over FILE.
//! `merge` prints one JSON line. The format and the arms: ../README.md.

use anyhow::{bail, ensure, Context, Result};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::os::unix::fs::{FileExt, OpenOptionsExt};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::time::Instant;

const ENTRY: usize = 28;
const SLACK: usize = 64;
const BLOCK: u64 = 4096;
const CHUNK: usize = 1 << 20;
const MEAN_FRAME: u64 = 264_000;

#[derive(Clone, Copy, PartialEq)]
enum Place {
    Front,
    End,
}

#[derive(Clone, Copy)]
struct Entry {
    offset: u64,
    length: u32,
    coded: u64,
    samples: u64,
}

struct Series {
    place: Place,
    capacity: usize,
    entries: Vec<Entry>,
}

impl Place {
    fn parse(s: &str) -> Result<Self> {
        match s {
            "front" => Ok(Place::Front),
            "end" => Ok(Place::End),
            _ => bail!("index place is front or end, not {s}"),
        }
    }

    /// The target's 148 B header; the front placement adds a u32 capacity.
    fn header_len(self) -> u64 {
        match self {
            Place::Front => 152,
            Place::End => 148,
        }
    }
}

impl Series {
    fn data_base(&self) -> u64 {
        match self.place {
            Place::Front => self.place.header_len() + (self.capacity * ENTRY) as u64,
            Place::End => self.place.header_len(),
        }
    }

    fn data_end(&self) -> u64 {
        self.data_base() + self.entries.iter().map(|e| u64::from(e.length)).sum::<u64>()
    }

    fn header(&self) -> Vec<u8> {
        let mut h = Vec::with_capacity(self.place.header_len() as usize);
        h.extend_from_slice(b"SBND");
        h.extend_from_slice(&2u32.to_le_bytes());
        h.extend_from_slice(b"HTJ2");
        h.extend_from_slice(&0u32.to_le_bytes());
        h.extend_from_slice(&(self.entries.len() as u32).to_le_bytes());
        if self.place == Place::Front {
            h.extend_from_slice(&(self.capacity as u32).to_le_bytes());
        }
        for uid in [&b"1.2.826.0.1.3680043.2.1125.1"[..], &b"1.2.826.0.1.3680043.2.1125.2"[..]] {
            let mut field = [0u8; 64];
            field[..uid.len()].copy_from_slice(uid);
            h.extend_from_slice(&field);
        }
        h
    }

    /// The front placement writes all `capacity` slots, the unused ones zero.
    fn index(&self) -> Vec<u8> {
        let slots = if self.place == Place::Front { self.capacity } else { self.entries.len() };
        let mut out = vec![0u8; slots * ENTRY];
        for (e, slot) in self.entries.iter().zip(out.chunks_exact_mut(ENTRY)) {
            slot[0..8].copy_from_slice(&e.offset.to_le_bytes());
            slot[8..12].copy_from_slice(&e.length.to_le_bytes());
            slot[12..20].copy_from_slice(&e.coded.to_le_bytes());
            slot[20..28].copy_from_slice(&e.samples.to_le_bytes());
        }
        out
    }

    fn lay_out(&mut self) {
        let mut offset = self.data_base();
        for e in &mut self.entries {
            e.offset = offset;
            offset += u64::from(e.length);
        }
    }

    fn read(file: &File, place: Place) -> Result<Self> {
        let size = file.metadata()?.len();
        let mut head = vec![0u8; place.header_len() as usize];
        file.read_exact_at(&mut head, 0).context("read header")?;
        ensure!(&head[0..4] == b"SBND" && head[4..8] == 2u32.to_le_bytes(), "not a version-2 series");
        let n = u32::from_le_bytes(head[16..20].try_into()?) as usize;
        let (capacity, at) = match place {
            Place::Front => (u32::from_le_bytes(head[20..24].try_into()?) as usize, place.header_len()),
            Place::End => (n, size.checked_sub((n * ENTRY) as u64).context("index past the file's start")?),
        };
        ensure!(n <= capacity, "{n} entries in a {capacity}-entry index");
        let mut raw = vec![0u8; n * ENTRY];
        file.read_exact_at(&mut raw, at).context("read index")?;
        let entries = raw
            .chunks_exact(ENTRY)
            .map(|s| Entry {
                offset: u64::from_le_bytes(s[0..8].try_into().unwrap()),
                length: u32::from_le_bytes(s[8..12].try_into().unwrap()),
                coded: u64::from_le_bytes(s[12..20].try_into().unwrap()),
                samples: u64::from_le_bytes(s[20..28].try_into().unwrap()),
            })
            .collect();
        let series = Series { place, capacity, entries };
        ensure!(series.data_end() <= size, "frames past the file's end");
        Ok(series)
    }
}

/// Deterministic frame `id`: length within ±20 % of `MEAN_FRAME`, xorshift bytes.
fn frame(id: u64) -> Vec<u8> {
    let mut x = id.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut next = || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    let len = MEAN_FRAME * 8 / 10 + next() % (MEAN_FRAME * 4 / 10);
    let mut out = Vec::with_capacity(len as usize + 8);
    while (out.len() as u64) < len {
        out.extend_from_slice(&next().to_le_bytes());
    }
    out.truncate(len as usize);
    out
}

fn entry(id: u64, len: usize) -> Entry {
    Entry { offset: 0, length: len as u32, coded: id, samples: !id }
}

fn build(path: &Path, place: Place, n: usize) -> Result<()> {
    let frames: Vec<Vec<u8>> = (0..n as u64).map(frame).collect();
    let entries = frames.iter().enumerate().map(|(i, f)| entry(i as u64, f.len())).collect();
    let mut series = Series { place, capacity: n + SLACK, entries };
    series.lay_out();
    let mut out = BufWriter::with_capacity(CHUNK, File::create(path)?);
    out.write_all(&series.header())?;
    if place == Place::Front {
        out.write_all(&series.index())?;
    }
    frames.iter().try_for_each(|f| out.write_all(f))?;
    if place == Place::End {
        out.write_all(&series.index())?;
    }
    out.into_inner()?.sync_all()?;
    Ok(())
}

/// Cheap enough not to bound the read-back; it only has to tell a wrong byte.
fn digest(acc: u64, bytes: &[u8]) -> u64 {
    bytes.iter().fold(acc, |h, &b| (h ^ u64::from(b)).wrapping_mul(0x100_0000_01B3))
}

#[derive(Default)]
struct Tally {
    read: u64,
    written: u64,
    readback: u64,
    clone: &'static str,
    clone_ns: u128,
}

const SEED: u64 = 0xCBF2_9CE4_8422_2325;

/// Every write of the merge goes through here, gathered into contiguous runs, so the read-back checks
/// exactly what was written.
struct Staged {
    file: File,
    runs: Vec<Run>,
}

struct Run {
    at: u64,
    len: u64,
    digest: u64,
}

impl Staged {
    fn write_at(&mut self, bytes: &[u8], at: u64, tally: &mut Tally) -> Result<()> {
        self.file.write_all_at(bytes, at)?;
        tally.written += bytes.len() as u64;
        match self.runs.last_mut() {
            Some(run) if run.at + run.len == at => {
                run.len += bytes.len() as u64;
                run.digest = digest(run.digest, bytes);
            }
            _ => self.runs.push(Run { at, len: bytes.len() as u64, digest: digest(SEED, bytes) }),
        }
        Ok(())
    }
}

/// An `O_DIRECT` buffer: aligned to the block, as the kernel requires.
struct Aligned(*mut u8);

impl Aligned {
    fn layout() -> std::alloc::Layout {
        std::alloc::Layout::from_size_align(CHUNK, BLOCK as usize).unwrap()
    }

    fn new() -> Self {
        // SAFETY: the layout has a non-zero size; Drop frees it with the same layout.
        Aligned(unsafe { std::alloc::alloc(Self::layout()) })
    }

    fn bytes(&mut self) -> &mut [u8] {
        // SAFETY: `self.0` owns CHUNK bytes until Drop, and `&mut self` makes this the only view.
        unsafe { std::slice::from_raw_parts_mut(self.0, CHUNK) }
    }
}

impl Drop for Aligned {
    fn drop(&mut self) {
        // SAFETY: allocated in `new` with this layout, freed once.
        unsafe { std::alloc::dealloc(self.0, Self::layout()) }
    }
}

/// Reads back the blocks under every run — from the disk when `durable` (`O_DIRECT`), else from the cache.
fn read_back(path: &Path, runs: &[Run], durable: bool, tally: &mut Tally) -> Result<()> {
    let mut opts = OpenOptions::new();
    opts.read(true);
    if durable {
        opts.custom_flags(libc::O_DIRECT);
    }
    let file = opts.open(path)?;
    let mut buf = Aligned::new();
    let buf = buf.bytes();
    for run in runs {
        let end = run.at + run.len;
        let mut pos = run.at / BLOCK * BLOCK;
        let mut h = SEED;
        while pos < end {
            let want = CHUNK.min(((end - pos).div_ceil(BLOCK) * BLOCK) as usize);
            let got = file.read_at(&mut buf[..want], pos)?;
            ensure!(got > 0, "the staged file ends at {pos}, before {end}");
            tally.readback += got as u64;
            let from = run.at.max(pos);
            let to = end.min(pos + got as u64);
            h = digest(h, &buf[(from - pos) as usize..(to - pos) as usize]);
            pos += got as u64;
        }
        ensure!(h == run.digest, "read-back of {}..{end} differs from what was written", run.at);
    }
    Ok(())
}

/// `ioctl(FICLONE)`: `_IOW(0x94, 9, int)`.
const FICLONE: libc::c_ulong = 0x4004_9409;

/// Shares every extent of `from` into `to`; on a filesystem without reflinks, copies `[base, point)` instead.
fn clone_or_copy(to: &File, from: &File, base: u64, point: u64, tally: &mut Tally) -> Result<bool> {
    let started = Instant::now();
    // SAFETY: both descriptors are open for the whole call; FICLONE reads no memory of ours.
    let cloned = unsafe { libc::ioctl(to.as_raw_fd(), FICLONE, from.as_raw_fd()) } == 0;
    if !cloned {
        let (mut off_in, mut off_out) = (base as i64, base as i64);
        while (off_in as u64) < point {
            let left = (point - off_in as u64) as usize;
            // SAFETY: the offsets are ours and live across the call; both descriptors are open.
            let n = unsafe { libc::copy_file_range(from.as_raw_fd(), &mut off_in, to.as_raw_fd(), &mut off_out, left, 0) };
            ensure!(n > 0, "copy_file_range: {}", std::io::Error::last_os_error());
        }
        tally.written += point - base;
        tally.read += point - base;
    }
    tally.clone = if cloned { "ficlone" } else { "copy_file_range" };
    tally.clone_ns = started.elapsed().as_nanos();
    Ok(cloned)
}

/// The digest of `[pos, end)` of `file`, for the read-back of a copied prefix.
fn digest_range(file: &File, mut pos: u64, end: u64, tally: &mut Tally) -> Result<u64> {
    let mut buf = vec![0u8; CHUNK];
    let mut h = SEED;
    tally.read += end - pos;
    while pos < end {
        let n = CHUNK.min((end - pos) as usize);
        file.read_exact_at(&mut buf[..n], pos)?;
        h = digest(h, &buf[..n]);
        pos += n as u64;
    }
    Ok(h)
}

fn merge(path: &Path, place: Place, tail: bool, at: usize, durable: bool) -> Result<()> {
    let mutate = std::env::var("TAIL_MUTATE").unwrap_or_default();
    let started = Instant::now();
    let mut tally = Tally { clone: "none", ..Tally::default() };
    let old_file = File::open(path).context("open series")?;
    let old = Series::read(&old_file, place)?;
    let n = old.entries.len();
    ensure!(at <= n, "position {at} past {n} entries");
    tally.read += (n * ENTRY) as u64;

    let late = frame(1_000_000 + n as u64);
    let mut entries = old.entries.clone();
    entries.insert(at, entry(1_000_000 + n as u64, late.len()));
    let fits = n < old.capacity;
    let capacity = if place == Place::Front && !fits { n + 1 + SLACK } else { old.capacity.max(n + 1) };
    let mut new = Series { place, capacity, entries };
    new.lay_out();
    let tail = tail && (place == Place::End || fits);

    let incoming = path.parent().unwrap_or(Path::new(".")).join("incoming");
    std::fs::create_dir_all(&incoming)?;
    let staged_path: PathBuf = if mutate == "in-place" { path.into() } else { incoming.join(path.file_name().unwrap()) };
    if staged_path != path {
        let _ = std::fs::remove_file(&staged_path);
    }
    let file = OpenOptions::new().read(true).write(true).create(true).open(&staged_path)?;
    let mut staged = Staged { file, runs: Vec::new() };

    let first = if tail { at } else { 0 };
    let point = old.entries.get(at).map_or(old.data_end(), |e| e.offset);
    if tail && mutate != "in-place" {
        let base = old.data_base();
        let shared = mutate != "no-clone" && clone_or_copy(&staged.file, &old_file, base, point, &mut tally)?;
        if !shared {
            staged.runs.push(Run { at: base, len: point - base, digest: digest_range(&old_file, base, point, &mut tally)? });
        }
    }
    if !(tail && mutate == "header") {
        let mut head = new.header();
        if place == Place::Front {
            head.extend_from_slice(&new.index());
        }
        staged.write_at(&head, 0, &mut tally)?;
    }
    let mut buf = Vec::new();
    for (i, e) in new.entries.iter().enumerate().skip(first) {
        if i == at {
            let shift = u64::from(mutate == "shift");
            staged.write_at(&late, e.offset + shift, &mut tally)?;
            continue;
        }
        let from = old.entries[if i > at { i - 1 } else { i }];
        buf.resize(from.length as usize, 0);
        old_file.read_exact_at(&mut buf, from.offset)?;
        tally.read += u64::from(from.length);
        staged.write_at(&buf, e.offset, &mut tally)?;
    }
    if place == Place::End {
        staged.write_at(&new.index(), new.data_end(), &mut tally)?;
    }
    let len = new.data_end() + if place == Place::End { (new.entries.len() * ENTRY) as u64 } else { 0 };
    staged.file.set_len(len)?;
    if mutate == "corrupt" {
        staged.file.write_all_at(b"\xff", len / 2)?;
    }
    if durable {
        staged.file.sync_all()?;
    }
    read_back(&staged_path, &staged.runs, durable, &mut tally)?;
    if staged_path != path {
        std::fs::rename(&staged_path, path)?;
    }
    if durable {
        File::open(path.parent().unwrap_or(Path::new(".")))?.sync_all()?;
    }
    let wall = started.elapsed().as_nanos();
    println!(
        r#"{{"tail":{tail},"len":{len},"read":{},"written":{},"readback":{},"clone":"{}","clone_ns":{},"wall_ns":{wall}}}"#,
        tally.read, tally.written, tally.readback, tally.clone, tally.clone_ns
    );
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize| args.get(i).map(String::as_str).unwrap_or_default();
    match arg(0) {
        "build" => build(Path::new(arg(1)), Place::parse(arg(2))?, arg(3).parse()?),
        "merge" => {
            let tail = match arg(3) {
                "full" => false,
                "tail" => true,
                m => bail!("method is full or tail, not {m}"),
            };
            merge(Path::new(arg(1)), Place::parse(arg(2))?, tail, arg(4).parse()?, arg(5) == "durable")
        }
        _ => bail!("usage: tail-merge build FILE front|end N | merge FILE front|end full|tail AT durable|warm"),
    }
}
