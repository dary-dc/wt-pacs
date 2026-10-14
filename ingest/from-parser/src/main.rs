//! The site's ingest, phase 1: a series of the parser's directory output to a `.sbnd`, written only if every frame
//! decodes back to the samples it was coded from — docs/ingest/contract.md.

mod group;
mod htj2k;

use anyhow::{bail, ensure, Context, Result};
use clap::Parser;
use htj2k::Frame;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use xxhash_rust::xxh3::xxh3_64;

#[derive(Parser)]
#[command(name = "from-parser")]
struct Args {
    /// `<D>/<E>/<S>/`: one series of the parser's output.
    series: PathBuf,
    output: PathBuf,
    #[arg(long, default_value_t = 4)]
    jobs: usize,
}

struct Series {
    instance: PathBuf,
    frame: Frame,
    allocated: u32,
    photometric: String,
    count: usize,
    suffix: &'static str,
}

/// The keys `from_dicom.py` writes that the frame attributes decide, in its order; the rest is phase 2's.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    frame_count: usize,
    width: u32,
    height: u32,
    channels: u32,
    bits_allocated: u32,
    bits_stored: u32,
    high_bit: u32,
    signed: bool,
    photometric: String,
    min: i32,
    max: i32,
    codec: &'static str,
    digests: Digests,
}

#[derive(Serialize)]
struct Digests {
    algorithm: &'static str,
    frames: Vec<String>,
}

struct Coded {
    codestream: Vec<u8>,
    digest: u64,
    min: i32,
    max: i32,
}

fn main() -> ExitCode {
    let args = Args::parse();
    let name = args.series.file_name().unwrap_or_default().to_string_lossy().into_owned();
    match ingest(&args) {
        Ok(line) => {
            println!("{name}: {line}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{name}: nothing written — {e:#}");
            ExitCode::FAILURE
        }
    }
}

fn ingest(args: &Args) -> Result<String> {
    htj2k::pinned()?;
    let s = series(&args.series)?;
    let jobs = args.jobs.max(1);
    let mut coded: Vec<(usize, Result<Coded>)> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..jobs)
            .map(|j| {
                let s = &s;
                scope.spawn(move || (j..s.count).step_by(jobs).map(|i| (i, code(s, i))).collect::<Vec<_>>())
            })
            .collect();
        workers.into_iter().flat_map(|w| w.join().expect("a worker panicked")).collect()
    });
    coded.sort_by_key(|(i, _)| *i);
    let coded = coded.into_iter().map(|(i, c)| c.with_context(|| format!("frame {i}"))).collect::<Result<Vec<_>>>()?;

    let f = &s.frame;
    let meta = Metadata {
        frame_count: s.count,
        width: f.w,
        height: f.h,
        channels: f.comps,
        bits_allocated: s.allocated,
        bits_stored: f.bits,
        high_bit: f.bits - 1,
        signed: f.signed,
        photometric: s.photometric.clone(),
        min: coded.iter().map(|c| c.min).min().unwrap_or(0),
        max: coded.iter().map(|c| c.max).max().unwrap_or(0),
        codec: "htj2k",
        digests: Digests { algorithm: "xxh3-64", frames: coded.iter().map(|c| format!("{:016x}", c.digest)).collect() },
    };
    let frames: Vec<&[u8]> = coded.iter().map(|c| c.codestream.as_slice()).collect();
    series_bundle::write_bundle(&args.output, &metadata_json(&meta)?, &frames)?;
    let bytes: usize = frames.iter().map(|c| c.len()).sum();
    Ok(format!("{} frames, {bytes} B htj2k, every one exact → {}", s.count, args.output.display()))
}

/// `json.dumps(meta, indent=1) + "\n"`, as `from_dicom.py` writes it.
fn metadata_json(meta: &Metadata) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut out, serde_json::ser::PrettyFormatter::with_indent(b" "));
    meta.serialize(&mut ser)?;
    out.push(b'\n');
    Ok(out)
}

fn series(dir: &Path) -> Result<Series> {
    let instances: Vec<PathBuf> = subdirectories(dir)?;
    ensure!(instances.len() == 1, "{} instances; phase 1 reads one a series", instances.len());
    let instance = instances.into_iter().next().unwrap();
    let group = files(&instance)?.into_iter().find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("----.")));
    let group = group.with_context(|| format!("no instance group in {}", instance.display()))?;
    let r = group::records(&std::fs::read(&group)?).with_context(|| format!("{}", group.display()))?;

    let comps = group::us(&r, (0x0028, 0x0002))? as u32;
    let photometric = group::text(&r, (0x0028, 0x0004)).context("no (0028,0004)")?;
    if r.contains_key(&(0x0028, 0x0006)) {
        ensure!(group::us(&r, (0x0028, 0x0006))? == 0, "planar configuration 1: the frames are read interleaved");
    }
    let count = match group::text(&r, (0x0028, 0x0008)) {
        Some(n) => n.parse::<usize>().context("(0028,0008) is not a number")?.max(1),
        None => 1,
    };
    let allocated = group::us(&r, (0x0028, 0x0100))? as u32;
    let bits = group::us(&r, (0x0028, 0x0101))? as u32;
    let high = group::us(&r, (0x0028, 0x0102))? as u32;
    ensure!(allocated == 8 || allocated == 16, "{allocated} bits allocated");
    ensure!((1..=allocated).contains(&bits) && high + 1 == bits, "{bits} bits stored, high bit {high}");
    let suffix = match (photometric.as_str(), comps) {
        ("MONOCHROME1" | "MONOCHROME2", 1) => "OPC",
        ("RGB", 3) => "RGB",
        (p, c) => bail!("{p} with {c} samples a pixel: no frame file this ingest reads"),
    };
    let frame = Frame {
        w: group::us(&r, (0x0028, 0x0011))? as u32,
        h: group::us(&r, (0x0028, 0x0010))? as u32,
        comps,
        bits,
        signed: group::us(&r, (0x0028, 0x0103))? == 1,
    };
    Ok(Series { instance, frame, allocated, photometric, count, suffix })
}

fn code(s: &Series, i: usize) -> Result<Coded> {
    let path = s.instance.join(format!("{:05}.{}", i + 1, s.suffix));
    let raw = std::fs::read(&path).with_context(|| format!("read {}", path.display()))?;
    let samples = samples(&raw, s)?;
    let digest = digest(&s.frame, &samples);
    let codestream = htj2k::encode(&s.frame, &samples)?;
    if digest != self::digest(&s.frame, &htj2k::decode(&s.frame, &codestream)?) {
        bail!("does not decode back to its source");
    }
    let min = samples.iter().copied().min().unwrap_or(0);
    let max = samples.iter().copied().max().unwrap_or(0);
    Ok(Coded { codestream, digest, min, max })
}

fn samples(raw: &[u8], s: &Series) -> Result<Vec<i32>> {
    let width = s.allocated as usize / 8;
    ensure!(raw.len() == s.frame.len() * width, "{} bytes, not {}", raw.len(), s.frame.len() * width);
    Ok(match (width, s.frame.signed) {
        (1, false) => raw.iter().map(|&b| b as i32).collect(),
        (1, true) => raw.iter().map(|&b| b as i8 as i32).collect(),
        (_, false) => raw.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]]) as i32).collect(),
        (_, true) => raw.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as i32).collect(),
    })
}

/// The raw-frame check and the client's digest at once: XXH3-64 of the samples as decodeFrame hands them on,
/// two bytes a sample over 8 bits — docs/FIXTURES.md §Frame digests.
fn digest(f: &Frame, samples: &[i32]) -> u64 {
    let bytes: Vec<u8> = if f.bits > 8 {
        samples.iter().flat_map(|&v| (v as u16).to_le_bytes()).collect()
    } else {
        samples.iter().map(|&v| v as u8).collect()
    };
    xxh3_64(&bytes)
}

fn entries(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).with_context(|| format!("read {}", dir.display()))? {
        out.push(e?.path());
    }
    out.sort();
    Ok(out)
}

fn subdirectories(dir: &Path) -> Result<Vec<PathBuf>> {
    Ok(entries(dir)?.into_iter().filter(|p| p.is_dir()).collect())
}

fn files(dir: &Path) -> Result<Vec<PathBuf>> {
    Ok(entries(dir)?.into_iter().filter(|p| p.is_file()).collect())
}
