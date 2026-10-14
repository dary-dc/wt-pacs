//! Row 197's read-ahead arms on the shipped `FillReader` and `TileReader`: a cold fill, the folios it
//! leaves, then hits, a fill on the cache and a forced miss. `docs/adr/disk-access.md` §Protocol for row 197.

use anyhow::{bail, ensure, Context, Result};
use clap::{Parser, Subcommand};
use container_bench::folio::{pages, PAGE};
use container_bench::parse::{self, Container, Index};
use container_bench::source::Source;
use series_server::media::frame_store::{FrameSpan, FrameStore};
use series_server::media::read_path::{FillReader, ReadAhead, ReadMode, TileReader};
use std::fs::File;
use std::os::fd::AsRawFd;
use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::task::JoinHandle;
use xxhash_rust::xxh3::xxh3_64;

/// W1's unit: one PMD-sized folio, file-aligned.
const BLOCK: u64 = 2 << 20;
/// W2's read size.
const PIECE: usize = 1 << 20;

#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// One arm on one cold copy, as one JSON line.
    Measure {
        #[arg(long)]
        arm: String,
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        frames: PathBuf,
        #[arg(long, default_value_t = 0)]
        round: u64,
        #[arg(long, default_value_t = 400)]
        asks: usize,
        /// Fills walking the cold copy at once, starting a quarter of it apart when 4.
        #[arg(long, default_value_t = 1)]
        fills: usize,
        /// Bytes the fill on the cache walks, at least one walk.
        #[arg(long, default_value_t = 128 << 20)]
        fill_bytes: u64,
        /// Break the index on purpose: `shift` moves every offset one byte back, `short` drops a frame's last byte.
        #[arg(long)]
        mutate: Option<String>,
    },
    /// Every frame as the arm's fill hands it on, to `OUT/NNN.bin`, for the decode check.
    Dump {
        #[arg(long)]
        arm: String,
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
}

/// What an arm's read-ahead left running, refused and populated, shared by its fills.
#[derive(Default)]
struct Tally {
    pending: Mutex<Vec<JoinHandle<()>>>,
    refused: AtomicU64,
    blocks: Mutex<Vec<u64>>,
}

impl Tally {
    async fn settle(&self) {
        let pending = std::mem::take(&mut *self.pending.lock().unwrap());
        for p in pending {
            p.await.ok();
        }
    }
}

/// A read-only shared mapping of the whole file through its own descriptor.
struct Mapping {
    at: usize,
    len: usize,
    _file: File,
}

impl Drop for Mapping {
    fn drop(&mut self) {
        // SAFETY: the mapping made in `Arm::build`, unmapped once.
        unsafe { libc::munmap(self.at as *mut libc::c_void, self.len) };
    }
}

enum Arm {
    Shipped,
    Populate(Arc<Mapping>),
    Pread(Arc<File>),
    None,
}

impl Arm {
    fn build(name: &str, path: &Path, tally: &Tally) -> Result<Self> {
        Ok(match name {
            "W0" | "W0aa" => Self::Shipped,
            "W1" => {
                let file = File::open(path)?;
                let len = file.metadata()?.len().div_ceil(PAGE) as usize * PAGE as usize;
                // SAFETY: a read-only shared mapping of an open file, unmapped by `Mapping`'s drop.
                let at = unsafe { libc::mmap(std::ptr::null_mut(), len, libc::PROT_READ, libc::MAP_SHARED, file.as_raw_fd(), 0) };
                ensure!(at != libc::MAP_FAILED, "mmap: {}", std::io::Error::last_os_error());
                let map = Mapping { at: at as usize, len, _file: file };
                for advice in [libc::MADV_HUGEPAGE, libc::MADV_RANDOM] {
                    // SAFETY: advice on our own mapping; it changes no byte of it.
                    if unsafe { libc::madvise(at, len, advice) } != 0 {
                        tally.refused.fetch_add(1, Ordering::Relaxed);
                        return Ok(Self::Shipped);
                    }
                }
                Self::Populate(Arc::new(map))
            }
            "W2" => {
                let file = File::open(path)?;
                // SAFETY: plain integers on a valid fd.
                unsafe { libc::posix_fadvise(file.as_raw_fd(), 0, 0, libc::POSIX_FADV_SEQUENTIAL) };
                Self::Pread(Arc::new(file))
            }
            "W3" => Self::None,
            _ => bail!("no arm {name}"),
        })
    }

    fn reader(&self, store: &Arc<FrameStore>, tally: &Arc<Tally>) -> FillReader {
        let ahead: ReadAhead = match self {
            Self::Shipped => return FillReader::new(Arc::clone(store)),
            Self::None => Box::new(|_, _| {}),
            Self::Populate(map) => {
                let (map, tally, store) = (Arc::clone(map), Arc::clone(tally), Arc::clone(store));
                let mut cursor = Cursor::default();
                Box::new(move |from, len| {
                    for b in cursor.blocks(from, from + len, map.len as u64) {
                        tally.blocks.lock().unwrap().push(b);
                        let (map, t, store) = (Arc::clone(&map), Arc::clone(&tally), Arc::clone(&store));
                        let task = tokio::task::spawn_blocking(move || {
                            let len = BLOCK.min(map.len as u64 - b);
                            // SAFETY: `b..b + len` lies inside the mapping, which `map` keeps alive.
                            let rc = unsafe { libc::madvise((map.at + b as usize) as *mut libc::c_void, len as usize, libc::MADV_POPULATE_READ) };
                            if rc != 0 {
                                t.refused.fetch_add(1, Ordering::Relaxed);
                                store.advise_ahead(b, len);
                            }
                        });
                        tally.pending.lock().unwrap().push(task);
                    }
                })
            }
            Self::Pread(file) => {
                let (file, tally) = (Arc::clone(file), Arc::clone(tally));
                Box::new(move |from, len| {
                    let file = Arc::clone(&file);
                    let task = tokio::task::spawn_blocking(move || {
                        let mut scratch = vec![0u8; PIECE];
                        let mut at = from;
                        while at < from + len {
                            match file.read_at(&mut scratch, at) {
                                Ok(0) | Err(_) => break,
                                Ok(n) => at += n as u64,
                            }
                        }
                    });
                    tally.pending.lock().unwrap().push(task);
                })
            }
        };
        FillReader::with_read_ahead(Arc::clone(store), ahead)
    }
}

/// W1's walk through whole blocks: contiguous while the fill's window is, restarted on a seek.
#[derive(Default)]
struct Cursor {
    next: u64,
    last_want: Option<u64>,
}

impl Cursor {
    /// Block starts to populate for the advised range `from..want`, none past `file_end`.
    fn blocks(&mut self, from: u64, want: u64, file_end: u64) -> Vec<u64> {
        if self.last_want != Some(from) {
            self.next = from.div_ceil(BLOCK) * BLOCK;
        }
        self.last_want = Some(want);
        let mut out = Vec::new();
        while self.next < want && self.next < file_end {
            out.push(self.next);
            self.next += BLOCK;
        }
        out
    }
}

struct Exact {
    want: Vec<u64>,
    bad: u64,
    checked: u64,
}

impl Exact {
    fn check(&mut self, frame: usize, bytes: &[u8]) {
        self.checked += 1;
        if xxh3_64(bytes) != self.want[frame] {
            self.bad += 1;
        }
    }
}

fn coded(dir: &Path) -> Result<Vec<u64>> {
    let meta: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("metadata.json"))?)?;
    let ext = if meta["codec"] == "av1" { "av1" } else { "htj2k" };
    let n = meta["frameCount"].as_u64().context("frameCount")? as usize;
    (0..n).map(|i| Ok(xxh3_64(&std::fs::read(dir.join(format!("{i:03}.{ext}")))?))).collect()
}

/// The index read past the page cache, so the cold copy's first frames are not cached by the open.
fn cold_index(path: &Path, mutate: Option<&str>) -> Result<Index> {
    let index = parse::index(Container::Sbnd1, &Source::open(path, true)?)?;
    Ok(match mutate {
        None => index,
        Some("shift") => index.into_iter().map(|(o, l)| (o - 1, l)).collect(),
        Some("short") => index.into_iter().map(|(o, l)| (o, l - 1)).collect(),
        Some(other) => bail!("no mutation {other}"),
    })
}

fn cpu_ns() -> u64 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `ts` is a valid, writable timespec.
    unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut ts) };
    ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64
}

fn quantile(v: &mut [u64], q: f64) -> u64 {
    v.sort_unstable();
    v[((v.len() as f64 * q) as usize).min(v.len() - 1)]
}

fn vmstat() -> Result<(u64, u64)> {
    let text = std::fs::read_to_string("/proc/vmstat")?;
    let get = |k: &str| text.lines().find_map(|l| l.strip_prefix(k)?.trim().parse().ok()).unwrap_or(0);
    Ok((get("compact_stall "), get("pgmajfault ")))
}

/// A permutation of the frames repeated to `asks`, the same for every arm in a round.
fn plan(n: usize, asks: usize, round: u64) -> Vec<usize> {
    let mut x = round.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut out = Vec::with_capacity(asks.max(n));
    while out.len() < asks.max(n) {
        let mut p: Vec<usize> = (0..n).collect();
        for i in (1..n).rev() {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            p.swap(i, (x % (i as u64 + 1)) as usize);
        }
        out.extend(p);
    }
    out
}

struct Walk {
    frames: u64,
    bytes: u64,
    wall_ns: u64,
    first_ns: u64,
    misses: u64,
}

/// `order`'s frames through one reader, the next one named; frames checked after the clock stops.
async fn walk(mut reader: FillReader, spans: Arc<Vec<FrameSpan>>, order: Vec<usize>, start: Instant) -> Result<(Walk, Vec<(usize, bytes::Bytes)>)> {
    let mut held = Vec::with_capacity(order.len());
    let mut first_ns = 0;
    for (k, &i) in order.iter().enumerate() {
        let next = order.get(k + 1).map(|&j| spans[j]);
        held.push((i, reader.read(spans[i], next).await?));
        if k == 0 {
            first_ns = start.elapsed().as_nanos() as u64;
        }
    }
    let bytes = order.iter().map(|&i| u64::from(spans[i].len)).sum();
    let w = Walk { frames: order.len() as u64, bytes, wall_ns: start.elapsed().as_nanos() as u64, first_ns, misses: reader.stats().misses };
    Ok((w, held))
}

/// `fills` fills at once, each over every frame from its own quarter: frames/s, CPU ns a GB, first frame, misses.
async fn fill(arm: &Arm, store: &Arc<FrameStore>, tally: &Arc<Tally>, fills: usize, exact: &mut Exact) -> Result<(f64, f64, u64, u64)> {
    let n = store.frame_count() as usize;
    let spans: Arc<Vec<FrameSpan>> = Arc::new((0..n).map(|i| store.frame_span(i as u32)).collect());
    let (start, cpu) = (Instant::now(), cpu_ns());
    let mut tasks = Vec::new();
    for f in 0..fills {
        let order: Vec<usize> = (0..n).map(|k| (k + f * n / fills) % n).collect();
        tasks.push(tokio::spawn(walk(arm.reader(store, tally), Arc::clone(&spans), order, start)));
    }
    let mut walks = Vec::new();
    for t in tasks {
        walks.push(t.await??);
    }
    let cpu = cpu_ns() - cpu;
    let wall = walks.iter().map(|w| w.0.wall_ns).max().unwrap_or(1);
    let frames: u64 = walks.iter().map(|w| w.0.frames).sum();
    let bytes: u64 = walks.iter().map(|w| w.0.bytes).sum();
    let first = walks.iter().map(|w| w.0.first_ns).max().unwrap_or(0);
    let misses = walks.iter().map(|w| w.0.misses).sum();
    for (_, held) in &walks {
        for (i, b) in held {
            exact.check(*i, b);
        }
    }
    Ok((frames as f64 * 1e9 / wall as f64, cpu as f64 / (bytes as f64 / 1e9), first, misses))
}

async fn tile(store: Arc<FrameStore>, plan: &[usize], exact: &mut Exact) -> Result<(u64, u64)> {
    let mut reader = TileReader::new(ReadMode::Auto, Arc::clone(&store), 1);
    let mut lat = Vec::with_capacity(plan.len());
    for &f in plan {
        let span = store.frame_span(f as u32);
        let t = Instant::now();
        let bytes = reader.read(span, &[]).await?;
        lat.push(t.elapsed().as_nanos() as u64);
        exact.check(f, &bytes);
    }
    Ok((quantile(&mut lat, 0.5), quantile(&mut lat, 0.99)))
}

/// Folios a frame and the share of W1's blocks that are one 2 MiB folio, once every page is cached.
fn folios(path: &Path, index: &Index, blocks: &[u64]) -> Result<serde_json::Value> {
    let file = File::open(path)?;
    let len = file.metadata()?.len();
    let mut head = vec![0u8; index.first().map_or(0, |e| e.0) as usize];
    file.read_exact_at(&mut head, 0)?;
    let pages = pages(&file, len, false)?;
    let per: Vec<u32> = index
        .iter()
        .map(|&(o, l)| {
            let (first, last) = (o / PAGE, (o + u64::from(l) - 1) / PAGE);
            1 + (first + 1..=last).filter(|&p| pages[p as usize].0).count() as u32
        })
        .collect();
    let whole = blocks.iter().filter(|&&b| pages[(b / PAGE) as usize] == (true, 9)).count();
    let mut orders = [0u64; 10];
    for (head, order) in &pages {
        if *head {
            orders[(*order as usize).min(9)] += 1;
        }
    }
    Ok(serde_json::json!({
        "folios_per_frame": per.iter().map(|&c| f64::from(c)).sum::<f64>() / per.len() as f64,
        "folios_max": per.iter().max(), "orders": orders, "frame_bytes_mean": index.iter().map(|e| u64::from(e.1)).sum::<u64>() / index.len() as u64,
        "w1_blocks": blocks.len(), "w1_blocks_one_folio": whole,
    }))
}

#[allow(clippy::too_many_arguments)]
fn measure(name: &str, path: &Path, frames: &Path, round: u64, asks: usize, fills: usize, fill_bytes: u64, mutate: Option<&str>) -> Result<serde_json::Value> {
    let mut exact = Exact { want: coded(frames)?, bad: 0, checked: 0 };
    let index = cold_index(path, mutate)?;
    ensure!(index.len() == exact.want.len(), "{} frames indexed, {} coded", index.len(), exact.want.len());
    let probe_at = index.first().map_or(0, |e| e.0);
    let store = Arc::new(FrameStore::with_index(File::open(path)?, index.clone(), probe_at));
    ensure!(store.nowait_supported(), "RWF_NOWAIT refused here: every read would miss");
    let mut miss = FrameStore::with_index(File::open(path)?, index.clone(), probe_at);
    miss.force_pool_reads();
    let miss = Arc::new(miss);
    let tally = Arc::new(Tally::default());
    let arm = Arm::build(name, path, &tally)?;
    let vm0 = vmstat()?;

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
    let order = plan(exact.want.len(), asks, round);
    let total: u64 = index.iter().map(|e| u64::from(e.1)).sum();
    let (cold, folio, (h50, h99), (fh_fps, fh_cpu, _, fh_miss), (m50, _)) = rt.block_on(async {
        let cold = fill(&arm, &store, &tally, fills, &mut exact).await?;
        tally.settle().await;
        let folio = folios(path, &index, &tally.blocks.lock().unwrap())?;
        let hits = tile(Arc::clone(&store), &order, &mut exact).await?;
        let walks = fill_bytes.div_ceil(total).max(1) as usize;
        let mut on_cache = (0.0, 0.0, 0, 0);
        for _ in 0..walks {
            let w = fill(&arm, &store, &tally, 1, &mut exact).await?;
            on_cache = (on_cache.0 + w.0 / walks as f64, on_cache.1 + w.1 / walks as f64, 0, on_cache.3 + w.3);
        }
        tally.settle().await;
        let forced = tile(Arc::clone(&miss), &order, &mut exact).await?;
        anyhow::Ok((cold, folio, hits, on_cache, forced))
    })?;
    let vm1 = vmstat()?;
    let mut row = serde_json::json!({
        "arm": name, "fills": fills,
        "cold_fill_fps": cold.0, "cold_fill_cpu_ns_per_gb": cold.1, "cold_fill_first_ns": cold.2, "cold_fill_misses": cold.3,
        "hit_p50_ns": h50, "hit_p99_ns": h99,
        "fill_hit_fps": fh_fps, "fill_hit_cpu_ns_per_gb": fh_cpu, "fill_hit_misses": fh_miss,
        "forced_miss_p50_ns": m50,
        "compact_stall": vm1.0 - vm0.0, "pgmajfault": vm1.1 - vm0.1,
        "refused": tally.refused.load(Ordering::Relaxed),
        "asks": order.len(), "frames": exact.want.len(), "file_bytes": std::fs::metadata(path)?.len(),
        "checked": exact.checked, "inexact": exact.bad,
    });
    row.as_object_mut().unwrap().extend(folio.as_object().unwrap().clone());
    Ok(row)
}

fn dump(name: &str, path: &Path, out: &Path) -> Result<()> {
    let index = cold_index(path, None)?;
    let probe_at = index.first().map_or(0, |e| e.0);
    let store = Arc::new(FrameStore::with_index(File::open(path)?, index, probe_at));
    let tally = Arc::new(Tally::default());
    let arm = Arm::build(name, path, &tally)?;
    std::fs::create_dir_all(out)?;
    tokio::runtime::Builder::new_multi_thread().enable_all().build()?.block_on(async {
        let n = store.frame_count();
        let mut reader = arm.reader(&store, &tally);
        for i in 0..n {
            let next = (i + 1 < n).then(|| store.frame_span(i + 1));
            let bytes = reader.read(store.frame_span(i), next).await?;
            std::fs::write(out.join(format!("{i:03}.bin")), &bytes)?;
        }
        tally.settle().await;
        anyhow::Ok(())
    })
}

fn main() -> Result<()> {
    match Args::parse().cmd {
        Cmd::Measure { arm, file, frames, round, asks, fills, fill_bytes, mutate } => {
            let v = measure(&arm, &file, &frames, round, asks, fills, fill_bytes, mutate.as_deref())?;
            println!("{v}");
            ensure!(v["inexact"] == 0, "{} of {} frames read were not the encoder's bytes", v["inexact"], v["checked"]);
            Ok(())
        }
        Cmd::Dump { arm, file, out } => dump(&arm, &file, &out),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// W1's blocks, driven by the shipped fill's own advice over a walk with a seek: every block
    /// is 2 MiB-aligned, starts at or past the end of the frame its call named, follows the last
    /// one without a gap while the window is contiguous, and covers what the fill asked for.
    #[test]
    fn w1_blocks_never_straddle_the_named_frame_nor_leave_a_gap() {
        let lens: Vec<u32> = (0..80u32).map(|i| [163_000, 503_000, 32_000, 1_900_000][i as usize % 4]).collect();
        let meta = b"{}";
        let base = 16 + 12 * lens.len() as u64 + meta.len() as u64;
        let path = std::env::temp_dir().join(format!("w1-blocks-{}.sbnd", std::process::id()));
        let mut f = File::create(&path).unwrap();
        f.write_all(b"SBND").unwrap();
        f.write_all(&1u32.to_le_bytes()).unwrap();
        f.write_all(&(meta.len() as u32).to_le_bytes()).unwrap();
        f.write_all(&(lens.len() as u32).to_le_bytes()).unwrap();
        let mut at = base;
        for &l in &lens {
            f.write_all(&at.to_le_bytes()).unwrap();
            f.write_all(&l.to_le_bytes()).unwrap();
            at += u64::from(l);
        }
        f.write_all(meta).unwrap();
        f.set_len(at).unwrap();
        let file_end = at.div_ceil(PAGE) * PAGE;
        let store = Arc::new(FrameStore::open(&path).unwrap());
        let named = Arc::new(AtomicU64::new(0));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let (n2, c2) = (Arc::clone(&named), Arc::clone(&calls));
        let mut reader = FillReader::with_read_ahead(
            Arc::clone(&store),
            Box::new(move |from, len| c2.lock().unwrap().push((n2.load(Ordering::SeqCst), from, len))),
        );
        let walk: Vec<u32> = (0..40).chain(60..79).chain(5..30).collect();
        let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap();
        for w in walk.windows(2) {
            let next = store.frame_span(w[1]);
            named.store(next.offset + u64::from(next.len), Ordering::SeqCst);
            rt.block_on(reader.read(store.frame_span(w[0]), Some(next))).unwrap();
        }
        std::fs::remove_file(&path).ok();
        let calls = calls.lock().unwrap().clone();
        assert!(calls.len() > 6, "too few calls to test: {calls:?}");
        let mut cursor = Cursor::default();
        let (mut prev_want, mut prev_block, mut restarts) = (None, None::<u64>, 0);
        for (end, from, len) in calls {
            let blocks = cursor.blocks(from, from + len, file_end);
            let restart = prev_want != Some(from);
            restarts += usize::from(restart);
            for &b in &blocks {
                assert_eq!(b % BLOCK, 0, "block {b} not 2 MiB-aligned");
                assert!(b >= end, "block {b} straddles the named frame's end {end}");
                if let (Some(p), false) = (prev_block, restart && b == blocks[0]) {
                    assert_eq!(b, p + BLOCK, "a gap between blocks {p} and {b}");
                }
                prev_block = Some(b);
            }
            let covered = blocks.last().map_or(cursor.next, |b| b + BLOCK);
            assert!(covered >= (from + len).min(file_end), "the blocks end at {covered}, short of {}", from + len);
            prev_want = Some(from + len);
        }
        assert!(restarts >= 3, "the walk's seeks should restart the window: {restarts}");
    }
}
