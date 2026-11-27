//! σ of every frame of one series in `mirror.py`'s output, one JSON row a frame: docs/av1/noise-point.md §Protocol.
//!
//! usage: sigma-bench SERIES_DIR [--mask TABLE] [--cut]
//!   TABLE: one byte a stored value, 1 if in-window (mask.py); --cut: σ on the 10-bit cut the ingest would encode

#[path = "../../../../ingest/from-parser/src/group.rs"]
mod group;

use anyhow::{bail, ensure, Context, Result};
use std::path::{Path, PathBuf};

const CUT_DEPTH: u32 = 10;

struct Series {
    frames: Vec<PathBuf>,
    w: usize,
    h: usize,
    allocated: u32,
    bits: u32,
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(dir) = args.first() else { bail!("usage: sigma-bench SERIES_DIR [--mask TABLE] [--cut]") };
    let mut mask = None;
    let mut cut = false;
    let mut rest = args[1..].iter();
    while let Some(a) = rest.next() {
        match a.as_str() {
            "--mask" => mask = Some(std::fs::read(rest.next().context("--mask TABLE")?)?),
            "--cut" => cut = true,
            _ => bail!("unknown argument {a}"),
        }
    }
    let s = series(Path::new(dir))?;
    ensure!(!cut || s.bits > CUT_DEPTH, "--cut on {} bits: the ingest cuts only over {CUT_DEPTH}", s.bits);
    for (i, path) in s.frames.iter().enumerate() {
        let stored = samples(&std::fs::read(path)?, &s)?;
        let inside = match &mask {
            Some(t) => Some(stored.iter().map(|&v| t.get(v as usize).map(|&b| b == 1)).collect::<Option<Vec<_>>>()
                .context("a stored value past the mask table")?),
            None => None,
        };
        let coded: Vec<i32> = if cut { stored.iter().map(|&v| ten_bit_cut(v, s.bits)).collect() } else { stored };
        let t0 = thread_cpu_ns();
        let (sigma, kept) = noise_ingest::sigma_and_kept(&coded, s.w, s.h, inside.as_deref());
        let cpu = thread_cpu_ns() - t0;
        println!(r#"{{"frame":{i},"sigma":{sigma:?},"kept":{kept},"cpu_ns":{cpu}}}"#);
    }
    Ok(())
}

/// As `optimal::coded` cuts an unsigned source over 10 bits: round half up, clamp.
fn ten_bit_cut(v: i32, bits: u32) -> i32 {
    ((v + (1 << (bits - CUT_DEPTH - 1))) >> (bits - CUT_DEPTH)).min((1 << CUT_DEPTH) - 1)
}

fn series(dir: &Path) -> Result<Series> {
    let instances: Vec<PathBuf> = entries(dir)?.into_iter().filter(|p| p.is_dir()).collect();
    ensure!(instances.len() == 1, "{} instances; one a series", instances.len());
    let files = entries(&instances[0])?;
    let name = |p: &PathBuf| p.file_name().unwrap().to_string_lossy().into_owned();
    let group = files.iter().find(|p| name(p).starts_with("----.")).context("no instance group file")?;
    let r = group::records(&std::fs::read(group)?)?;
    ensure!(group::us(&r, (0x0028, 0x0002))? == 1, "grey only");
    ensure!(group::us(&r, (0x0028, 0x0103))? == 0, "unsigned only");
    let frames: Vec<PathBuf> = files.iter().filter(|p| name(p).ends_with(".OPC")).cloned().collect();
    let count: usize = group::text(&r, (0x0028, 0x0008)).context("no frame count")?.parse()?;
    ensure!(frames.len() == count, "{} frame files, {count} frames", frames.len());
    Ok(Series {
        frames,
        w: group::us(&r, (0x0028, 0x0011))? as usize,
        h: group::us(&r, (0x0028, 0x0010))? as usize,
        allocated: group::us(&r, (0x0028, 0x0100))? as u32,
        bits: group::us(&r, (0x0028, 0x0101))? as u32,
    })
}

fn samples(raw: &[u8], s: &Series) -> Result<Vec<i32>> {
    let width = s.allocated as usize / 8;
    ensure!(raw.len() == s.w * s.h * width, "{} bytes, {} expected", raw.len(), s.w * s.h * width);
    Ok(match width {
        1 => raw.iter().map(|&b| b as i32).collect(),
        _ => raw.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]]) as i32).collect(),
    })
}

fn entries(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
        .with_context(|| format!("read {}", dir.display()))?
        .map(|e| e.map(|e| e.path()))
        .collect::<Result<_, _>>()?;
    out.sort();
    Ok(out)
}

fn thread_cpu_ns() -> u64 {
    let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `t` is a valid, writable timespec for the duration of the call.
    let rc = unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    assert_eq!(rc, 0, "clock_gettime(CLOCK_THREAD_CPUTIME_ID)");
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}
