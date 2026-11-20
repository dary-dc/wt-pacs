use crate::study::{self, percentile, SCAN};
use crate::Args;
use anyhow::{Context as _, Result};
use serde_json::json;
use std::collections::BTreeSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

const ARMS: [&str; 9] = [
    "idle",
    "turso",
    "turso-uring",
    "rusqlite",
    "rusqlite-blocking",
    "rusqlite-selfwake",
    "turso-blocking",
    "turso-uring-blocking",
    "rusqlite-blocking-tuned",
];
const READERS: usize = 4;
const PERIOD: Duration = Duration::from_millis(1);
const MMAP_BYTES: i64 = 256 << 20;

fn tid() -> i64 {
    unsafe { libc::syscall(libc::SYS_gettid) }
}

/// Counts the polls of the future it wraps that returned `Pending`.
struct CountPending<'a, F> {
    inner: Pin<Box<F>>,
    pending: &'a AtomicU64,
}

impl<F: Future> Future for CountPending<'_, F> {
    type Output = F::Output;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<F::Output> {
        let poll = self.inner.as_mut().poll(cx);
        if poll.is_pending() {
            self.pending.fetch_add(1, Relaxed);
        }
        poll
    }
}

#[derive(Default)]
struct Seen {
    pending: AtomicU64,
    reader_tids: Mutex<BTreeSet<i64>>,
    blocking_tids: Mutex<BTreeSet<i64>>,
}

enum Reader {
    Turso(turso::Statement),
    TursoBlocking(Arc<Mutex<turso::Statement>>),
    Direct(rusqlite::Connection),
    Blocking(Arc<Mutex<rusqlite::Connection>>),
}

fn scan_rusqlite(c: &rusqlite::Connection, series: &str) -> Result<usize> {
    let mut stmt = c.prepare_cached(SCAN)?;
    let mut rows = stmt.query([series])?;
    let mut bytes = 0;
    while let Some(row) = rows.next()? {
        bytes += row.get_ref(1)?.as_blob()?.len();
    }
    Ok(bytes)
}

async fn scan_turso(stmt: &mut turso::Statement, series: &str, seen: &Seen) -> Result<usize> {
    let mut rows = stmt.query([series]).await?;
    let mut bytes = 0;
    loop {
        let next = CountPending { inner: Box::pin(rows.next()), pending: &seen.pending };
        match next.await? {
            Some(row) => bytes += row.get_value(1)?.as_blob().map_or(0, Vec::len),
            None => return Ok(bytes),
        }
    }
}

async fn turso_open(path: &Path, uring: bool, cache_pages: i64) -> Result<(turso::Connection, i64)> {
    let mut b = turso::Builder::new_local(path.to_str().unwrap());
    if uring {
        b = b.with_io("io_uring");
    }
    let conn = b.build().await?.connect()?;
    if cache_pages > 0 {
        conn.execute(format!("PRAGMA cache_size = {cache_pages}"), ()).await?;
    }
    let mut rows = conn.query("PRAGMA cache_size", ()).await?;
    let held = *rows.next().await?.context("cache_size")?.get_value(0)?.as_integer().context("cache_size")?;
    Ok((conn, held))
}

pub fn rusqlite_open(path: &Path, tuned: bool, cache_pages: i64) -> Result<rusqlite::Connection> {
    let c = if tuned {
        use rusqlite::OpenFlags as F;
        let c =
            rusqlite::Connection::open_with_flags(path, F::SQLITE_OPEN_READ_ONLY | F::SQLITE_OPEN_NO_MUTEX | F::SQLITE_OPEN_URI)?;
        c.pragma_update(None, "mmap_size", MMAP_BYTES)?;
        c
    } else {
        rusqlite::Connection::open(path)?
    };
    if cache_pages > 0 {
        c.pragma_update(None, "cache_size", cache_pages)?;
    }
    Ok(c)
}

/// The reader and the engine cache it holds, as `PRAGMA cache_size` reads it back.
async fn open(arm: &str, path: &Path, cache_pages: i64) -> Result<(Reader, i64)> {
    if arm.starts_with("turso") {
        let (conn, held) = turso_open(path, arm.contains("uring"), cache_pages).await?;
        let stmt = conn.prepare(SCAN).await?;
        let reader =
            if arm.ends_with("blocking") { Reader::TursoBlocking(Arc::new(Mutex::new(stmt))) } else { Reader::Turso(stmt) };
        return Ok((reader, held));
    }
    let c = rusqlite_open(path, arm.ends_with("tuned"), cache_pages)?;
    let held = c.pragma_query_value(None, "cache_size", |r| r.get(0))?;
    Ok((if arm.contains("blocking") { Reader::Blocking(Arc::new(Mutex::new(c))) } else { Reader::Direct(c) }, held))
}

async fn read(reader: &mut Reader, series: &str, seen: &Arc<Seen>) -> Result<usize> {
    match reader {
        Reader::Turso(stmt) => scan_turso(stmt, series, seen).await,
        Reader::TursoBlocking(stmt) => {
            let (stmt, series, counts, rt) = (stmt.clone(), series.to_owned(), seen.clone(), tokio::runtime::Handle::current());
            let (bytes, t) = tokio::task::spawn_blocking(move || {
                (rt.block_on(scan_turso(&mut stmt.lock().unwrap(), &series, &counts)), tid())
            })
            .await?;
            seen.blocking_tids.lock().unwrap().insert(t);
            bytes
        }
        Reader::Direct(c) => scan_rusqlite(c, series),
        Reader::Blocking(c) => {
            let (c, series) = (c.clone(), series.to_owned());
            let (bytes, t) = tokio::task::spawn_blocking(move || (scan_rusqlite(&c.lock().unwrap(), &series), tid())).await?;
            seen.blocking_tids.lock().unwrap().insert(t);
            bytes
        }
    }
}

struct Round {
    lateness_us: Vec<f64>,
    scan_ms: Vec<f64>,
    seen: Arc<Seen>,
    cache_held: Option<i64>,
}

async fn round(arm: &'static str, files: &[PathBuf], secs: f64, cache_pages: i64) -> Result<Round> {
    let seen = Arc::new(Seen::default());
    let stop = Arc::new(AtomicBool::new(false));
    let mut readers = Vec::new();
    let mut cache_held = None;
    if arm != "idle" {
        for (i, path) in files.iter().enumerate() {
            let (mut reader, held) = open(arm, path, cache_pages).await?;
            cache_held = Some(held);
            read(&mut reader, &study::series_uid(i), &seen).await?;
            let (seen, stop) = (seen.clone(), stop.clone());
            readers.push(tokio::spawn(async move {
                let mut scan_ms = Vec::new();
                while !stop.load(Relaxed) {
                    let t = Instant::now();
                    read(&mut reader, &study::series_uid(i), &seen).await?;
                    scan_ms.push(t.elapsed().as_secs_f64() * 1e3);
                    seen.reader_tids.lock().unwrap().insert(tid());
                    if arm == "rusqlite-selfwake" {
                        std::future::poll_fn(|cx| {
                            cx.waker().wake_by_ref();
                            Poll::Ready(())
                        })
                        .await;
                    }
                    tokio::task::yield_now().await;
                }
                anyhow::Ok(scan_ms)
            }));
        }
    }
    seen.pending.store(0, Relaxed);
    let beat_stop = stop.clone();
    let heartbeat = tokio::spawn(async move {
        let mut late = Vec::new();
        let mut next = Instant::now() + PERIOD;
        while !beat_stop.load(Relaxed) {
            tokio::time::sleep_until(next.into()).await;
            let now = Instant::now();
            late.push((now - next).as_secs_f64() * 1e6);
            next = (next + PERIOD).max(now + PERIOD / 2);
        }
        late
    });
    tokio::time::sleep(Duration::from_secs_f64(secs)).await;
    stop.store(true, Relaxed);
    let mut scan_ms = Vec::new();
    for r in readers {
        scan_ms.extend(r.await??);
    }
    Ok(Round { lateness_us: heartbeat.await?, scan_ms, seen, cache_held })
}

fn stats(mut v: Vec<f64>) -> serde_json::Value {
    v.sort_by(f64::total_cmp);
    json!({"n": v.len(), "p50": percentile(&v, 0.5), "p99": percentile(&v, 0.99), "max": v.last()})
}

pub fn run(args: &Args) -> Result<()> {
    let dir = PathBuf::from(args.str("dir", "target/blocking"));
    let workers: usize = args.get("workers", 1);
    let rounds: usize = args.get("rounds", 12);
    let secs: f64 = args.get("secs", 2.0);
    let instances: usize = args.get("instances", 2000);
    let only = args.str("arm", "");
    let cache_pages: i64 = args.get("cache-pages", 0);
    std::fs::create_dir_all(&dir)?;
    let files: Vec<PathBuf> = (0..READERS).map(|i| dir.join(format!("s{i}.db"))).collect();
    for (i, f) in files.iter().enumerate() {
        if !args.has("keep") || !f.exists() {
            study::build(f, i, instances)?;
        }
    }
    let arms: Vec<&'static str> = match only.as_str() {
        "" => ARMS[..5].to_vec(),
        only => ARMS.iter().copied().filter(|a| only.split(',').any(|o| o == *a)).collect(),
    };
    let mut all: Vec<(Vec<f64>, Vec<f64>, u64, u64)> = vec![Default::default(); arms.len()];
    for r in 0..rounds {
        for k in 0..arms.len() {
            let a = (k + r) % arms.len();
            let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(workers).enable_all().build()?;
            let res = match rt.block_on(round(arms[a], &files, secs, cache_pages)) {
                Ok(res) => res,
                Err(e) => {
                    println!("{}", json!({"arm": arms[a], "round": r, "error": e.to_string()}));
                    continue;
                }
            };
            let reader_tids: Vec<i64> = res.seen.reader_tids.lock().unwrap().iter().copied().collect();
            let blocking_tids: Vec<i64> = res.seen.blocking_tids.lock().unwrap().iter().copied().collect();
            let pending = res.seen.pending.load(Relaxed);
            println!(
                "{}",
                json!({"arm": arms[a], "round": r, "workers": workers, "cache_pages": cache_pages, "pid": std::process::id(),
                       "lateness_us": stats(res.lateness_us.clone()), "scan_ms": stats(res.scan_ms.clone()),
                       "next_pending": pending, "reader_tids": reader_tids, "blocking_tids": blocking_tids,
                       "cache_held": res.cache_held, "build": crate::BUILD,
                       "raw": args.has("raw").then(|| json!({"lateness_us": &res.lateness_us, "scan_ms": &res.scan_ms}))})
            );
            let cell = &mut all[a];
            cell.0.extend(res.lateness_us);
            cell.2 += res.scan_ms.len() as u64;
            cell.1.extend(res.scan_ms);
            cell.3 += pending;
        }
    }
    for (a, (late, scans, n, pending)) in all.into_iter().enumerate() {
        println!(
            "{}",
            json!({"summary": arms[a], "workers": workers, "cache_pages": cache_pages, "lateness_us": stats(late), "scan_ms": stats(scans),
                   "reads_per_s": n as f64 / (rounds as f64 * secs), "next_pending": pending})
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The wrapper counts exactly the polls that returned `Pending`: a future pending twice counts 2.
    #[tokio::test]
    async fn counts_each_pending_poll() {
        let pending = AtomicU64::new(0);
        let mut left = 2;
        let twice = std::future::poll_fn(move |cx| {
            if left == 0 {
                return Poll::Ready(());
            }
            left -= 1;
            cx.waker().wake_by_ref();
            Poll::Pending
        });
        CountPending { inner: Box::pin(twice), pending: &pending }.await;
        assert_eq!(pending.load(Relaxed), 2);
    }

    /// Every arm reads every row of the series, 1 KB each, from a file rusqlite built: Turso reads SQLite's format.
    #[tokio::test]
    async fn every_arm_reads_the_whole_series() {
        let dir = std::env::temp_dir().join(format!("sqlite-engine-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.db");
        study::build(&path, 7, 300).unwrap();
        let seen = Arc::new(Seen::default());
        let rows = 2 + 300 + 30;
        for arm in ARMS[1..].iter().filter(|a| !a.contains("uring") || uring_allowed()) {
            for cache_pages in [0, 64] {
                let (mut reader, _) = open(arm, &path, cache_pages).await.unwrap();
                let bytes = read(&mut reader, &study::series_uid(7), &seen).await.unwrap();
                assert_eq!(bytes, rows * study::BODY, "{arm}, {cache_pages} pages");
            }
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn uring_allowed() -> bool {
        turso::core::UringIO::new().is_ok()
    }

    /// `PRAGMA cache_size = 64` holds 64 pages in SQLite and 200 in Turso, its floor; the default is -2000 (KiB) in both.
    #[tokio::test]
    async fn the_64_page_cache_is_200_pages_in_turso() {
        let dir = std::env::temp_dir().join(format!("sqlite-engine-cache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.db");
        study::build(&path, 1, 10).unwrap();
        let held = |arm: &'static str, pages| {
            let path = path.clone();
            async move { open(arm, &path, pages).await.unwrap().1 }
        };
        assert_eq!((held("rusqlite", 64).await, held("rusqlite-blocking-tuned", 64).await), (64, 64));
        assert_eq!((held("turso", 64).await, held("turso-blocking", 64).await), (200, 200));
        assert_eq!((held("rusqlite", 0).await, held("turso", 0).await), (-2000, -2000));
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// The tuned rusqlite reader is read-only and maps up to 256 MiB of the file.
    #[test]
    fn the_tuned_rusqlite_reader_is_read_only_and_mapped() {
        let dir = std::env::temp_dir().join(format!("sqlite-engine-tuned-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.db");
        study::build(&path, 1, 10).unwrap();
        let c = rusqlite_open(&path, true, 0).unwrap();
        assert_eq!(c.pragma_query_value(None, "mmap_size", |r| r.get::<_, i64>(0)).unwrap(), MMAP_BYTES);
        assert!(c.execute("DELETE FROM groups", []).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
