//! `--mode study-db`: the three layouts on the parser's packages, interleaved, as pre-registered in
//! lab/metadata-store/README.md §The study DB.

use super::{shared, Change, Layout, Scope, PATIENT_NAME, SLICE_THICKNESS};
use crate::group::{self, Record, Tag, IMAGE_POSITION};
use crate::pair;
use anyhow::{ensure, Context, Result};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

pub const SERIES: [&str; 5] = ["ct", "pt", "mr", "mg", "us"];
const INPUTS: [(&str, &str); 2] = [("as written", ""), ("masked", ".masked")];
const NEW_NAME: &[u8] = b"LAB^CORRECTED ";
const NEW_THICKNESS: &[u8] = b"9.75";
const NEW_POSITION: &[u8] = b"0\\0\\0 ";
/// The attributes the conversion re-encodes or keeps from the first instance only.
const RE_ENCODED: [Tag; 5] = [
    [0x00, 0x08, 0x00, 0x16],
    [0x00, 0x08, 0x00, 0x18],
    [0x00, 0x08, 0x00, 0x22],
    [0x00, 0x08, 0x00, 0x32],
    [0x00, 0x20, 0x00, 0x12],
];

struct Arm {
    layout: Layout,
    name: String,
    path: PathBuf,
}

fn thread_cpu_ms() -> f64 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `ts` is a valid, writable timespec for the duration of the call.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts) };
    ts.tv_sec as f64 * 1e3 + ts.tv_nsec as f64 / 1e6
}

fn stats(mut t: Vec<f64>) -> serde_json::Value {
    t.sort_by(f64::total_cmp);
    let q = |p: f64| t[((t.len() - 1) as f64 * p).round() as usize];
    serde_json::json!({"rounds": t.len(), "p10": q(0.1), "median": q(0.5), "p90": q(0.9)})
}

/// Times `op` on every arm, `rounds` times, the order rotated each round; ms of wall and of the thread's CPU.
fn interleaved(arms: &[Arm], rounds: usize, mut op: impl FnMut(&Arm) -> Result<()>) -> Result<Vec<(Vec<f64>, Vec<f64>)>> {
    let mut out = vec![(Vec::with_capacity(rounds), Vec::with_capacity(rounds)); arms.len()];
    for round in 0..rounds {
        for k in 0..arms.len() {
            let a = (round + k) % arms.len();
            let (t, cpu) = (Instant::now(), thread_cpu_ms());
            op(&arms[a])?;
            out[a].1.push(thread_cpu_ms() - cpu);
            out[a].0.push(t.elapsed().as_secs_f64() * 1e3);
        }
    }
    Ok(out)
}

fn emit(base: &serde_json::Value, arms: &[Arm], times: Vec<(Vec<f64>, Vec<f64>)>) {
    for (arm, (wall, cpu)) in arms.iter().zip(times) {
        let mut row = base.clone();
        row["arm"] = arm.name.clone().into();
        row["ms"] = stats(wall);
        row["cpu_ms"] = stats(cpu);
        println!("{row}");
    }
}

fn payload(layout: Layout, db: &Connection) -> Result<i64> {
    let mut total = 0;
    for table in ["exam", "series"].iter().chain(layout.tables()) {
        total += db.query_row(&format!("SELECT coalesce(sum(length(bytes)), 0) FROM {table}"), [], |r| r.get::<_, i64>(0))?;
    }
    Ok(total)
}

fn top_value(records: &[Record], tag: Tag) -> Result<Vec<u8>> {
    Ok(records.iter().find(|r| r.key.len() == 8 && r.tag() == tag).context("no such attribute")?.value.clone())
}

/// Every received record of every instance is in its frame's view (shared row and own row) with its value, by
/// the key's innermost 8 bytes, but group 0002 and `RE_ENCODED`; returns the records looked for.
fn received_in_frames(received: &[Vec<Record>], full: &super::Full) -> Result<usize> {
    let leaf = |r: &Record| (r.key[r.key.len() - 8..].to_vec(), r.value.clone());
    let mut looked = 0;
    for (n, (want, own)) in received.iter().zip(&full.instances).enumerate() {
        let mut have: HashMap<(Vec<u8>, Vec<u8>), usize> = HashMap::new();
        for r in full.shared.iter().chain(own) {
            *have.entry(leaf(r)).or_default() += 1;
        }
        for r in want.iter().filter(|r| r.key[..2] != [0, 2] && !RE_ENCODED.contains(&r.key[..4].try_into().unwrap())) {
            let left = have.get_mut(&leaf(r)).filter(|c| **c > 0);
            ensure!(left.is_some(), "frame {}: a received record is not in its view", n + 1);
            *left.unwrap() -= 1;
            looked += 1;
        }
    }
    Ok(looked)
}

fn lines(source: &str) -> usize {
    source.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("//")).count()
}

pub fn run(packages: &Path, dir: &Path, rounds: usize, builds: usize, corrections: usize) -> Result<()> {
    let owned = serde_json::json!({
        "common": lines(include_str!("mod.rs")),
        "row per group": lines(include_str!("rows.rs")),
        "shared + per-frame": lines(include_str!("shared.rs")),
        "blob per series": lines(include_str!("blob.rs")),
    });
    println!("{}", serde_json::json!({"owned_lines": owned}));
    std::fs::create_dir_all(dir)?;
    for (input, suffix) in INPUTS {
        for name in SERIES {
            let package = packages.join(format!("{name}{suffix}.tar"));
            let p = super::unpack(&std::fs::read(&package)?)?;
            let mut layouts = vec![Layout::Rows, Layout::Blob];
            if shared::applies(&p.modality) {
                let reference = std::fs::read(packages.join(format!("{name}{suffix}.ce")))?;
                ensure!(group::write(&shared::converted(&p)?) == reference, "{name}{suffix}: converted differs from #154's");
                layouts.insert(1, Layout::Shared);
            }
            let arms: Vec<Arm> = layouts
                .iter()
                .flat_map(|&layout| {
                    ["", "′"].map(|prime| Arm {
                        layout,
                        name: format!("{}{prime}", layout.name()),
                        path: dir.join(format!("{name}{suffix}-{:?}{}.db", layout, prime.len())),
                    })
                })
                .collect();
            let base = serde_json::json!({"input": input, "series": name, "instances": p.instances.len()});
            let series = p.series_uid.clone();

            let times = interleaved(&arms, builds, |a| {
                super::build(a.layout, &a.path, &std::fs::read(&package)?)?;
                Ok(())
            })?;
            emit(&with(&base, serde_json::json!({"op": "build"})), &arms, times);

            let received: Vec<Vec<Record>> = p
                .instances
                .iter()
                .map(|i| Ok([group::parse(&i.group)?, group::parse(&i.private)?].concat()))
                .collect::<Result<_>>()?;
            let paint_truth = super::paint(Layout::Rows, &pair::open(&arms[0].path)?, &series)?;
            for a in &arms {
                let db = pair::open(&a.path)?;
                ensure!(super::paint(a.layout, &db, &series)? == paint_truth, "{name}: {} paints differently", a.name);
                let full = super::full(a.layout, &db, &series)?;
                let looked = match a.layout {
                    Layout::Shared => received_in_frames(&received, &full)?,
                    _ => {
                        ensure!(full.instances == received, "{name}: {} gives other records back", a.name);
                        received.iter().map(Vec::len).sum()
                    }
                };
                let rows = super::check(a.layout, &db)?;
                let file = std::fs::metadata(&a.path)?.len();
                let size = serde_json::json!({"op": "size", "arm": a.name, "file": file,
                    "payload": payload(a.layout, &db)?, "rows": rows, "records_checked": looked});
                println!("{}", with(&base, size));
            }

            for (op, f) in [("paint", 0), ("full", 1), ("integrity", 2)] {
                let times = interleaved(&arms, rounds, |a| {
                    let db = pair::open(&a.path)?;
                    match f {
                        0 => drop(std::hint::black_box(super::paint(a.layout, &db, &series)?)),
                        1 => drop(std::hint::black_box(super::full(a.layout, &db, &series)?)),
                        _ => drop(std::hint::black_box(super::check(a.layout, &db)?)),
                    }
                    Ok(())
                })?;
                emit(&with(&base, serde_json::json!({"op": op})), &arms, times);
            }

            if layouts.contains(&Layout::Shared) {
                corrections_of(&p, &arms, &base, corrections)?;
            }
        }
    }
    Ok(())
}

fn with(base: &serde_json::Value, extra: serde_json::Value) -> serde_json::Value {
    let mut row = base.clone();
    for (k, v) in extra.as_object().into_iter().flatten() {
        row[k] = v.clone();
    }
    row
}

struct Correction<'a> {
    op: &'static str,
    scope: Scope<'a>,
    tag: Tag,
    value: &'static [u8],
    undo: Scope<'a>,
    prior: Vec<u8>,
}

/// Each correction timed and then undone untimed; every store must be back to its built state after each.
fn corrections_of(p: &super::Package, arms: &[Arm], base: &serde_json::Value, rounds: usize) -> Result<()> {
    let series = p.series_uid.as_str();
    let middle = &p.instances[p.instances.len() / 2];
    let records = group::parse(&middle.group)?;
    let (thickness, position) = (top_value(&records, SLICE_THICKNESS)?, top_value(&records, IMAGE_POSITION)?);
    let name = top_value(&group::parse(&p.exam)?, PATIENT_NAME)?;
    ensure!(thickness != NEW_THICKNESS && position != NEW_POSITION && name != NEW_NAME, "a new value is the old one");
    let kinds = [
        Correction { op: "exam", scope: Scope::Exam, tag: PATIENT_NAME, value: NEW_NAME, undo: Scope::Exam, prior: name },
        Correction {
            op: "instance, varying",
            scope: Scope::Instance(&middle.uid),
            tag: IMAGE_POSITION,
            value: NEW_POSITION,
            undo: Scope::Instance(&middle.uid),
            prior: position,
        },
        Correction {
            op: "instance, shared",
            scope: Scope::Instance(&middle.uid),
            tag: SLICE_THICKNESS,
            value: NEW_THICKNESS,
            undo: Scope::Series,
            prior: thickness.clone(),
        },
        Correction {
            op: "series, shared",
            scope: Scope::Series,
            tag: SLICE_THICKNESS,
            value: NEW_THICKNESS,
            undo: Scope::Series,
            prior: thickness,
        },
    ];
    let mut dbs: Vec<Connection> = arms.iter().map(|a| pair::writable(&a.path)).collect::<Result<_>>()?;
    let built: Vec<Vec<u8>> = arms.iter().zip(&dbs).map(|(a, db)| super::state(a.layout, db)).collect::<Result<_>>()?;
    for Correction { op, scope, tag, value, undo, prior } in &kinds {
        for (a, db) in arms.iter().zip(dbs.iter_mut()).filter(|(a, _)| !a.name.ends_with('′')) {
            let change: Change = super::correct(a.layout, db, series, *scope, *tag, value)?;
            let after = payload(a.layout, db)?;
            super::correct(a.layout, db, series, *undo, *tag, prior)?;
            let outcome = serde_json::json!({"op": op, "arm": a.name, "rows_written": change.rows,
                "ends_shared": change.shared, "payload_after": after});
            println!("{}", with(base, outcome));
        }
        let mut wall = vec![(Vec::with_capacity(rounds), Vec::with_capacity(rounds)); arms.len()];
        for round in 0..rounds {
            for k in 0..arms.len() {
                let i = (round + k) % arms.len();
                let (t, cpu) = (Instant::now(), thread_cpu_ms());
                super::correct(arms[i].layout, &mut dbs[i], series, *scope, *tag, value)?;
                wall[i].1.push(thread_cpu_ms() - cpu);
                wall[i].0.push(t.elapsed().as_secs_f64() * 1e3);
                super::correct(arms[i].layout, &mut dbs[i], series, *undo, *tag, prior)?;
                ensure!(super::state(arms[i].layout, &dbs[i])? == built[i], "{}: {op} not undone", arms[i].name);
            }
        }
        emit(&with(base, serde_json::json!({"op": op})), arms, wall);
    }
    Ok(())
}
