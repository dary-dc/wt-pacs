//! Row 172's writer arms and their instruments: a `.sbnd` written as `pack-series` writes it but with
//! another buffer or a preallocation, written past the page cache and warmed, and the page-cache
//! folios each frame sits in. `docs/disk-layout/README.md` §The writer has the protocol.

use anyhow::{bail, ensure, Context, Result};
use container_bench::folio::{direct, pages, resident, residency, PAGE};
use clap::{Parser, Subcommand};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};
use std::time::Duration;


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
