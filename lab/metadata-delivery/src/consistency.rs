use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use serde_json::{json, Value};

use crate::doc::{self, Source};
use crate::host::monotonic_ns;
use crate::prepare::{derive, study_dir};

pub const WINDOW_BASE: f64 = 1000.0;
const SERIES: &str = "ct";

/// Even revisions correct the study fields, odd ones every instance's window; each stamps the revision it is.
pub fn receive(root: &Path, study: &str, seconds: u64, gap: Duration) -> Result<()> {
    let dir = study_dir(root, study);
    let mut conn = doc::open_write(&dir)?;
    let end = Instant::now() + Duration::from_secs(seconds);
    let mut revision = 0u64;
    while Instant::now() < end {
        let begin = monotonic_ns();
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if revision % 2 == 0 {
            tx.execute("UPDATE exam SET patient_name = ?1", [format!("LAB^REV{revision}")])?;
        } else {
            let (uid, _) = doc::series_uid(&tx, SERIES)?;
            tx.execute("UPDATE instance SET window_center = ?1 WHERE series_uid = ?2", (WINDOW_BASE + revision as f64, &uid))?;
            doc::ready_row(&tx, SERIES)?;
        }
        tx.commit()?;
        let commit = monotonic_ns();
        derive(&dir, &mut conn, SERIES)?;
        let derived = monotonic_ns();
        println!("{}", json!({"revision": revision, "begin": begin, "commit": commit, "derived": derived}));
        revision += 1;
        std::thread::sleep(gap);
    }
    Ok(())
}

/// (study revision, paint revision, torn): revisions as `receive` stamps them; torn if the frames disagree.
pub fn revisions(paint: Option<&Value>, study: Option<&Value>) -> (Option<i64>, Option<i64>, bool) {
    let study_rev = study.and_then(|s| s["patient_name"].as_str()?.strip_prefix("LAB^REV")?.parse().ok());
    let Some(paint) = paint else { return (study_rev, None, false) };
    let windows: Vec<f64> = paint["per_frame"].as_array().map_or(vec![], |f| f.iter().filter_map(|x| x[4].as_f64()).collect());
    let torn = windows.windows(2).any(|w| w[0] != w[1]);
    let paint_rev = windows.first().filter(|w| **w >= WINDOW_BASE).map(|w| (w - WINDOW_BASE) as i64);
    (study_rev, paint_rev, torn)
}

fn gunzip_json(path: &Path) -> Result<Value> {
    let gz = fs::read(path)?;
    Ok(serde_json::from_reader(flate2::read::GzDecoder::new(&gz[..]))?)
}

fn read_once(dir: &Path, arm: &str) -> Result<(Option<Value>, Option<Value>)> {
    let [b, c_paint, c_study] = doc::derived_files(dir, SERIES);
    Ok(match arm {
        "b" => {
            let d = gunzip_json(&b)?;
            (Some(d["paint"].clone()), Some(d["study"].clone()))
        }
        "c" => (Some(gunzip_json(&c_paint)?["paint"].clone()), Some(gunzip_json(&c_study)?["study"].clone())),
        _ => {
            let source = Source::parse(arm.trim_start_matches("a-")).context("arm")?;
            let mut conn = doc::open_read(dir)?;
            let parts = doc::read(&mut conn, SERIES, source)?;
            (Some(serde_json::from_str(&parts.paint)?), Some(serde_json::from_str(&parts.study)?))
        }
    })
}

/// One thread per arm, each reading as its arm reads, for as long as asked; a line per read.
pub fn read(root: &Path, study: &str, seconds: u64) -> Result<()> {
    let dir = study_dir(root, study);
    let end = Instant::now() + Duration::from_secs(seconds);
    std::thread::scope(|s| {
        for arm in ["a-instances", "a-ready", "b", "c"] {
            let dir = &dir;
            s.spawn(move || {
                let mut out = Vec::new();
                while Instant::now() < end {
                    let start = monotonic_ns();
                    let got = read_once(dir, arm);
                    let finish = monotonic_ns();
                    out.push(match got {
                        Ok((paint, study)) => {
                            let (study_rev, paint_rev, torn) = revisions(paint.as_ref(), study.as_ref());
                            json!({"arm": arm, "start": start, "end": finish, "study_rev": study_rev, "paint_rev": paint_rev, "torn": torn})
                        }
                        Err(err) => json!({"arm": arm, "start": start, "end": finish, "error": format!("{err:#}")}),
                    });
                }
                for line in out {
                    println!("{line}");
                }
            });
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prepare::tests::fixture;

    /// B's file is replaced by rename: a reader looping on it while the derive rewrites it always gets a whole gzip
    /// stream that parses.
    #[test]
    fn a_derived_file_is_never_read_half_written() {
        let study = fixture();
        let [b, ..] = doc::derived_files(&study, SERIES);
        let bytes = fs::read(&b).unwrap();
        let writer = {
            let b = b.clone();
            std::thread::spawn(move || {
                for _ in 0..300 {
                    doc::place(&b, &bytes).unwrap();
                }
            })
        };
        while !writer.is_finished() {
            gunzip_json(&b).expect("a whole file");
        }
        writer.join().unwrap();
    }
}
