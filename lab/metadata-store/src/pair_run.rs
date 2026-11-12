//! The pair's run, as pre-registered in docs/ingest/metadata-draft.md §2: page opens, updates, integrity, a reader
//! in a second process during updates, and size.

use crate::group::{self, Record};
use crate::pair::{self, Truth};
use crate::stores::{self, KeyFile, Paths};
use anyhow::{ensure, Result};
use std::path::Path;
use std::time::Instant;

const VALUES: [&[u8]; 2] = [b"-1000 ", b"-1024 "];

fn stats(mut t: Vec<f64>) -> serde_json::Value {
    t.sort_by(f64::total_cmp);
    let q = |p: f64| t[((t.len() - 1) as f64 * p).round() as usize];
    serde_json::json!({"rounds": t.len(), "p10": q(0.1), "median": q(0.5), "p90": q(0.9)})
}

fn size(path: &Path) -> u64 {
    let wal = path.with_extension("db-wal");
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) + std::fs::metadata(wal).map(|m| m.len()).unwrap_or(0)
}

pub fn run(dir: &Path, series: &[Record], template: &[Record], counts: &[u16], rounds: usize, updates: usize) -> Result<()> {
    for &n in counts {
        let dir = dir.join(format!("pair-n{n}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        let instances = group::synthetic_series(template, n);
        let paths = Paths::under(&dir);
        stores::build(&paths, series, &instances)?;
        let keys = KeyFile::open(&paths.keys, &paths.values)?;
        let truth: Vec<_> = instances.iter().map(|r| group::page_values(r.iter().map(|r| (r.tag(), r.value.clone())))).collect();
        let doc = pair::document(&truth);
        ensure!(pair::document(&keys.read_scan()) == doc, "D's scan gives another document");

        let arms = [(Truth::Groups, dir.join("t1.db")), (Truth::Attributes, dir.join("t2.db"))];
        let (mut writers, mut built) = (Vec::new(), Vec::new());
        for (truth_kind, path) in &arms {
            let w = pair::build(*truth_kind, path, series, &instances)?;
            w.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            built.push(size(path));
            writers.push(w);
            ensure!(pair::read_page(&pair::open(path)?)? == doc, "{truth_kind:?}: the page row is not the document");
        }
        let held: Vec<_> = arms.iter().map(|(_, p)| pair::open(p)).collect::<Result<_>>()?;

        // Part 1: the page open, five arms interleaved.
        let mut reads: Vec<(String, Vec<f64>)> = Vec::new();
        for (t, _) in &arms {
            reads.push((format!("{t:?} + V1, held"), vec![]));
            reads.push((format!("{t:?} + V1, opened"), vec![]));
        }
        reads.push(("D keys scan, held (reference)".into(), vec![]));
        for round in 0..rounds {
            for k in 0..reads.len() {
                let arm = (round + k) % reads.len();
                let t = Instant::now();
                match arm {
                    4 => drop(std::hint::black_box(keys.read_scan())),
                    a if a % 2 == 0 => drop(std::hint::black_box(pair::read_page(&held[a / 2])?)),
                    a => drop(std::hint::black_box(pair::read_page(&pair::open(&arms[a / 2].1)?)?)),
                }
                reads[arm].1.push(t.elapsed().as_secs_f64() * 1e6);
            }
        }
        for (name, t) in reads {
            println!("{}", serde_json::json!({"instances": n, "part": 1, "arm": name, "us": stats(t)}));
        }

        // Parts 2 and 3: one update (a new revision, the page row rebuilt, committed with fsync), and the rebuild alone.
        let target = (n as i64 + 1) / 2;
        let (mut upd, mut rebuild, mut bytes) = (vec![vec![]; 2], vec![vec![]; 2], vec![vec![]; 2]);
        for round in 0..updates {
            for k in 0..2 {
                let a = (round + k) % 2;
                let t = Instant::now();
                drop(std::hint::black_box(pair::rebuild(arms[a].0, &writers[a])?));
                rebuild[a].push(t.elapsed().as_secs_f64() * 1e3);
                let w = pair::written();
                let t = Instant::now();
                pair::update(arms[a].0, &mut writers[a], target, VALUES[round % 2], false)?;
                upd[a].push(t.elapsed().as_secs_f64() * 1e3);
                bytes[a].push((pair::written() - w) as f64);
            }
        }
        for (a, (t, _)) in arms.iter().enumerate() {
            let label = format!("{t:?} + V1");
            println!("{}", serde_json::json!({"instances": n, "part": 2, "arm": label, "update_ms": stats(upd[a].clone()), "bytes_written": stats(bytes[a].clone())}));
            println!("{}", serde_json::json!({"instances": n, "part": 3, "arm": label, "rebuild_ms": stats(rebuild[a].clone())}));
        }

        // The page row now holds the last update's value, and only it changed.
        let mut after = truth.clone();
        after[target as usize - 1][4] = Some(VALUES[(updates - 1) % 2].to_vec());
        for (a, (t, p)) in arms.iter().enumerate() {
            ensure!(pair::read_page(&pair::open(p)?)? == pair::document(&after), "{t:?}: the page row is not the update's");
            let t0 = Instant::now();
            let checked = pair::check_received(*t, &writers[a])?;
            println!("{}", serde_json::json!({"instances": n, "part": 4, "arm": format!("{t:?} + V1"), "groups_checked": checked, "ms": t0.elapsed().as_secs_f64() * 1e3}));
        }

        // Part 5: a second process reads the page row while this one commits updates.
        let valid: Vec<Vec<u8>> = VALUES
            .iter()
            .map(|v| {
                let mut p = truth.clone();
                p[target as usize - 1][4] = Some(v.to_vec());
                pair::document(&p)
            })
            .collect();
        for (a, (t, p)) in arms.iter().enumerate() {
            let (va, vb, stop) = (dir.join("valid-a"), dir.join("valid-b"), dir.join("stop"));
            std::fs::write(&va, &valid[0])?;
            std::fs::write(&vb, &valid[1])?;
            let _ = std::fs::remove_file(&stop);
            let iv = dir.join("intervals");
            let child = spawn_reader(p, &va, &vb, &stop, &iv, None)?;
            std::thread::sleep(std::time::Duration::from_millis(50));
            for round in 0..updates {
                pair::update(*t, &mut writers[a], target, VALUES[round % 2], false)?;
            }
            std::fs::write(&stop, b"")?;
            let out = child.wait_with_output()?;
            ensure!(out.status.success(), "the reader failed");
            let mut report: serde_json::Value = serde_json::from_slice(&out.stdout)?;
            let slowest = read_intervals(&iv)?.iter().map(|(s, e)| e - s).max().unwrap_or(0);
            report["slowest_read_us"] = (slowest as f64 / 1e3).into();
            println!("{}", serde_json::json!({"instances": n, "part": 5, "arm": format!("{t:?} + V1"), "updates": updates, "reader": report}));
        }

        // Part 6: size, after a checkpoint folds the WAL back into the file.
        let sizes = stores::on_disk(&paths)?;
        for (a, (t, p)) in arms.iter().enumerate() {
            writers[a].execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            println!("{}", serde_json::json!({"instances": n, "part": 6, "arm": format!("{t:?} + V1"), "bytes_as_built": built[a], "bytes_after_updates": size(p), "revisions_kept": 2 * updates}));
        }
        println!("{}", serde_json::json!({"instances": n, "part": 6, "four_stores": sizes, "page_document_bytes": doc.len()}));
    }
    Ok(())
}

fn spawn_reader(db: &Path, a: &Path, b: &Path, stop: &Path, intervals: &Path, core: Option<usize>) -> Result<std::process::Child> {
    let core = core.map_or("-".to_string(), |c| c.to_string());
    let args = [db, a, b, stop, intervals].map(|p| p.to_string_lossy().into_owned());
    Ok(std::process::Command::new(std::env::current_exe()?)
        .arg("--reader")
        .args(args)
        .arg(core)
        .stdout(std::process::Stdio::piped())
        .spawn()?)
}

fn read_intervals(path: &Path) -> Result<Vec<(u64, u64)>> {
    let bytes = std::fs::read(path)?;
    Ok(bytes
        .chunks_exact(16)
        .map(|c| (u64::from_le_bytes(c[..8].try_into().unwrap()), u64::from_le_bytes(c[8..].try_into().unwrap())))
        .collect())
}

fn tail(mut us: Vec<f64>) -> serde_json::Value {
    if us.is_empty() {
        return serde_json::json!({"reads": 0});
    }
    us.sort_by(f64::total_cmp);
    let q = |p: f64| us[((us.len() - 1) as f64 * p).round() as usize];
    serde_json::json!({"reads": us.len(), "p50": q(0.5), "p99": q(0.99), "p99_9": q(0.999), "max": us[us.len() - 1]})
}

/// The pair's two open items, pre-registered in docs/ingest/metadata-draft.md §2: (a) a patched page row against a
/// rebuilt one; (b) the reader's tail alone, beside commits on another core, and on the same core.
pub fn followup(dir: &Path, series: &[Record], template: &[Record], counts: &[u16], updates: usize) -> Result<()> {
    for &n in counts {
        let dir = dir.join(format!("followup-n{n}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        let instances = group::synthetic_series(template, n);
        let target = (n as i64 + 1) / 2;
        let arms = [(Truth::Groups, false), (Truth::Groups, true), (Truth::Attributes, false), (Truth::Attributes, true)];
        let mut dbs = Vec::new();
        for (i, (t, _)) in arms.iter().enumerate() {
            dbs.push(pair::build(*t, &dir.join(format!("arm{i}.db")), series, &instances)?);
        }
        let mut times = vec![vec![]; arms.len()];
        for round in 0..updates {
            for k in 0..arms.len() {
                let a = (round + k) % arms.len();
                let (t, patch) = arms[a];
                let start = Instant::now();
                pair::update(t, &mut dbs[a], target, VALUES[round % 2], patch)?;
                times[a].push(start.elapsed().as_secs_f64() * 1e3);
                ensure!(pair::read_page(&dbs[a])? == pair::document(&pair::rebuild(t, &dbs[a])?), "{t:?} patch={patch}: the page row is not a full rebuild's");
            }
        }
        for (a, (t, patch)) in arms.iter().enumerate() {
            let way = if *patch { "patched" } else { "rebuilt" };
            println!("{}", serde_json::json!({"instances": n, "item": "a", "arm": format!("{t:?} + V1, {way}"), "update_ms": stats(times[a].clone()), "equal_to_rebuild": true}));
        }
    }

    // (b) at the largest count, T1 + V1, the rebuilt update as the writer.
    let n = *counts.iter().max().unwrap_or(&2000);
    let dir = dir.join(format!("followup-n{n}"));
    let instances = group::synthetic_series(template, n);
    let truth: Vec<_> = instances.iter().map(|r| group::page_values(r.iter().map(|r| (r.tag(), r.value.clone())))).collect();
    let target = (n as i64 + 1) / 2;
    let path = dir.join("reader.db");
    let _ = std::fs::remove_file(&path);
    let mut db = pair::build(Truth::Groups, &path, series, &instances)?;
    let valid: Vec<Vec<u8>> = std::iter::once(pair::document(&truth))
        .chain(VALUES.iter().map(|v| {
            let mut p = truth.clone();
            p[target as usize - 1][4] = Some(v.to_vec());
            pair::document(&p)
        }))
        .collect();
    let (va, vb) = (dir.join("valid-a"), dir.join("valid-b"));
    std::fs::write(&va, &valid[1])?;
    std::fs::write(&vb, &valid[2])?;
    pair::update(Truth::Groups, &mut db, target, VALUES[0], false)?;
    pair::pin(0)?;
    let arm_names = ["reader alone, core 2", "beside commits, reader core 2, writer core 0", "beside commits, both core 0"];
    let mut reads: Vec<Vec<f64>> = vec![vec![]; 3];
    let (mut during, mut outside): (Vec<f64>, Vec<f64>) = (vec![], vec![]);
    let mut mixed = 0u64;
    for rep in 0..6 {
        for k in 0..3 {
            let arm = (rep + k) % 3;
            let (stop, iv) = (dir.join("stop"), dir.join("intervals"));
            let _ = std::fs::remove_file(&stop);
            let child = spawn_reader(&path, &va, &vb, &stop, &iv, Some(if arm == 2 { 0 } else { 2 }))?;
            std::thread::sleep(std::time::Duration::from_millis(50));
            let mut windows = Vec::new();
            for round in 0..updates {
                if arm == 0 {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    continue;
                }
                let s = pair::now_ns();
                pair::update(Truth::Groups, &mut db, target, VALUES[round % 2], false)?;
                windows.push((s, pair::now_ns()));
            }
            std::fs::write(&stop, b"")?;
            let out = child.wait_with_output()?;
            ensure!(out.status.success(), "the reader failed");
            let report: serde_json::Value = serde_json::from_slice(&out.stdout)?;
            mixed += report["neither_before_nor_after"].as_u64().unwrap_or(1);
            for (s, e) in read_intervals(&iv)? {
                let us = (e - s) as f64 / 1e3;
                reads[arm].push(us);
                if arm == 1 {
                    if windows.iter().any(|(ws, we)| s < *we && e > *ws) { during.push(us) } else { outside.push(us) }
                }
            }
        }
    }
    for (arm, name) in arm_names.iter().enumerate() {
        println!("{}", serde_json::json!({"instances": n, "item": "b", "arm": name, "read_us": tail(reads[arm].clone())}));
    }
    println!("{}", serde_json::json!({"instances": n, "item": "b", "arm": "beside commits, apart: reads overlapping a commit window", "read_us": tail(during)}));
    println!("{}", serde_json::json!({"instances": n, "item": "b", "arm": "beside commits, apart: reads outside every window", "read_us": tail(outside)}));
    println!("{}", serde_json::json!({"instances": n, "item": "b", "neither_before_nor_after": mixed, "updates_per_arm_and_rep": updates, "reps": 6}));
    Ok(())
}
