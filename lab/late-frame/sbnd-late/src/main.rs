//! `sbnd-late build OUT FRAME...` packs a series; `sbnd-late merge FILE POS [--fsync] FRAME...`
//! rewrites FILE with the frames inserted before entry POS and renames it over FILE.
//! `merge` prints one JSON line: bytes read, bytes written, wall nanoseconds.

use anyhow::{bail, Context, Result};
use series_bundle::{read_layout, write_bundle, BundleWriter};
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::path::Path;
use std::time::Instant;

const METADATA: &[u8] = b"{}";

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("build") => build(Path::new(&args[1]), &args[2..]),
        Some("merge") => {
            let fsync = args.get(3).is_some_and(|a| a == "--fsync");
            let late = &args[if fsync { 4 } else { 3 }..];
            merge(Path::new(&args[1]), args[2].parse()?, fsync, late)
        }
        _ => bail!("usage: sbnd-late build OUT FRAME... | merge FILE POS [--fsync] FRAME..."),
    }
}

fn build(out: &Path, frames: &[String]) -> Result<()> {
    let bytes: Vec<Vec<u8>> = frames.iter().map(std::fs::read).collect::<Result<_, _>>()?;
    let refs: Vec<&[u8]> = bytes.iter().map(Vec::as_slice).collect();
    write_bundle(out, METADATA, &refs)
}

fn merge(path: &Path, pos: usize, fsync: bool, late: &[String]) -> Result<()> {
    let late: Vec<Vec<u8>> = late.iter().map(std::fs::read).collect::<Result<_, _>>()?;
    let start = Instant::now();
    let old = File::open(path).context("open series")?;
    let layout = read_layout(&old)?;
    let mut read = layout.data_base as u64;
    let mut lengths: Vec<u32> = layout.index.iter().map(|&(_, len)| len).collect();
    let at = pos.min(lengths.len());
    lengths.splice(at..at, late.iter().map(|f| f.len() as u32));

    let mut writer = BundleWriter::create(path, layout.metadata.as_bytes(), &lengths)?;
    let mut buf = Vec::new();
    for (i, &(offset, len)) in layout.index.iter().enumerate() {
        if i == at {
            late.iter().try_for_each(|f| writer.write_frame(f))?;
        }
        buf.resize(len as usize, 0);
        old.read_exact_at(&mut buf, offset)?;
        read += u64::from(len);
        writer.write_frame(&buf)?;
    }
    if at == layout.index.len() {
        late.iter().try_for_each(|f| writer.write_frame(f))?;
    }
    writer.finish()?;
    // The crate's writer does not sync: this syncs after the rename, which costs the same bytes.
    if fsync {
        File::open(path)?.sync_all()?;
        let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
        File::open(dir)?.sync_all()?;
    }
    let wall = start.elapsed().as_nanos();
    let written = std::fs::metadata(path)?.len();
    println!(r#"{{"read":{read},"written":{written},"wall_ns":{wall}}}"#);
    Ok(())
}
