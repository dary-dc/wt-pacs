use crate::blocking::rusqlite_open;
use crate::study::{self, percentile, POINT};
use crate::Args;
use anyhow::{Context, Result};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};
use std::time::Instant;

const PASSES: usize = 3;
const LARGE: usize = 10;

fn fds() -> Result<usize> {
    Ok(std::fs::read_dir("/proc/self/fd")?.count())
}

/// RSS, its anonymous part and its file-backed part, in KiB.
fn rss_kib() -> Result<[f64; 3]> {
    let status = std::fs::read_to_string("/proc/self/status")?;
    let field = |name: &str| -> Result<f64> {
        let line = status.lines().find(|l| l.starts_with(name)).context("status")?;
        Ok(line.split_whitespace().nth(1).context("status")?.parse()?)
    };
    Ok([field("VmRSS:")?, field("RssAnon:")?, field("RssFile:")?])
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
        Held::Rusqlite(c) => c.prepare_cached(POINT)?.query_row([uid], |row| Ok(row.get_ref(0)?.as_blob()?.len()))?,
        Held::Turso(c) => {
            let mut rows = c.prepare_cached(POINT).await?.query([uid]).await?;
            let row = rows.next().await?.context("no row")?;
            row.get_value(0)?.as_blob().map_or(0, Vec::len)
        }
    })
}

fn shared_ring() -> Arc<dyn turso::core::IO> {
    static RING: OnceLock<Arc<dyn turso::core::IO>> = OnceLock::new();
    RING.get_or_init(|| Arc::new(turso::core::UringIO::new().expect("io_uring"))).clone()
}

async fn open(engine: &str, path: &Path) -> Result<Held> {
    let b = turso::Builder::new_local(path.to_str().unwrap());
    let b = match engine {
        "rusqlite" | "rusqlite-tuned" => return Ok(Held::Rusqlite(rusqlite_open(path, engine == "rusqlite-tuned", 0)?)),
        "turso" => b,
        "turso-uring" => b.with_io("io_uring"),
        "turso-uring-shared" => b.with_io_impl(shared_ring()),
        _ => anyhow::bail!("unknown engine {engine}"),
    };
    Ok(Held::Turso(b.build().await?.connect()?))
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
    if args.has("no-thp") {
        // SAFETY: PR_SET_THP_DISABLE takes integer arguments only and changes this process's huge-page policy.
        anyhow::ensure!(unsafe { libc::prctl(libc::PR_SET_THP_DISABLE, 1, 0, 0, 0) } == 0, "PR_SET_THP_DISABLE");
    }
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    rt.block_on(async {
        let all = paths(&dir, files);
        let (fd0, rss0) = (fds()?, rss_kib()?);
        let mut held = Vec::new();
        let mut open_us = Vec::new();
        for (path, i, instances) in &all {
            let t = Instant::now();
            let h = open(&engine, path).await?;
            anyhow::ensure!(read_one(&h, &study::instance_uid(*i, instances / 2)).await? == study::BODY);
            open_us.push(t.elapsed().as_secs_f64() * 1e6);
            held.push(h);
        }
        let (fd1, rss1) = (fds()?, rss_kib()?);
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
        let after_insert = if engine == "rusqlite-tuned" {
            vec!["read-only".into()]
        } else {
            insert(&held[0]).await?;
            side_files(&all[0].0)?
        };
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
                   "fds_per_file": (fd1 - fd0) as f64 / n, "rss_kib_per_file": (rss1[0] - rss0[0]) / n,
                   "anon_kib_per_file": (rss1[1] - rss0[1]) / n, "file_kib_per_file": (rss1[2] - rss0[2]) / n,
                   "build": crate::BUILD, "no_thp": args.has("no-thp"),
                   "held_read_us": {"p50": percentile(&read_us, 0.5), "p99": percentile(&read_us, 0.99)},
                   "side_after_read": after_read, "side_after_insert": after_insert})
        );
        anyhow::Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every engine of the open-files arms opens a study and reads one instance's 1 KB body; two Turso
    /// databases on the shared ring both read.
    #[tokio::test]
    async fn every_engine_reads_one_instance() {
        let dir = std::env::temp_dir().join(format!("sqlite-engine-files-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let paths: Vec<PathBuf> = (0..2).map(|i| dir.join(format!("s{i}.db"))).collect();
        for (i, p) in paths.iter().enumerate() {
            study::build(p, i, 20).unwrap();
        }
        let uring = turso::core::UringIO::new().is_ok();
        for engine in ["rusqlite", "rusqlite-tuned", "turso", "turso-uring", "turso-uring-shared"] {
            if engine.contains("uring") && !uring {
                continue;
            }
            for (i, p) in paths.iter().enumerate() {
                let held = open(engine, p).await.unwrap();
                assert_eq!(read_one(&held, &study::instance_uid(i, 7)).await.unwrap(), study::BODY, "{engine}");
            }
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
