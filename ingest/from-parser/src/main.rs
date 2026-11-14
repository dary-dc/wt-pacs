//! The site's ingest, phase 1: a series of the parser's directory output to a `.sbnd`, written only if every frame
//! decodes back to the samples it was coded from — docs/ingest/contract.md; with `--optimal-quality`, its
//! optimal-quality series beside it.

mod group;
mod htj2k;
mod optimal;

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
    /// Experimental, off by default: after OUTPUT, its optimal-quality series at Q (1 to 63, 8 if bare) beside it as
    /// `<stem>-q<Q>-g<G>[-cut].sbnd` — docs/av1/payload-format.md §Optimal quality.
    #[arg(long, value_name = "Q", num_args = 0..=1, default_missing_value = optimal::DEFAULT_Q,
          value_parser = clap::value_parser!(u32).range(1..=63))]
    optimal_quality: Option<u32>,
    /// The optimal-quality series' frames a group, its keyframe distance.
    #[arg(long, value_name = "G", default_value_t = optimal::DEFAULT_G, requires = "optimal_quality",
          value_parser = clap::value_parser!(u64).range(1..))]
    group: u64,
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
#[derive(Serialize, Clone)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    digests: Option<Digests>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lossy: Option<Lossy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exact_series: Option<String>,
    source_fingerprint: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Lossy {
    q: u32,
    g: usize,
    depth: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    bits_stored: Option<u32>,
}

#[derive(Serialize, Clone)]
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

struct Exact {
    series: Series,
    meta: Metadata,
}

fn main() -> ExitCode {
    let args = Args::parse();
    let name = args.series.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let exact = match ingest(&args) {
        Ok((exact, line)) => {
            println!("{name}: {line}");
            exact
        }
        Err(e) => {
            eprintln!("{name}: nothing written — {e:#}");
            return ExitCode::FAILURE;
        }
    };
    let Some(q) = args.optimal_quality else { return ExitCode::SUCCESS };
    match optimal_series(&args, &exact, q) {
        Ok(line) => {
            println!("{name}: {line}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{name}: the exact series alone; no optimal-quality series written — {e:#}");
            ExitCode::FAILURE
        }
    }
}

fn ingest(args: &Args) -> Result<(Exact, String)> {
    htj2k::pinned()?;
    if args.optimal_quality.is_some() {
        optimal::pinned()?;
    }
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
    let frame_digests: Vec<String> = coded.iter().map(|c| format!("{:016x}", c.digest)).collect();
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
        source_fingerprint: source_fingerprint(&frame_digests),
        digests: Some(Digests { algorithm: "xxh3-64", frames: frame_digests }),
        lossy: None,
        exact_series: None,
    };
    let frames: Vec<&[u8]> = coded.iter().map(|c| c.codestream.as_slice()).collect();
    series_bundle::write_bundle(&args.output, &metadata_json(&meta)?, &frames)?;
    let bytes: usize = frames.iter().map(|c| c.len()).sum();
    let line = format!("{} frames, {bytes} B htj2k, every one exact → {}", s.count, args.output.display());
    Ok((Exact { series: s, meta }, line))
}

/// Written only after its exact series, from the same samples, each frame checked against the exact series' digest.
fn optimal_series(args: &Args, exact: &Exact, q: u32) -> Result<String> {
    let (s, m) = (&exact.series, &exact.meta);
    let form = optimal::form(&s.frame, m.min, m.max, q, args.group as usize)?;
    let digests = &m.digests.as_ref().expect("an exact series has digests").frames;
    let groups: Vec<usize> = (0..s.count).step_by(form.g).collect();
    let jobs = args.jobs.max(1);
    let code_group = |k: usize| -> Result<Vec<Vec<u8>>> {
        let frames = (k..s.count.min(k + form.g))
            .map(|i| {
                let px = read(s, i)?;
                ensure!(format!("{:016x}", digest(&s.frame, &px)) == digests[i], "frame {i} changed since its exact series was written");
                Ok(px.iter().map(|&v| optimal::coded(&form, v)).collect())
            })
            .collect::<Result<Vec<_>>>()?;
        optimal::group(&s.frame, &form, &frames).with_context(|| format!("the group from frame {k}"))
    };
    let coded: Vec<Vec<u8>> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..jobs)
            .map(|j| {
                let (groups, code_group) = (&groups, &code_group);
                scope.spawn(move || groups.iter().skip(j).step_by(jobs).map(|&k| (k, code_group(k))).collect::<Vec<_>>())
            })
            .collect();
        let mut done: Vec<_> = workers.into_iter().flat_map(|w| w.join().expect("a worker panicked")).collect();
        done.sort_by_key(|(k, _)| *k);
        done.into_iter().map(|(_, units)| units).collect::<Result<Vec<_>>>().map(|g| g.concat())
    })?;

    let stem = args.output.file_stem().context("OUTPUT has no file name")?.to_string_lossy().into_owned();
    let cut = if form.cut.is_some() { "-cut" } else { "" };
    let path = args.output.with_file_name(format!("{stem}-q{q}-g{}{cut}.sbnd", form.g));
    let lossy = Lossy { q, g: form.g, depth: form.depth, bits_stored: form.cut };
    let meta = Metadata { codec: "av1", digests: None, lossy: Some(lossy), exact_series: Some(stem), ..m.clone() };
    let frames: Vec<&[u8]> = coded.iter().map(Vec::as_slice).collect();
    series_bundle::write_bundle(&path, &metadata_json(&meta)?, &frames)?;
    let bytes: usize = frames.iter().map(|c| c.len()).sum();
    Ok(format!("{} frames, {bytes} B optimal quality Q {q} G {}{cut}, every one decoded from its keyframe → {}", s.count, form.g, path.display()))
}

/// XXH3-64 over the frame digests in order: docs/av1/payload-format.md §Source fingerprint.
fn source_fingerprint(frame_digests: &[String]) -> String {
    format!("{:016x}", xxh3_64(frame_digests.concat().as_bytes()))
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

fn read(s: &Series, i: usize) -> Result<Vec<i32>> {
    let path = s.instance.join(format!("{:05}.{}", i + 1, s.suffix));
    let raw = std::fs::read(&path).with_context(|| format!("read {}", path.display()))?;
    samples(&raw, s)
}

fn code(s: &Series, i: usize) -> Result<Coded> {
    let samples = read(s, i)?;
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
