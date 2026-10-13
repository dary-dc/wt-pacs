//! Packs a coded series into one arm, or measures one arm: the open, then the shipped readers.
//! Every frame read is checked by XXH3-64 against the codestream the encoder wrote.

use anyhow::{bail, ensure, Context, Result};
use clap::{Parser, Subcommand};
use container_bench::pack::{self, Codec, Series};
use container_bench::parse::{self, Container, Index};
use container_bench::source::Source;
use series_server::media::frame_store::{FrameSpan, FrameStore};
use series_server::media::read_path::{FillReader, ReadMode, TileReader};
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
    /// Our packer for one arm, from ingest's `NNN.htj2k`/`NNN.av1` and `metadata.json`.
    Pack {
        #[arg(long)]
        arm: String,
        #[arg(long)]
        frames: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value = "")]
        study: String,
        #[arg(long, default_value = "")]
        series: String,
        /// Frames a fragment, for `fmp4`.
        #[arg(long, default_value_t = 1)]
        per: usize,
    },
    /// The open and the read path of one arm, as one JSON line.
    Measure {
        #[arg(long)]
        container: String,
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        frames: PathBuf,
        #[arg(long, default_value_t = 0)]
        round: u64,
        /// Asks a tile cell makes, at least one per frame.
        #[arg(long, default_value_t = 400)]
        asks: usize,
        /// Bytes a fill cell walks, at least one walk.
        #[arg(long, default_value_t = 256 << 20)]
        fill_bytes: u64,
        /// Break the index on purpose: `shift` moves every offset one byte back, `short` drops a frame's last byte.
        #[arg(long)]
        mutate: Option<String>,
    },
    /// Every frame as the shipped fill reader hands it on, to `OUT/NNN.bin`, for the decode check.
    Dump {
        #[arg(long)]
        container: String,
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// The table an arm's open builds, one `offset length` a line.
    Index {
        #[arg(long)]
        container: String,
        #[arg(long)]
        file: PathBuf,
    },
}

struct Coded {
    codec: Codec,
    width: u32,
    height: u32,
    frames: Vec<Vec<u8>>,
    samples: Vec<u64>,
}

fn load(dir: &Path) -> Result<Coded> {
    let meta: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("metadata.json"))?)?;
    let codec = if meta["codec"] == "av1" { Codec::Av1 } else { Codec::Htj2k };
    let ext = if codec == Codec::Av1 { "av1" } else { "htj2k" };
    let n = meta["frameCount"].as_u64().context("frameCount")? as usize;
    let frames = (0..n)
        .map(|i| std::fs::read(dir.join(format!("{i:03}.{ext}"))).with_context(|| format!("frame {i}")))
        .collect::<Result<Vec<_>>>()?;
    let samples = meta["digests"]["frames"]
        .as_array()
        .context("digests")?
        .iter()
        .map(|h| u64::from_str_radix(h.as_str().unwrap_or(""), 16).context("a digest"))
        .collect::<Result<Vec<_>>>()?;
    ensure!(samples.len() == n, "{} digests for {n} frames", samples.len());
    Ok(Coded {
        codec,
        width: meta["width"].as_u64().context("width")? as u32,
        height: meta["height"].as_u64().context("height")? as u32,
        frames,
        samples,
    })
}

fn pack_one(arm: &str, dir: &Path, out: &Path, study: String, series: String, per: usize) -> Result<()> {
    let c = load(dir)?;
    let s = Series {
        codec: c.codec,
        width: c.width,
        height: c.height,
        study,
        series,
        coded: c.frames.iter().map(|f| xxh3_64(f)).collect(),
        samples: c.samples,
        frames: c.frames,
    };
    let t = Instant::now();
    match arm {
        "sbnd2" => pack::sbnd2(&s, out),
        "mp4" => pack::mp4(&s, out),
        "fmp4" => pack::fmp4(&s, out, per),
        "mkv" => pack::mkv(&s, out),
        "mxf" => pack::mxf(&s, out),
        "ivf" => pack::ivf(&s, out),
        _ => bail!("no packer of ours for {arm}"),
    }?;
    let ms = t.elapsed().as_secs_f64() * 1e3;
    let bytes = std::fs::metadata(out)?.len();
    println!("{}", serde_json::json!({ "arm": arm, "bytes": bytes, "pack_ms": ms }));
    Ok(())
}

struct Opened {
    store: FrameStore,
    ns: u64,
    reads: u32,
    bytes: u64,
}

/// The open as the server would do it: the file, its index, the store.
fn open(kind: Container, path: &Path, cold: bool) -> Result<Opened> {
    let t = Instant::now();
    let src = Source::open(path, cold)?;
    let index = parse::index(kind, &src)?;
    let (reads, bytes) = (src.reads(), src.bytes());
    let file = if cold { std::fs::File::open(path)? } else { src.into_file() };
    let probe_at = index.first().map_or(0, |e| e.0);
    let store = FrameStore::with_index(file, index, probe_at);
    Ok(Opened { store, ns: t.elapsed().as_nanos() as u64, reads, bytes })
}

fn mutated(index: Index, how: Option<&str>) -> Result<Index> {
    Ok(match how {
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

fn median(v: &mut [u64]) -> u64 {
    v.sort_unstable();
    v[v.len() / 2]
}

fn quantile(v: &mut [u64], q: f64) -> u64 {
    v.sort_unstable();
    v[((v.len() as f64 * q) as usize).min(v.len() - 1)]
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

async fn tile(store: Arc<FrameStore>, plan: &[usize], exact: &mut Exact) -> Result<(u64, u64, u64)> {
    let mut reader = TileReader::new(ReadMode::Auto, Arc::clone(&store), 1);
    let mut lat = Vec::with_capacity(plan.len());
    for &f in plan {
        let span = store.frame_span(f as u32);
        let t = Instant::now();
        let bytes = reader.read(span, &[]).await?;
        lat.push(t.elapsed().as_nanos() as u64);
        exact.check(f, &bytes);
    }
    let misses = reader.stats().misses;
    Ok((quantile(&mut lat, 0.5), quantile(&mut lat, 0.99), misses))
}

/// Whole walks in display order, the next frame named: frames/s and CPU ns per GB. The walk's
/// frames are held and checked after its clocks stop, so the check costs neither.
async fn fill(store: Arc<FrameStore>, min_bytes: u64, exact: &mut Exact) -> Result<(f64, f64, u64)> {
    let n = store.frame_count() as usize;
    let spans: Vec<FrameSpan> = (0..n).map(|i| store.frame_span(i as u32)).collect();
    let walk: u64 = spans.iter().map(|s| s.len as u64).sum();
    let walks = min_bytes.div_ceil(walk).max(1);
    let (mut frames, mut bytes, mut wall, mut cpu, mut misses) = (0u64, 0u64, 0u64, 0u64, 0u64);
    for _ in 0..walks {
        let mut reader = FillReader::new(Arc::clone(&store));
        let mut held = Vec::with_capacity(n);
        let (t, c) = (Instant::now(), cpu_ns());
        for i in 0..n {
            held.push(reader.read(spans[i], spans.get(i + 1).copied()).await?);
        }
        wall += t.elapsed().as_nanos() as u64;
        cpu += cpu_ns() - c;
        misses += reader.stats().misses;
        for (i, b) in held.iter().enumerate() {
            exact.check(i, b);
        }
        frames += n as u64;
        bytes += walk;
    }
    Ok((frames as f64 * 1e9 / wall as f64, cpu as f64 / (bytes as f64 / 1e9), misses))
}

#[allow(clippy::too_many_arguments)]
fn measure(kind: Container, file: &Path, dir: &Path, round: u64, asks: usize, fill_bytes: u64, mutate: Option<&str>) -> Result<serde_json::Value> {
    let c = load(dir)?;
    let mut exact = Exact { want: c.frames.iter().map(|f| xxh3_64(f)).collect(), bad: 0, checked: 0 };
    drop(c);
    let mut warm = Vec::new();
    let mut cold = Vec::new();
    let (mut reads, mut read_bytes) = (0, 0);
    for k in 0..12 {
        let o = open(kind, file, k % 3 == 2)?;
        if k % 3 == 2 {
            cold.push(o.ns);
        } else {
            warm.push(o.ns);
        }
        (reads, read_bytes) = (o.reads, o.bytes);
    }
    let src = Source::open(file, false)?;
    let index = mutated(parse::index(kind, &src)?, mutate)?;
    ensure!(index.len() == exact.want.len(), "{} frames indexed, {} coded", index.len(), exact.want.len());
    let probe_at = index.first().map_or(0, |e| e.0);
    let hit = Arc::new(FrameStore::with_index(src.into_file(), index.clone(), probe_at));
    ensure!(hit.nowait_supported(), "RWF_NOWAIT refused here: every read would miss");
    let mut miss_store = FrameStore::with_index(std::fs::File::open(file)?, index, probe_at);
    miss_store.force_pool_reads();
    let miss = Arc::new(miss_store);

    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
    let order = plan(exact.want.len(), asks, round);
    let (tiles, fills) = rt.block_on(async {
        fill(Arc::clone(&hit), 0, &mut exact).await?;
        let th = tile(Arc::clone(&hit), &order, &mut exact).await?;
        let tm = tile(Arc::clone(&miss), &order, &mut exact).await?;
        let fh = fill(Arc::clone(&hit), fill_bytes, &mut exact).await?;
        let fm = fill(Arc::clone(&miss), fill_bytes, &mut exact).await?;
        anyhow::Ok(((th, tm), (fh, fm)))
    })?;
    let ((th50, th99, th_miss), (tm50, tm99, tm_miss)) = tiles;
    let ((fh_fps, fh_cpu, fh_miss), (fm_fps, fm_cpu, fm_miss)) = fills;
    Ok(serde_json::json!({
        "open_warm_ns": median(&mut warm), "open_cold_ns": median(&mut cold),
        "open_reads": reads, "open_bytes": read_bytes,
        "tile_hit_p50_ns": th50, "tile_hit_p99_ns": th99, "tile_hit_misses": th_miss,
        "tile_miss_p50_ns": tm50, "tile_miss_p99_ns": tm99, "tile_miss_misses": tm_miss,
        "fill_hit_fps": fh_fps, "fill_hit_cpu_ns_per_gb": fh_cpu, "fill_hit_misses": fh_miss,
        "fill_miss_fps": fm_fps, "fill_miss_cpu_ns_per_gb": fm_cpu, "fill_miss_misses": fm_miss,
        "asks": order.len(), "frames": exact.want.len(), "file_bytes": std::fs::metadata(file)?.len(),
        "checked": exact.checked, "inexact": exact.bad,
    }))
}

fn main() -> Result<()> {
    match Args::parse().cmd {
        Cmd::Pack { arm, frames, out, study, series, per } => pack_one(&arm, &frames, &out, study, series, per),
        Cmd::Measure { container, file, frames, round, asks, fill_bytes, mutate } => {
            let v = measure(Container::parse(&container)?, &file, &frames, round, asks, fill_bytes, mutate.as_deref())?;
            println!("{v}");
            ensure!(v["inexact"] == 0, "{} of {} frames read were not the encoder's bytes", v["inexact"], v["checked"]);
            Ok(())
        }
        Cmd::Dump { container, file, out } => {
            let o = open(Container::parse(&container)?, &file, false)?;
            let store = Arc::new(o.store);
            std::fs::create_dir_all(&out)?;
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
        Cmd::Index { container, file } => {
            let src = Source::open(&file, false)?;
            for (o, l) in parse::index(Container::parse(&container)?, &src)? {
                println!("{o} {l}");
            }
            Ok(())
        }
    }
}
