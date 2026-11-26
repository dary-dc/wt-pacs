use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use flate2::write::GzEncoder;
use flate2::{Compression, GzBuilder};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

pub const GZIP_LEVEL: u32 = 6;

/// Where the paint metadata is read from at open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Instances,
    Ready,
}

impl Source {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "instances" => Some(Self::Instances),
            "ready" => Some(Self::Ready),
            _ => None,
        }
    }
}

#[derive(Serialize)]
struct Paint {
    series: String,
    digest: String,
    codec: String,
    frames: usize,
    rows: i64,
    columns: i64,
    samples: i64,
    bits_allocated: i64,
    bits_stored: i64,
    high_bit: i64,
    signed: bool,
    photometric: String,
    spacing: Vec<f64>,
    orientation: Vec<f64>,
    /// number, position x y z, window centre and width, rescale slope and intercept
    per_frame: Vec<[f64; 8]>,
}

#[derive(Serialize)]
struct StudyFields {
    patient_name: String,
    patient_id: String,
    birth_date: String,
    sex: String,
    study_date: String,
    description: String,
    institution: String,
    accession: String,
}

pub fn study_db(study_dir: &Path) -> PathBuf {
    study_dir.join("study.db")
}

pub fn open_read(study_dir: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(
        study_db(study_dir),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

pub fn open_write(study_dir: &Path) -> Result<Connection> {
    let conn = Connection::open(study_db(study_dir))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

fn floats(text: &str) -> Vec<f64> {
    text.split('\\').filter_map(|v| v.parse().ok()).collect()
}

pub fn series_uid(tx: &Connection, name: &str) -> Result<(String, String)> {
    tx.query_row("SELECT uid, bundle_digest FROM series WHERE name = ?1", [name], |r| Ok((r.get(0)?, r.get(1)?)))
        .with_context(|| format!("series {name}"))
}

pub fn paint_from_instances(tx: &Connection, name: &str) -> Result<String> {
    let (uid, digest) = series_uid(tx, name)?;
    let mut stmt = tx.prepare_cached(
        "SELECT number, pos_x, pos_y, pos_z, window_center, window_width, rescale_slope, rescale_intercept, rows,
                columns, samples, bits_allocated, bits_stored, high_bit, signed, photometric, spacing, orientation
         FROM instance WHERE series_uid = ?1 ORDER BY number",
    )?;
    let mut rows = stmt.query([&uid])?;
    let mut paint: Option<Paint> = None;
    while let Some(r) = rows.next()? {
        let frame = [r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?];
        match &mut paint {
            Some(p) => p.per_frame.push(frame),
            None => {
                paint = Some(Paint {
                    series: uid.clone(),
                    digest: digest.clone(),
                    codec: "htj2k".into(),
                    frames: 0,
                    rows: r.get(8)?,
                    columns: r.get(9)?,
                    samples: r.get(10)?,
                    bits_allocated: r.get(11)?,
                    bits_stored: r.get(12)?,
                    high_bit: r.get(13)?,
                    signed: r.get::<_, i64>(14)? != 0,
                    photometric: r.get(15)?,
                    spacing: floats(&r.get::<_, String>(16)?),
                    orientation: floats(&r.get::<_, String>(17)?),
                    per_frame: vec![frame],
                })
            }
        }
    }
    let mut paint = paint.with_context(|| format!("series {name} has no instance"))?;
    paint.frames = paint.per_frame.len();
    Ok(serde_json::to_string(&paint)?)
}

pub fn paint_from_ready(tx: &Connection, name: &str) -> Result<String> {
    let (uid, _) = series_uid(tx, name)?;
    tx.query_row("SELECT doc FROM series_paint WHERE series_uid = ?1", [&uid], |r| r.get(0))
        .optional()?
        .with_context(|| format!("series {name} has no ready row"))
}

pub fn study_fields(tx: &Connection) -> Result<String> {
    let fields = tx.query_row(
        "SELECT patient_name, patient_id, birth_date, sex, study_date, description, institution, accession FROM exam",
        [],
        |r| {
            Ok(StudyFields {
                patient_name: r.get(0)?,
                patient_id: r.get(1)?,
                birth_date: r.get(2)?,
                sex: r.get(3)?,
                study_date: r.get(4)?,
                description: r.get(5)?,
                institution: r.get(6)?,
                accession: r.get(7)?,
            })
        },
    )?;
    Ok(serde_json::to_string(&fields)?)
}

pub struct Parts {
    pub paint: String,
    pub study: String,
}

/// Both parts from one read transaction, so they come from one committed state.
pub fn read(conn: &mut Connection, name: &str, source: Source) -> Result<Parts> {
    read_around(conn, name, source, || {})
}

fn read_around(conn: &mut Connection, name: &str, source: Source, between: impl FnOnce()) -> Result<Parts> {
    let tx = conn.transaction()?;
    let study = study_fields(&tx)?;
    between();
    let paint = match source {
        Source::Instances => paint_from_instances(&tx, name)?,
        Source::Ready => paint_from_ready(&tx, name)?,
    };
    tx.finish()?;
    Ok(Parts { paint, study })
}

pub fn document(parts: &Parts) -> String {
    format!("{{\"paint\":{},\"study\":{}}}", parts.paint, parts.study)
}

pub fn paint_only(paint: &str) -> String {
    format!("{{\"paint\":{paint}}}")
}

pub fn study_only(study: &str) -> String {
    format!("{{\"study\":{study}}}")
}

/// Deterministic: no name, mtime 0, one level everywhere, so every arm sends the same bytes.
pub fn gzip(text: &str) -> Vec<u8> {
    let mut enc: GzEncoder<Vec<u8>> = GzBuilder::new().mtime(0).write(Vec::new(), Compression::new(GZIP_LEVEL));
    enc.write_all(text.as_bytes()).expect("writing to a Vec");
    enc.finish().expect("writing to a Vec")
}

pub fn etag(gz: &[u8]) -> String {
    format!("\"{:016x}\"", xxhash_rust::xxh3::xxh3_64(gz))
}

/// The file B serves, and C's two.
pub fn derived_files(study_dir: &Path, name: &str) -> [PathBuf; 3] {
    [
        study_dir.join(format!("{name}.json.gz")),
        study_dir.join(format!("{name}.paint.json.gz")),
        study_dir.join("study.json.gz"),
    ]
}

/// `.partial`, `fsync`, `rename`, then the directory's `fsync`: a reader sees the old file or the new, never part.
pub fn place(path: &Path, bytes: &[u8]) -> Result<()> {
    let partial = path.with_extension("partial");
    let mut fh = fs::File::create(&partial)?;
    fh.write_all(bytes)?;
    fh.sync_all()?;
    fs::rename(&partial, path)?;
    fs::File::open(path.parent().context("a file has a directory")?)?.sync_all()?;
    Ok(())
}

pub fn ready_row(tx: &Connection, name: &str) -> Result<()> {
    let paint = paint_from_instances(tx, name)?;
    let (uid, _) = series_uid(tx, name)?;
    tx.execute("INSERT OR REPLACE INTO series_paint (series_uid, doc) VALUES (?1, ?2)", (&uid, &paint))?;
    Ok(())
}

/// The compressed ready row: the whole document gzipped, its revision moved on every write.
pub fn compressed_row(tx: &Connection, name: &str) -> Result<()> {
    let gz = gzip(&document(&Parts { paint: paint_from_instances(tx, name)?, study: study_fields(tx)? }));
    let (uid, _) = series_uid(tx, name)?;
    tx.execute(
        "INSERT INTO series_gz (series_uid, revision, gz) VALUES (?1, 1, ?2)
         ON CONFLICT (series_uid) DO UPDATE SET revision = revision + 1, gz = excluded.gz",
        (&uid, &gz),
    )?;
    Ok(())
}

const SERIES_GZ: &str = "FROM series_gz g JOIN series s ON s.uid = g.series_uid WHERE s.name = ?1";

pub fn revision(conn: &Connection, name: &str) -> Result<i64> {
    conn.prepare_cached(&format!("SELECT g.revision {SERIES_GZ}"))?
        .query_row([name], |r| r.get(0))
        .with_context(|| format!("series {name} has no compressed row"))
}

pub fn compressed(conn: &Connection, name: &str) -> Result<(i64, Vec<u8>)> {
    conn.prepare_cached(&format!("SELECT g.revision, g.gz {SERIES_GZ}"))?
        .query_row([name], |r| Ok((r.get(0)?, r.get(1)?)))
        .with_context(|| format!("series {name} has no compressed row"))
}

pub fn revision_tag(revision: i64) -> String {
    format!("\"r{revision}\"")
}

pub fn series_names(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM series ORDER BY name")?;
    let names = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prepare::tests::fixture;

    fn gunzip(gz: &[u8]) -> String {
        let mut out = String::new();
        std::io::Read::read_to_string(&mut flate2::read::GzDecoder::new(gz), &mut out).unwrap();
        out
    }

    /// A read is one snapshot: a window correction committed by another connection between its exam read and its
    /// paint read is in neither part, from either source; the next read has it.
    #[test]
    fn a_read_is_one_snapshot() {
        let study = fixture();
        let mut reader = open_read(&study).unwrap();
        for source in [Source::Instances, Source::Ready] {
            let before = read(&mut reader, "ct", source).unwrap();
            let during = read_around(&mut reader, "ct", source, || {
                let mut writer = open_write(&study).unwrap();
                let tx = writer.transaction().unwrap();
                tx.execute("UPDATE instance SET window_center = window_center + 1", []).unwrap();
                ready_row(&tx, "ct").unwrap();
                tx.commit().unwrap();
            })
            .unwrap();
            assert_eq!(during.paint, before.paint, "{source:?}");
            assert_ne!(read(&mut reader, "ct", source).unwrap().paint, before.paint, "{source:?}");
        }
    }

    /// Every arm delivers the same document: A's two sources at open, B's file and C's two files merged.
    #[test]
    fn every_arm_delivers_the_same_document() {
        let study = fixture();
        let mut conn = open_read(&study).unwrap();
        for name in ["ct", "ct2000"] {
            let instances = document(&read(&mut conn, name, Source::Instances).unwrap());
            let ready = document(&read(&mut conn, name, Source::Ready).unwrap());
            let [b, c_paint, c_study] = derived_files(&study, name).map(|p| gunzip(&fs::read(p).unwrap()));
            assert_eq!(instances, ready);
            assert_eq!(instances, b);
            let c: serde_json::Value = serde_json::from_str(&c_paint).unwrap();
            let s: serde_json::Value = serde_json::from_str(&c_study).unwrap();
            let a: serde_json::Value = serde_json::from_str(&instances).unwrap();
            assert_eq!(a["paint"], c["paint"]);
            assert_eq!(a["study"], s["study"]);
            assert_eq!(a["paint"]["frames"], if name == "ct" { 262 } else { 2000 });
            let numbers: Vec<f64> = a["paint"]["per_frame"].as_array().unwrap().iter().map(|f| f[0].as_f64().unwrap()).collect();
            assert!(numbers.windows(2).all(|w| w[0] < w[1]), "frames in display order");
        }
    }

    /// The compressed ready row holds B's file byte for byte, at revision 1 after prepare.
    #[test]
    fn the_compressed_row_is_the_derived_file() {
        let study = fixture();
        let conn = open_read(&study).unwrap();
        for name in ["ct", "ct2000"] {
            let (revision, gz) = compressed(&conn, name).unwrap();
            assert_eq!(revision, 1);
            assert_eq!(gz, fs::read(&derived_files(&study, name)[0]).unwrap(), "{name}");
        }
    }
}
