use crate::study::{self, SCHEMA};
use crate::Args;
use anyhow::{Context, Result};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const COMMITS: usize = 20;
const ROWS: usize = 200;
const WAIT: Duration = Duration::from_secs(5);

enum Db {
    Rusqlite(rusqlite::Connection),
    Turso(turso::Database, turso::Connection),
}

#[derive(Clone, Copy)]
struct Open {
    turso: bool,
    read_only: bool,
    multiprocess: bool,
}

async fn turso_db(path: &Path, o: Open) -> Result<turso::Database> {
    Ok(turso::Builder::new_local(path.to_str().unwrap())
        .read_only(o.read_only)
        .experimental_multiprocess_wal(o.multiprocess)
        .build()
        .await?)
}

impl Db {
    async fn open(path: &Path, o: Open) -> Result<Db> {
        if o.turso {
            let db = turso_db(path, o).await?;
            let c = db.connect()?;
            return Ok(Db::Turso(db, c));
        }
        let flags = if o.read_only {
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
        } else {
            rusqlite::OpenFlags::default()
        };
        Ok(Db::Rusqlite(rusqlite::Connection::open_with_flags(path, flags)?))
    }

    async fn batch(&self, sql: &str) -> Result<()> {
        match self {
            Db::Rusqlite(c) => c.execute_batch(sql)?,
            Db::Turso(_, c) => c.execute_batch(sql).await?,
        }
        Ok(())
    }

    async fn create(path: &Path, o: Open) -> Result<Db> {
        for suffix in ["", "-wal", "-shm", "-tshm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
        let db = Db::open(path, o).await?;
        match &db {
            Db::Rusqlite(c) => c.pragma_update(None, "journal_mode", "WAL")?,
            Db::Turso(_, c) => drop(c.query("PRAGMA journal_mode = WAL", ()).await?.next().await?),
        }
        db.batch(SCHEMA).await?;
        Ok(db)
    }

    async fn commit(&self, k: usize) -> Result<()> {
        let mut sql = String::from("BEGIN;");
        for n in 0..ROWS {
            let uid = study::instance_uid(k, n);
            sql += &format!("INSERT INTO groups VALUES ('{uid}', 2, 's', zeroblob({}), {n});", study::BODY);
        }
        sql += "COMMIT;";
        self.batch(&sql).await
    }

    async fn count(&self) -> Result<i64> {
        let sql = "SELECT count(*) FROM groups";
        Ok(match self {
            Db::Rusqlite(c) => c.query_row(sql, [], |r| r.get(0))?,
            Db::Turso(_, c) => {
                let mut rows = c.query(sql, ()).await?;
                *rows.next().await?.context("no row")?.get_value(0)?.as_integer().context("count")?
            }
        })
    }

    fn with_connection(&self) -> Result<Db> {
        match self {
            Db::Turso(db, _) => Ok(Db::Turso(db.clone(), db.connect()?)),
            Db::Rusqlite(_) => anyhow::bail!("rusqlite has no shared database handle"),
        }
    }
}

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

/// A writer and a reader in this process: the reader counts rows after each commit.
async fn same_process(path: &Path, w: Open, second_handle: bool) -> serde_json::Value {
    let writer = match Db::create(path, w).await {
        Ok(d) => d,
        Err(e) => return json!({"writer_error": err(e)}),
    };
    let reader = if second_handle { Db::open(path, w).await } else { writer.with_connection() };
    let reader = match reader {
        Ok(r) => r,
        Err(e) => return json!({"reader_open_error": err(e)}),
    };
    let mut counts = Vec::new();
    for k in 1..=COMMITS {
        if let Err(e) = writer.commit(k).await {
            return json!({"writer_error": err(e), "counts": counts});
        }
        counts.push(reader.count().await.map_err(err));
    }
    json!({"counts": counts.iter().map(|c| c.as_ref().map(|n| json!(n)).unwrap_or_else(|e| json!(e))).collect::<Vec<_>>()})
}

fn marker(path: &Path, tag: &str) -> PathBuf {
    PathBuf::from(format!("{}.{tag}", path.display()))
}

fn wait_for(m: &Path) -> bool {
    let t = Instant::now();
    while !m.exists() {
        if t.elapsed() > WAIT {
            return false;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    true
}

pub fn child(args: &Args) -> Result<()> {
    let path = PathBuf::from(args.str("path", ""));
    let o = Open { turso: args.str("engine", "") == "turso", read_only: args.has("ro"), multiprocess: args.has("mp") };
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let out = rt.block_on(async {
        if args.str("role", "") == "writer" {
            let db = match Db::create(&path, o).await {
                Ok(d) => d,
                Err(e) => return json!({"writer_error": err(e)}),
            };
            std::fs::write(marker(&path, "w0"), "").unwrap();
            let mut errors = Vec::new();
            for k in 1..=COMMITS {
                if !wait_for(&marker(&path, &format!("r{}", k - 1))) {
                    errors.push(format!("no reader after commit {}", k - 1));
                    break;
                }
                if let Err(e) = db.commit(k).await {
                    errors.push(err(e));
                }
                std::fs::write(marker(&path, &format!("w{k}")), "").unwrap();
            }
            json!({"writer_errors": errors})
        } else {
            if !wait_for(&marker(&path, "w0")) {
                return json!({"reader_error": "no writer"});
            }
            let db = Db::open(&path, o).await;
            std::fs::write(marker(&path, "r0"), "").unwrap();
            let db = match db {
                Ok(d) => d,
                Err(e) => return json!({"reader_open_error": err(e)}),
            };
            let (mut counts, mut read_ms) = (Vec::new(), 0);
            for k in 1..=COMMITS {
                if !wait_for(&marker(&path, &format!("w{k}"))) {
                    counts.push(json!("no writer"));
                    break;
                }
                let t = Instant::now();
                let n = db.count().await.map(|n| json!(n)).unwrap_or_else(|e| json!(err(e)));
                read_ms = read_ms.max(t.elapsed().as_millis());
                counts.push(n);
                std::fs::write(marker(&path, &format!("r{k}")), "").unwrap();
            }
            json!({"counts": counts, "slowest_read_ms": read_ms})
        }
    });
    println!("{out}");
    Ok(())
}

type Side<'a> = (&'a str, &'a [&'a str]);

fn two_processes(path: &Path, w: Side, r: Side) -> Result<serde_json::Value> {
    for e in std::fs::read_dir(path.parent().unwrap())? {
        let e = e?;
        if e.file_name().to_string_lossy().starts_with(&*path.file_name().unwrap().to_string_lossy()) {
            std::fs::remove_file(e.path())?;
        }
    }
    let exe = std::env::current_exe()?;
    let spawn = |role: &str, (engine, flags): Side| {
        let mut c = Command::new(&exe);
        c.args(["two-child", "--role", role, "--engine", engine, "--path"]).arg(path);
        for f in flags {
            c.args([format!("--{f}"), "1".into()]);
        }
        c.stdout(Stdio::piped()).spawn()
    };
    let (writer, reader) = (spawn("writer", w)?, spawn("reader", r)?);
    let parse = |o: std::process::Output| -> serde_json::Value {
        serde_json::from_slice(&o.stdout).unwrap_or_else(|_| json!({"exit": o.status.to_string()}))
    };
    Ok(json!({"writer": parse(writer.wait_with_output()?), "reader": parse(reader.wait_with_output()?)}))
}

pub fn run(args: &Args) -> Result<()> {
    let dir = PathBuf::from(args.str("dir", "target/two"));
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("study.db");
    let expected: Vec<usize> = (1..=COMMITS).map(|k| k * ROWS).collect();
    println!("{}", json!({"expected_counts": expected}));
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let rw = |turso| Open { turso, read_only: false, multiprocess: false };
    for (case, turso, second) in [
        ("rusqlite, one process, two connections", false, true),
        ("turso, one process, one Database, two connections", true, false),
        ("turso, one process, two Databases", true, true),
    ] {
        let out = rt.block_on(same_process(&path, rw(turso), second));
        println!("{}", json!({"case": case, "result": out}));
    }
    let cases: [(&str, Side, Side); 7] = [
        ("rusqlite, two processes, reader read-write", ("rusqlite", &[]), ("rusqlite", &[])),
        ("rusqlite, two processes, reader read-only", ("rusqlite", &[]), ("rusqlite", &["ro"])),
        ("turso, two processes, reader read-write", ("turso", &[]), ("turso", &[])),
        ("turso, two processes, reader read-only", ("turso", &[]), ("turso", &["ro"])),
        ("turso multiprocess WAL, two processes", ("turso", &["mp"]), ("turso", &["mp"])),
        ("rusqlite writer, turso reader", ("rusqlite", &[]), ("turso", &[])),
        ("turso writer, rusqlite reader", ("turso", &[]), ("rusqlite", &[])),
    ];
    for (case, w, r) in cases {
        let out = two_processes(&path, w, r)?;
        println!("{}", json!({"case": case, "result": out}));
    }
    Ok(())
}
