use crate::study::{self, percentile, POINT};
use crate::Args;
use anyhow::{Context, Result};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

const PASSES: usize = 3;
const LARGE: usize = 10;

fn fds() -> Result<usize> {
    Ok(std::fs::read_dir("/proc/self/fd")?.count())
}

fn rss_bytes() -> Result<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm")?;
    let pages: u64 = statm.split_whitespace().nth(1).context("statm")?.parse()?;
    Ok(pages * 4096)
}

fn side_files(db: &Path) -> Result<Vec<String>> {
    let name = db.file_name().unwrap().to_string_lossy().into_owned();
    let mut v: Vec<String> = std::fs::read_dir(db.parent().unwrap())?
        .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
        .filter(|f| f.starts_with(&name) && *f != name)
        .collect();
    v.sort();
    Ok(v)
}

fn paths(dir: &Path, files: usize) -> Vec<(PathBuf, usize, usize)> {
    (0..files + LARGE)
        .map(|i| {
            let instances = if i < files { 2000 } else { 10_000 };
            (dir.join(format!("s{i:05}.db")), i, instances)
        })
        .collect()
}

pub fn run(args: &Args) -> Result<()> {
    let dir = PathBuf::from(args.str("dir", "target/files"));
    let files: usize = args.get("files", 1000);
    let rounds: usize = args.get("rounds", 5);
    std::fs::create_dir_all(&dir)?;
    for (path, i, instances) in paths(&dir, files) {
        if !path.exists() || std::fs::metadata(&path)?.len() == 0 {
            study::build(&path, i, instances)?;
        }
    }
    let exe = std::env::current_exe()?;
    for r in 0..rounds {
        let order = if r % 2 == 0 { ["rusqlite", "turso"] } else { ["turso", "rusqlite"] };
        for engine in order {
            for (path, _, _) in paths(&dir, files) {
                for side in side_files(&path)? {
                    std::fs::remove_file(dir.join(side))?;
                }
            }
            let out = Command::new(&exe)
                .args(["files-child", "--engine", engine, "--dir"])
                .arg(&dir)
                .args(["--files", &files.to_string(), "--round", &r.to_string()])
                .output()?;
            anyhow::ensure!(out.status.success(), "{engine}: {}", String::from_utf8_lossy(&out.stderr));
            print!("{}", String::from_utf8_lossy(&out.stdout));
        }
    }
    Ok(())
}

enum Held {
    Rusqlite(rusqlite::Connection),
    Turso(turso::Connection),
}

async fn read_one(held: &Held, uid: &str) -> Result<usize> {
    Ok(match held {
        Held::Rusqlite(c) => {
            c.prepare_cached(POINT)?.query_row([uid], |row| Ok(row.get_ref(0)?.as_blob()?.len()))?
        }
        Held::Turso(c) => {
            let mut rows = c.prepare_cached(POINT).await?.query([uid]).await?;
            let row = rows.next().await?.context("no row")?;
            row.get_value(0)?.as_blob().map_or(0, Vec::len)
        }
    })
}

async fn open(engine: &str, path: &Path) -> Result<Held> {
    Ok(if engine == "turso" {
        let db = turso::Builder::new_local(path.to_str().unwrap()).build().await?;
        Held::Turso(db.connect()?)
    } else {
        Held::Rusqlite(rusqlite::Connection::open(path)?)
    })
}

async fn insert(held: &Held) -> Result<()> {
    let sql = format!("INSERT INTO groups VALUES ('inserted.{}', 2, 'x', zeroblob(1024), 0)", std::process::id());
    match held {
        Held::Rusqlite(c) => drop(c.execute(&sql, [])?),
        Held::Turso(c) => drop(c.execute(&sql, ()).await?),
    }
    Ok(())
}

pub fn child(args: &Args) -> Result<()> {
    let engine = args.str("engine", "rusqlite");
    let dir = PathBuf::from(args.str("dir", "target/files"));
    let files: usize = args.get("files", 1000);
    let round: usize = args.get("round", 0);
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    rt.block_on(async {
        let all = paths(&dir, files);
        let (fd0, rss0) = (fds()?, rss_bytes()?);
        let mut held = Vec::new();
        let mut open_us = Vec::new();
        for (path, i, instances) in &all {
            let t = Instant::now();
            let h = open(&engine, path).await?;
            anyhow::ensure!(read_one(&h, &study::instance_uid(*i, instances / 2)).await? == study::BODY);
            open_us.push(t.elapsed().as_secs_f64() * 1e6);
            held.push(h);
        }
        let (fd1, rss1) = (fds()?, rss_bytes()?);
        let mut read_us = Vec::new();
        let mut x = 0x2545_F491_4F6C_DD1Du64 ^ round as u64;
        for _ in 0..PASSES {
            for ((_, i, instances), h) in all.iter().zip(&held) {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                let t = Instant::now();
                read_one(h, &study::instance_uid(*i, x as usize % instances)).await?;
                read_us.push(t.elapsed().as_secs_f64() * 1e6);
            }
        }
        let after_read = side_files(&all[0].0)?;
        insert(&held[0]).await?;
        let after_insert = side_files(&all[0].0)?;
        let n = all.len() as f64;
        let large: Vec<f64> = open_us[files..].to_vec();
        open_us.truncate(files);
        open_us.sort_by(f64::total_cmp);
        read_us.sort_by(f64::total_cmp);
        let mut large = large;
        large.sort_by(f64::total_cmp);
        println!(
            "{}",
            json!({"engine": engine, "round": round, "files": all.len(),
                   "open_us": {"p50": percentile(&open_us, 0.5), "p99": percentile(&open_us, 0.99)},
                   "open_us_10000": {"p50": percentile(&large, 0.5), "max": large.last()},
                   "fds_per_file": (fd1 - fd0) as f64 / n, "rss_kib_per_file": (rss1 - rss0) as f64 / n / 1024.0,
                   "held_read_us": {"p50": percentile(&read_us, 0.5), "p99": percentile(&read_us, 0.99)},
                   "side_after_read": after_read, "side_after_insert": after_insert})
        );
        anyhow::Ok(())
    })
}
