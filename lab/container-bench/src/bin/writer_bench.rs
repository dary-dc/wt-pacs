//! Row 172's writer arms and their instruments: a `.sbnd` written as `pack-series` writes it but with
//! another buffer or a preallocation, written past the page cache and warmed, and the page-cache
//! folios each frame sits in. `docs/disk-layout/README.md` §The writer has the protocol.

use anyhow::{bail, ensure, Context, Result};
use clap::{Parser, Subcommand};
use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::Duration;

const PAGE: u64 = 4096;
const KPF_COMPOUND_HEAD: u64 = 1 << 15;
const KPF_COMPOUND_TAIL: u64 = 1 << 16;

#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// `pack-series`' writes, through a `BufWriter` of `cap` bytes, after an optional `fallocate`.
    Pack {
        #[arg(long)]
        frames: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value_t = 8192)]
        cap: usize,
        #[arg(long)]
        fallocate: bool,
    },
    /// `src`'s bytes into `out` through `O_DIRECT`: nothing of `out` is cached after it.
    Direct {
        #[arg(long)]
        src: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Bring a file into the page cache: `seq` reads it in 128 KiB blocks, `willneed` advises it in
    /// 1 MiB pieces as the fill does and waits until every page is resident.
    Warm {
        #[arg(long)]
        how: String,
        #[arg(long)]
        file: PathBuf,
    },
    /// Pages of the file in the page cache, by `mincore`, none brought in.
    Resident {
        #[arg(long)]
        file: PathBuf,
    },
    /// Folios each frame's bytes sit in, from the `.sbnd`'s own index, as one JSON line.
    Folios {
        #[arg(long)]
        file: PathBuf,
        /// Read every compound head as a plain page: the layout check must then refuse it.
        #[arg(long)]
        mutate: bool,
    },
}

fn pack(frames: &Path, out: &Path, cap: usize, fallocate: bool) -> Result<()> {
    let metadata = std::fs::read(frames.join("metadata.json"))?;
    let meta: serde_json::Value = serde_json::from_slice(&metadata)?;
    let n = meta["frameCount"].as_u64().context("frameCount")? as usize;
    let ext = if meta["codec"] == "av1" { "av1" } else { "htj2k" };
    let paths: Vec<PathBuf> = (0..n).map(|i| frames.join(format!("{i:03}.{ext}"))).collect();
    let lengths = paths.iter().map(|p| Ok(std::fs::metadata(p)?.len() as u32)).collect::<Result<Vec<u32>>>()?;
    let data_base = 16 + 12 * n as u64 + metadata.len() as u64;
    let total = data_base + lengths.iter().map(|&l| u64::from(l)).sum::<u64>();

    let file = OpenOptions::new().write(true).create(true).truncate(true).open(out)?;
    if fallocate {
        // SAFETY: a valid fd; the range is plain integers.
        let rc = unsafe { libc::fallocate(file.as_raw_fd(), 0, 0, total as libc::off_t) };
        ensure!(rc == 0, "fallocate: {}", std::io::Error::last_os_error());
    }
    // `BundleWriter::create`'s sequence, write for write (`common/series-bundle/src/writer.rs`).
    let mut w = BufWriter::with_capacity(cap, file);
    w.write_all(b"SBND")?;
    w.write_all(&1u32.to_le_bytes())?;
    w.write_all(&(metadata.len() as u32).to_le_bytes())?;
    w.write_all(&(n as u32).to_le_bytes())?;
    let mut offset = data_base;
    for &l in &lengths {
        w.write_all(&offset.to_le_bytes())?;
        w.write_all(&l.to_le_bytes())?;
        offset += u64::from(l);
    }
    w.write_all(&metadata)?;
    for p in &paths {
        w.write_all(&std::fs::read(p)?)?;
    }
    w.flush()?;
    Ok(())
}

struct Aligned {
    ptr: *mut u8,
    layout: Layout,
}

impl Aligned {
    fn new(len: usize) -> Self {
        let layout = Layout::from_size_align(len, PAGE as usize).expect("layout");
        // SAFETY: `layout` has a non-zero size.
        let ptr = unsafe { alloc_zeroed(layout) };
        assert!(!ptr.is_null(), "alloc");
        Self { ptr, layout }
    }

    fn buf(&mut self) -> &mut [u8] {
        // SAFETY: `ptr` owns `layout.size()` initialised bytes for `self`'s lifetime.
        unsafe { std::slice::from_raw_parts_mut(self.ptr, self.layout.size()) }
    }
}

impl Drop for Aligned {
    fn drop(&mut self) {
        // SAFETY: allocated with this layout in `new`.
        unsafe { dealloc(self.ptr, self.layout) };
    }
}

fn direct(src: &Path, out: &Path) -> Result<()> {
    let mut input = File::open(src)?;
    let size = input.metadata()?.len();
    let file = OpenOptions::new().write(true).create(true).truncate(true).custom_flags(libc::O_DIRECT).open(out)?;
    let mut block = Aligned::new(1 << 20);
    let mut at = 0u64;
    while at < size {
        let buf = block.buf();
        let want = ((size - at) as usize).min(buf.len());
        input.read_exact(&mut buf[..want])?;
        let padded = (want as u64).div_ceil(PAGE) * PAGE;
        buf[want..padded as usize].fill(0);
        file.write_all_at(&buf[..padded as usize], at)?;
        at += want as u64;
    }
    file.set_len(size)?;
    Ok(())
}

fn resident(file: &File, len: u64) -> Result<(u64, u64)> {
    let vec = residency(file, len)?;
    Ok((vec.iter().filter(|&&b| b & 1 == 1).count() as u64, vec.len() as u64))
}

fn residency(file: &File, len: u64) -> Result<Vec<u8>> {
    let pages = len.div_ceil(PAGE);
    // SAFETY: a read-only shared mapping of `len` bytes of an open file; unmapped below.
    let map = unsafe { libc::mmap(std::ptr::null_mut(), len as usize, libc::PROT_READ, libc::MAP_SHARED, file.as_raw_fd(), 0) };
    ensure!(map != libc::MAP_FAILED, "mmap: {}", std::io::Error::last_os_error());
    let mut vec = vec![0u8; pages as usize];
    // SAFETY: `map` spans `len` bytes; `vec` holds one byte per page.
    let rc = unsafe { libc::mincore(map, len as usize, vec.as_mut_ptr()) };
    // SAFETY: the mapping made above.
    unsafe { libc::munmap(map, len as usize) };
    ensure!(rc == 0, "mincore: {}", std::io::Error::last_os_error());
    Ok(vec)
}

fn warm(how: &str, path: &Path) -> Result<()> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    match how {
        "seq" => {
            let mut buf = vec![0u8; 128 << 10];
            while file.read(&mut buf)? > 0 {}
        }
        "willneed" => {
            let mut at = 0u64;
            while at < len {
                // SAFETY: plain integers on a valid fd.
                unsafe { libc::posix_fadvise(file.as_raw_fd(), at as libc::off_t, (1 << 20) as libc::off_t, libc::POSIX_FADV_WILLNEED) };
                at += 1 << 20;
            }
            let (mut last, mut still) = (u64::MAX, 0);
            while still < 10 {
                let now = resident(&file, len)?.0;
                (last, still) = (now, if now == last { still + 1 } else { 0 });
                std::thread::sleep(Duration::from_millis(20));
            }
            // WILLNEED leaves pages out (the last partial one, here); the fill's own read brings them in.
            let map = residency(&file, len)?;
            let mut byte = [0u8; 1];
            for (p, _) in map.iter().enumerate().filter(|(_, &b)| b & 1 == 0) {
                file.read_exact_at(&mut byte, p as u64 * PAGE)?;
            }
            eprintln!("{{\"willneed_left_out\":{}}}", map.iter().filter(|&&b| b & 1 == 0).count());
        }
        _ => bail!("no warm {how}"),
    }
    let (got, pages) = resident(&file, len)?;
    ensure!(got == pages, "{got} of {pages} pages resident after the warm");
    Ok(())
}

fn index(file: &File) -> Result<Vec<(u64, u64)>> {
    let mut head = [0u8; 16];
    file.read_exact_at(&mut head, 0)?;
    ensure!(&head[..4] == b"SBND", "not a .sbnd");
    let n = u32::from_le_bytes(head[12..16].try_into()?) as usize;
    let mut raw = vec![0u8; 12 * n];
    file.read_exact_at(&mut raw, 16)?;
    Ok(raw
        .chunks_exact(12)
        .map(|e| (u64::from_le_bytes(e[..8].try_into().unwrap()), u64::from(u32::from_le_bytes(e[8..].try_into().unwrap()))))
        .collect())
}

/// For each page of the file, whether it begins a folio, and the folio's order: from the PFN that
/// `/proc/self/pagemap` gives a mapped page and that page's `/proc/kpageflags`.
fn pages(file: &File, len: u64, mutate: bool) -> Result<Vec<(bool, u32)>> {
    let (got, pages) = resident(file, len)?;
    ensure!(got == pages, "{got} of {pages} pages resident: mapping the rest would read them in");
    // SAFETY: a read-only shared mapping of `len` bytes of an open file; unmapped below.
    let map = unsafe { libc::mmap(std::ptr::null_mut(), len as usize, libc::PROT_READ, libc::MAP_SHARED, file.as_raw_fd(), 0) };
    ensure!(map != libc::MAP_FAILED, "mmap: {}", std::io::Error::last_os_error());
    // SAFETY: MADV_RANDOM on our own mapping only turns fault-around off.
    unsafe { libc::madvise(map, len as usize, libc::MADV_RANDOM) };
    let base = map as usize;
    let mut sum = 0u64;
    for p in 0..pages {
        // SAFETY: every page is resident and inside the mapping.
        sum = sum.wrapping_add(u64::from(unsafe { std::ptr::read_volatile((base + (p * PAGE) as usize) as *const u8) }));
    }
    std::hint::black_box(sum);
    let pagemap = File::open("/proc/self/pagemap")?;
    let kflags = File::open("/proc/kpageflags")?;
    let mut raw = vec![0u8; 8 * pages as usize];
    pagemap.read_exact_at(&mut raw, (base as u64 / PAGE) * 8)?;
    // SAFETY: the mapping made above.
    unsafe { libc::munmap(map, len as usize) };
    let mut out = Vec::with_capacity(pages as usize);
    let mut order = 0u32;
    for (p, e) in raw.chunks_exact(8).enumerate() {
        let e = u64::from_le_bytes(e.try_into().unwrap());
        ensure!(e >> 63 == 1, "page {p} not present in pagemap");
        let pfn = e & ((1 << 55) - 1);
        ensure!(pfn != 0, "PFN 0: /proc/self/pagemap needs CAP_SYS_ADMIN");
        let mut f = [0u8; 8];
        kflags.read_exact_at(&mut f, pfn * 8)?;
        let f = u64::from_le_bytes(f) & if mutate { !KPF_COMPOUND_HEAD } else { !0 };
        let head = f & KPF_COMPOUND_TAIL == 0;
        if head {
            order = if f & KPF_COMPOUND_HEAD != 0 { folio_order(pfn, &kflags)? } else { 0 };
        }
        out.push((head || p == 0, order));
    }
    check_layout(&out)?;
    Ok(out)
}

/// Every folio starts on a multiple of its own size and is followed by tails to its end.
fn check_layout(pages: &[(bool, u32)]) -> Result<()> {
    let mut p = 0usize;
    while p < pages.len() {
        let (head, order) = pages[p];
        let size = 1usize << order;
        ensure!(head, "page {p} is a tail where a folio should begin");
        ensure!(p.is_multiple_of(size), "a folio of {size} pages at page {p}");
        if let Some(q) = (p + 1..(p + size).min(pages.len())).find(|&q| pages[q].0) {
            bail!("page {q} begins a folio inside the one at {p}");
        }
        p += size;
    }
    Ok(())
}

fn folio_order(head: u64, kflags: &File) -> Result<u32> {
    let mut n = 1u64;
    let mut f = [0u8; 8];
    while n < 512 && kflags.read_exact_at(&mut f, (head + n) * 8).is_ok() && u64::from_le_bytes(f) & KPF_COMPOUND_TAIL != 0 {
        n += 1;
    }
    Ok(n.trailing_zeros())
}

fn folios(path: &Path, mutate: bool) -> Result<serde_json::Value> {
    let file = File::open(path)?;
    let len = file.metadata()?.len();
    let pages = pages(&file, len, mutate)?;
    let per: Vec<u32> = index(&file)?
        .iter()
        .map(|&(o, l)| {
            let (first, last) = (o / PAGE, (o + l - 1) / PAGE);
            1 + (first + 1..=last).filter(|&p| pages[p as usize].0).count() as u32
        })
        .collect();
    let mut orders = [0u64; 10];
    for (head, order) in &pages {
        if *head {
            orders[(*order as usize).min(9)] += 1;
        }
    }
    let mean = per.iter().map(|&c| f64::from(c)).sum::<f64>() / per.len() as f64;
    let digest = xxhash_rust::xxh3::xxh3_64(&per.iter().flat_map(|c| c.to_le_bytes()).collect::<Vec<u8>>());
    Ok(serde_json::json!({
        "frames": per.len(), "folios_per_frame": mean, "folios_max": per.iter().max(),
        "pages": pages.len(), "folios": pages.iter().filter(|p| p.0).count(),
        "orders": orders, "per_frame_digest": format!("{digest:016x}"),
    }))
}

fn main() -> Result<()> {
    match Args::parse().cmd {
        Cmd::Pack { frames, out, cap, fallocate } => pack(&frames, &out, cap, fallocate),
        Cmd::Direct { src, out } => direct(&src, &out),
        Cmd::Warm { how, file } => warm(&how, &file),
        Cmd::Resident { file } => {
            let f = File::open(&file)?;
            let (got, pages) = resident(&f, f.metadata()?.len())?;
            println!("{}", serde_json::json!({ "resident": got, "pages": pages }));
            Ok(())
        }
        Cmd::Folios { file, mutate } => {
            println!("{}", folios(&file, mutate)?);
            Ok(())
        }
    }
}
