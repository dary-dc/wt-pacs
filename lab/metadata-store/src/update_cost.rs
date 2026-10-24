//! One update of stored metadata, patched in place against a new revision directory, as pre-registered in
//! lab/metadata-store/README.md (`--mode update-cost`).

use crate::group::{self, Record};
use crate::pair::{self, Truth};
use crate::revision;
use anyhow::{ensure, Result};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const VALUES: [&[u8]; 2] = [b"-1000 ", b"-1024 "];
const WRITER_CORE: usize = 0;
const READER_CORE: usize = 2;

#[derive(Clone, Copy, PartialEq)]
enum Model {
    Patched,
    Revision,
}

impl Model {
    fn name(self) -> &'static str {
        match self {
            Model::Patched => "patched",
            Model::Revision => "revision",
        }
    }
}

/// One store under test: a WAL file with its writer, or a study directory.
enum Store {
    Patched(PathBuf, rusqlite::Connection),
    Revision(PathBuf),
}

impl Store {
    fn new(model: Model, path: PathBuf, series: &[Record], instances: &[Vec<Record>]) -> Result<Store> {
        Ok(match model {
            Model::Patched => {
                let db = pair::build(Truth::Groups, &path, series, instances)?;
                Store::Patched(path, db)
            }
            Model::Revision => {
                revision::create(&path, series, instances)?;
                Store::Revision(path)
            }
        })
    }

    fn update(&mut self, instance: u32, value: &[u8]) -> Result<()> {
        match self {
            Store::Patched(_, db) => pair::update(Truth::Groups, db, instance as i64, value, true),
            Store::Revision(study) => revision::update(study, instance, value),
        }
    }

    /// What a page open reads now, from a handle opened for it.
    fn read_new(&self) -> Result<Vec<u8>> {
        match self {
            Store::Patched(path, _) => pair::read_page(&pair::open(path)?),
            Store::Revision(study) => Ok(revision::read_live(study)?.0),
        }
    }

    fn path(&self) -> &Path {
        match self {
            Store::Patched(p, _) | Store::Revision(p) => p,
        }
    }

    fn tidy(&self) -> Result<()> {
        match self {
            Store::Patched(..) => Ok(()),
            Store::Revision(study) => revision::tidy(study),
        }
    }
}

fn thread_cpu_ms() -> f64 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `ts` is a valid, writable timespec for the duration of the call.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts) };
    ts.tv_sec as f64 * 1e3 + ts.tv_nsec as f64 / 1e6
}

fn quantiles(mut t: Vec<f64>, qs: &[(&str, f64)]) -> serde_json::Value {
    t.sort_by(f64::total_cmp);
    let mut out = serde_json::json!({"n": t.len()});
    for (name, q) in qs {
        out[name] = t.get(((t.len().max(1) - 1) as f64 * q).round() as usize).copied().into();
    }
    out
}

fn spread(t: Vec<f64>) -> serde_json::Value {
    quantiles(t, &[("p10", 0.1), ("median", 0.5), ("p90", 0.9)])
}

fn tail(t: Vec<f64>) -> serde_json::Value {
    quantiles(t, &[("p50", 0.5), ("p99", 0.99), ("p99_9", 0.999), ("max", 1.0)])
}

fn documents(instances: &[Vec<Record>], target: u32) -> Vec<Vec<u8>> {
    VALUES
        .iter()
        .map(|v| {
            let mut page: Vec<_> = instances.iter().map(|r| group::page_values(r.iter().map(|r| (r.tag(), r.value.clone())))).collect();
            page[target as usize - 1][4] = Some(v.to_vec());
            pair::document(&page)
        })
        .collect()
}

pub fn run(dir: &Path, series: &[Record], template: &[Record], counts: &[u16], updates: usize) -> Result<()> {
    pair::pin(WRITER_CORE)?;
    for &n in counts {
        let dir = dir.join(format!("update-cost-n{n}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        let instances = group::synthetic_series(template, n);
        let target = (n as u32 + 1) / 2;
        let valid = documents(&instances, target);

        disk_reference(&dir, n)?;

        let arms = [("patched", Model::Patched), ("patched′", Model::Patched), ("revision", Model::Revision), ("revision′", Model::Revision)];
        let mut stores = Vec::new();
        for (i, (_, m)) in arms.iter().enumerate() {
            let ext = if *m == Model::Patched { ".db" } else { "" };
            let mut s = Store::new(*m, dir.join(format!("arm{i}{ext}")), series, &instances)?;
            s.update(target, VALUES[1])?;
            stores.push(s);
        }
        let (mut wall, mut bytes, mut cpu) = (vec![vec![]; 4], vec![vec![]; 4], vec![vec![]; 4]);
        for round in 0..updates {
            for k in 0..arms.len() {
                let a = (round + k) % arms.len();
                let (w, c, t) = (pair::written(), thread_cpu_ms(), Instant::now());
                stores[a].update(target, VALUES[round % 2])?;
                let seen = stores[a].read_new()?;
                wall[a].push(t.elapsed().as_secs_f64() * 1e3);
                cpu[a].push(thread_cpu_ms() - c);
                bytes[a].push((pair::written() - w) as f64);
                ensure!(seen == valid[round % 2], "{}: a reader opened after the update does not see it", arms[a].0);
                stores[a].tidy()?;
            }
        }
        for (a, (name, _)) in arms.iter().enumerate() {
            println!("{}", serde_json::json!({"instances": n, "part": "update", "arm": name, "visible_ms": spread(wall[a].clone()),
                "cpu_ms": spread(cpu[a].clone()), "bytes_written": spread(bytes[a].clone())}));
        }
        for m in [Model::Patched, Model::Revision] {
            println!("{}", serde_json::json!({"instances": n, "part": "fsyncs", "arm": m.name(), "per_update": fsyncs(&dir, m, series, &instances, target)?}));
        }
        let size = |p: &Path| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        let study = stores[2].path().join(format!("store/{}/study.db", revision::live(stores[2].path())?));
        println!("{}", serde_json::json!({"instances": n, "part": "size", "revision_file": size(&study), "patched_file_and_wal": size(stores[0].path()) + size(&dir.join("arm0.db-wal"))}));
        drop(stores);
        readers(&dir, n, series, &instances, target, &valid)?;
    }
    Ok(())
}

/// A 16 MB write and its `fsync`, the disk's reference.
fn disk_reference(dir: &Path, n: u16) -> Result<()> {
    use std::io::Write;
    let block = vec![0x5Au8; 16 << 20];
    let mut t = Vec::new();
    for i in 0..10 {
        let path = dir.join(format!("disk-{i}"));
        let start = Instant::now();
        let mut f = std::fs::File::create(&path)?;
        f.write_all(&block)?;
        f.sync_all()?;
        t.push(start.elapsed().as_secs_f64() * 1e3);
        std::fs::remove_file(path)?;
    }
    println!("{}", serde_json::json!({"instances": n, "part": "disk", "arm": "16 MB write + fsync", "ms": spread(t)}));
    Ok(())
}

/// `fsync`s and `fdatasync`s per update, from `strace` over 20 updates in a child process on a store built here.
fn fsyncs(dir: &Path, model: Model, series: &[Record], instances: &[Vec<Record>], target: u32) -> Result<f64> {
    const UPDATES: usize = 20;
    let path = dir.join(format!("trace-{}", model.name()));
    let mut s = Store::new(model, path.clone(), series, instances)?;
    s.update(target, VALUES[1])?;
    drop(s);
    let log = dir.join(format!("trace-{}.log", model.name()));
    let status = std::process::Command::new("strace")
        .args(["-f", "-qq", "-e", "trace=fsync,fdatasync,syncfs,sync_file_range", "-o"])
        .arg(&log)
        .arg(std::env::current_exe()?)
        .args(["--update-child", model.name()])
        .arg(&path)
        .args([target.to_string(), UPDATES.to_string()])
        .status()?;
    ensure!(status.success(), "the traced child failed");
    let calls = std::fs::read_to_string(&log)?.lines().filter(|l| l.contains("sync")).count();
    Ok(calls as f64 / UPDATES as f64)
}

/// The traced child: `updates` updates of an existing store, each followed by a new reader's read.
pub fn update_child(model: &str, path: &Path, target: u32, updates: usize) -> Result<()> {
    let mut s = match model {
        "patched" => Store::Patched(path.to_path_buf(), pair::writable(path)?),
        _ => Store::Revision(path.to_path_buf()),
    };
    for round in 0..updates {
        s.update(target, VALUES[round % 2])?;
        drop(s.read_new()?);
        s.tidy()?;
    }
    Ok(())
}

const READER_ARMS: [(&str, Model, &str, bool); 6] = [
    ("patched, opened per read, alone", Model::Patched, "opened", false),
    ("patched, opened per read, beside updates", Model::Patched, "opened", true),
    ("revision, opened per read, alone", Model::Revision, "opened", false),
    ("revision, opened per read, beside updates", Model::Revision, "opened", true),
    ("patched, held, beside updates", Model::Patched, "held", true),
    ("revision, held, beside updates", Model::Revision, "held", true),
];

fn readers(dir: &Path, n: u16, series: &[Record], instances: &[Vec<Record>], target: u32, valid: &[Vec<u8>]) -> Result<()> {
    const REPS: usize = 6;
    const UPDATES: usize = 30;
    let mut stores = Vec::new();
    for m in [Model::Patched, Model::Revision] {
        let mut s = Store::new(m, dir.join(format!("read-{}", m.name())), series, instances)?;
        s.update(target, VALUES[1])?;
        stores.push(s);
    }
    let (va, vb) = (dir.join("valid-a"), dir.join("valid-b"));
    std::fs::write(&va, &valid[0])?;
    std::fs::write(&vb, &valid[1])?;
    let mut reads: Vec<Vec<f64>> = vec![vec![]; READER_ARMS.len()];
    let mut report = vec![serde_json::json!({"neither_before_nor_after": 0, "read_again": 0, "saw_a": 0, "saw_b": 0, "documents_seen_per_rep": []}); READER_ARMS.len()];
    for rep in 0..REPS {
        for k in 0..READER_ARMS.len() {
            let arm = (rep + k) % READER_ARMS.len();
            let (_, model, how, beside) = READER_ARMS[arm];
            let store = &mut stores[(model == Model::Revision) as usize];
            let (stop, iv) = (dir.join("stop"), dir.join("intervals"));
            let _ = std::fs::remove_file(&stop);
            let child = std::process::Command::new(std::env::current_exe()?)
                .args(["--reader-of", model.name(), how])
                .args([store.path(), &va, &vb, &stop, &iv])
                .arg(READER_CORE.to_string())
                .stdout(std::process::Stdio::piped())
                .spawn()?;
            std::thread::sleep(Duration::from_millis(50));
            if beside {
                for round in 0..UPDATES {
                    store.update(target, VALUES[round % 2])?;
                    store.tidy()?;
                }
            } else {
                std::thread::sleep(Duration::from_secs(1));
            }
            std::fs::write(&stop, b"")?;
            let out = child.wait_with_output()?;
            ensure!(out.status.success(), "the reader failed: {}", READER_ARMS[arm].0);
            let r: serde_json::Value = serde_json::from_slice(&out.stdout)?;
            for key in ["neither_before_nor_after", "read_again", "saw_a", "saw_b"] {
                report[arm][key] = (report[arm][key].as_u64().unwrap() + r[key].as_u64().unwrap()).into();
            }
            let seen = (r["saw_a"].as_u64().unwrap() > 0) as u64 + (r["saw_b"].as_u64().unwrap() > 0) as u64;
            report[arm]["documents_seen_per_rep"].as_array_mut().unwrap().push(seen.into());
            let bytes = std::fs::read(&iv)?;
            reads[arm].extend(bytes.chunks_exact(16).map(|c| {
                (u64::from_le_bytes(c[8..].try_into().unwrap()) - u64::from_le_bytes(c[..8].try_into().unwrap())) as f64 / 1e3
            }));
        }
    }
    for (arm, (name, ..)) in READER_ARMS.iter().enumerate() {
        println!("{}", serde_json::json!({"instances": n, "part": "reader", "arm": name, "read_us": tail(reads[arm].clone()), "seen": report[arm]}));
    }
    Ok(())
}

/// The reader process: reads the page row until `stop` exists, opening for each read or holding one handle; every
/// document must be `a` or `b`. Writes each read's start and end (ns, `CLOCK_MONOTONIC`) to `intervals`.
pub fn reader(model: &str, how: &str, store: &Path, valid: &[Vec<u8>; 2], stop: &Path, intervals: &Path) -> Result<serde_json::Value> {
    let held = match (model, how) {
        ("patched", "held") => Some(pair::open(store)?),
        ("revision", "held") => Some(revision::open_live(store)?),
        _ => None,
    };
    let (mut mixed, mut again, mut saw, mut out) = (0u64, 0u64, [0u64; 2], Vec::new());
    while !stop.exists() {
        let start = pair::now_ns();
        let doc = match (&held, model) {
            (Some(db), _) => pair::read_page(db)?,
            (None, "patched") => pair::read_page(&pair::open(store)?)?,
            (None, _) => {
                let (doc, n) = revision::read_live(store)?;
                again += n as u64;
                doc
            }
        };
        out.extend_from_slice(&start.to_le_bytes());
        out.extend_from_slice(&pair::now_ns().to_le_bytes());
        match valid.iter().position(|v| *v == doc) {
            Some(i) => saw[i] += 1,
            None => mixed += 1,
        }
    }
    std::fs::write(intervals, &out)?;
    Ok(serde_json::json!({"reads": out.len() / 16, "neither_before_nor_after": mixed, "read_again": again, "saw_a": saw[0], "saw_b": saw[1]}))
}
