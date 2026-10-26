use std::cell::RefCell;
use std::fs;
use std::path::Path;
use std::time::Instant;

use anyhow::Result;
use serde_json::json;

use crate::doc::{self, Source};
use crate::prepare::{study_dir, study_name};
use crate::serve::open_and_read;

pub fn thread_cpu_ns() -> u64 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `ts` is a valid, writable timespec for the call's duration.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts) };
    ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64
}

pub fn monotonic_ns() -> u64 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: as above; CLOCK_MONOTONIC is one clock for every process on the host.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64
}

fn percentile(sorted: &[u64], p: f64) -> u64 {
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

/// One open's metadata work in this thread, every variant interleaved, the order rotated each round.
pub fn cost(root: &Path, rounds: usize) -> Result<()> {
    let dir = study_dir(root, &study_name(0));
    let kept = RefCell::new(doc::open_read(&dir)?);
    let text: Vec<String> = ["ct", "ct2000"]
        .iter()
        .map(|n| doc::read(&mut kept.borrow_mut(), n, Source::Instances).map(|p| doc::document(&p)))
        .collect::<Result<_>>()?;
    let kept = &kept;
    type Op<'a> = Box<dyn FnMut() -> Result<usize> + 'a>;
    let mut variants: Vec<(String, Op)> = Vec::new();
    for (i, name) in ["ct", "ct2000"].into_iter().enumerate() {
        for (label, source) in [("instances", Source::Instances), ("ready", Source::Ready)] {
            variants.push((format!("a-{label}/{name}"), Box::new(move || Ok(open_and_read(root, "s000", name, source)?.len()))));
        }
        for (label, source) in [("instances", Source::Instances), ("ready", Source::Ready)] {
            variants.push((
                format!("a-{label}-kept/{name}"),
                Box::new(move || Ok(doc::gzip(&doc::document(&doc::read(&mut kept.borrow_mut(), name, source)?)).len())),
            ));
        }
        let t = &text[i];
        variants.push((format!("gzip-only/{name}"), Box::new(move || Ok(doc::gzip(t).len()))));
        let [b, c_paint, c_study] = doc::derived_files(&dir, name);
        variants.push((format!("b/{name}"), Box::new(move || Ok(fs::read(&b)?.len()))));
        variants.push((format!("c/{name}"), Box::new(move || Ok(fs::read(&c_paint)?.len() + fs::read(&c_study)?.len()))));
    }
    variants.push(("open-only".into(), Box::new(|| Ok(doc::open_read(&dir)?.is_autocommit() as usize))));
    let mut cpu = vec![Vec::with_capacity(rounds); variants.len()];
    let mut wall = vec![Vec::with_capacity(rounds); variants.len()];
    let n = variants.len();
    for round in 0..rounds + 3 {
        for k in 0..n {
            let v = (k + round * 5) % n;
            let (c0, w0) = (thread_cpu_ns(), Instant::now());
            (variants[v].1)()?;
            let (c, w) = (thread_cpu_ns() - c0, w0.elapsed().as_nanos() as u64);
            if round >= 3 {
                cpu[v].push(c);
                wall[v].push(w);
            }
        }
    }
    for (v, (label, _)) in variants.iter().enumerate() {
        cpu[v].sort_unstable();
        wall[v].sort_unstable();
        println!(
            "{}",
            json!({"variant": label, "rounds": rounds,
                   "cpu_us_p50": percentile(&cpu[v], 0.5) as f64 / 1e3, "cpu_us_p90": percentile(&cpu[v], 0.9) as f64 / 1e3,
                   "wall_us_p50": percentile(&wall[v], 0.5) as f64 / 1e3, "wall_us_p90": percentile(&wall[v], 0.9) as f64 / 1e3})
        );
    }
    Ok(())
}

fn fds() -> Result<usize> {
    Ok(fs::read_dir("/proc/self/fd")?.count())
}

fn kib(file: &str, key: &str) -> Result<u64> {
    let text = fs::read_to_string(file)?;
    let line = text.lines().find(|l| l.starts_with(key)).unwrap_or("");
    Ok(line.split_whitespace().nth(1).and_then(|v| v.parse().ok()).unwrap_or(0))
}

/// Study DB connections held open after one read each: one per viewer, or one per study shared by its viewers.
pub fn hold(root: &Path, viewers: usize, studies: usize, per_viewer: bool, source: Source, name: &str) -> Result<()> {
    let (fd0, rss0, pss0) = (fds()?, kib("/proc/self/status", "VmRSS:")?, kib("/proc/self/smaps_rollup", "Pss:")?);
    let mut held = Vec::new();
    for v in 0..viewers {
        let study = v % studies;
        if per_viewer || held.len() <= study {
            held.push(doc::open_read(&study_dir(root, &study_name(study)))?);
        }
        let conn = if per_viewer { held.last_mut() } else { held.get_mut(study) }.expect("opened above");
        doc::read(conn, name, source)?;
    }
    let (fd1, rss1, pss1) = (fds()?, kib("/proc/self/status", "VmRSS:")?, kib("/proc/self/smaps_rollup", "Pss:")?);
    println!(
        "{}",
        json!({"policy": if per_viewer { "per-viewer" } else { "per-study" }, "source": format!("{source:?}").to_lowercase(),
               "series": name, "viewers": viewers, "studies": studies, "connections": held.len(),
               "fds": fd1 - fd0, "rss_kib": rss1 as i64 - rss0 as i64, "pss_kib": pss1 as i64 - pss0 as i64})
    );
    Ok(())
}
