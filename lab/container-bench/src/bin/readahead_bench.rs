//! Row 197's W0 and W0aa arms on the shipped `FillReader` and `TileReader`: a cold fill, the folios it
//! leaves, then hits, a fill on the cache and a forced miss. `docs/adr/disk-access.md` §Protocol for row 197.

use anyhow::{bail, ensure, Context, Result};
use clap::{Parser, Subcommand};
use container_bench::folio::{pages, PAGE};
use container_bench::parse::{self, Container, Index};
use container_bench::source::Source;
use series_server::media::frame_store::{FrameSpan, FrameStore};
use series_server::media::read_path::{FillReader, ReadMode, TileReader};
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use xxhash_rust::xxh3::xxh3_64;

#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// One arm on one cold copy, as one JSON line.
    Measure {
        /// The row's label: W0, or W0aa on another copy.
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
    /// Every frame as the fill hands it on, to `OUT/NNN.bin`, for the decode check.
    Dump {
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
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
async fn fill(store: &Arc<FrameStore>, fills: usize, exact: &mut Exact) -> Result<(f64, f64, u64, u64)> {
    let n = store.frame_count() as usize;
    let spans: Arc<Vec<FrameSpan>> = Arc::new((0..n).map(|i| store.frame_span(i as u32)).collect());
    let (start, cpu) = (Instant::now(), cpu_ns());
    let mut tasks = Vec::new();
    for f in 0..fills {
        let order: Vec<usize> = (0..n).map(|k| (k + f * n / fills) % n).collect();
        tasks.push(tokio::spawn(walk(FillReader::new(Arc::clone(store)), Arc::clone(&spans), order, start)));
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

/// Folios a frame, once every page is cached.
fn folios(path: &Path, index: &Index) -> Result<serde_json::Value> {
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
    let mut orders = [0u64; 10];
    for (head, order) in &pages {
        if *head {
            orders[(*order as usize).min(9)] += 1;
        }
    }
    Ok(serde_json::json!({
        "folios_per_frame": per.iter().map(|&c| f64::from(c)).sum::<f64>() / per.len() as f64,
        "folios_max": per.iter().max(), "orders": orders, "frame_bytes_mean": index.iter().map(|e| u64::from(e.1)).sum::<u64>() / index.len() as u64,
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
    let vm0 = vmstat()?;

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
    let order = plan(exact.want.len(), asks, round);
    let total: u64 = index.iter().map(|e| u64::from(e.1)).sum();
    let (cold, folio, (h50, h99), (fh_fps, fh_cpu, _, fh_miss), (m50, _)) = rt.block_on(async {
        let cold = fill(&store, fills, &mut exact).await?;
        let folio = folios(path, &index)?;
        let hits = tile(Arc::clone(&store), &order, &mut exact).await?;
        let walks = fill_bytes.div_ceil(total).max(1) as usize;
        let mut on_cache = (0.0, 0.0, 0, 0);
        for _ in 0..walks {
            let w = fill(&store, 1, &mut exact).await?;
            on_cache = (on_cache.0 + w.0 / walks as f64, on_cache.1 + w.1 / walks as f64, 0, on_cache.3 + w.3);
        }
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
        "asks": order.len(), "frames": exact.want.len(), "file_bytes": std::fs::metadata(path)?.len(),
        "checked": exact.checked, "inexact": exact.bad,
    });
    row.as_object_mut().unwrap().extend(folio.as_object().unwrap().clone());
    Ok(row)
}

fn dump(path: &Path, out: &Path) -> Result<()> {
    let index = cold_index(path, None)?;
    let probe_at = index.first().map_or(0, |e| e.0);
    let store = Arc::new(FrameStore::with_index(File::open(path)?, index, probe_at));
    std::fs::create_dir_all(out)?;
    tokio::runtime::Builder::new_multi_thread().enable_all().build()?.block_on(async {
        let n = store.frame_count();
        let mut reader = FillReader::new(Arc::clone(&store));
        for i in 0..n {
            let next = (i + 1 < n).then(|| store.frame_span(i + 1));
            let bytes = reader.read(store.frame_span(i), next).await?;
            std::fs::write(out.join(format!("{i:03}.bin")), &bytes)?;
        }
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
        Cmd::Dump { file, out } => dump(&file, &out),
    }
}
