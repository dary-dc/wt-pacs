//! A read beside an update, two processes, both engines: lab/sqlite-engine/README.md §5.

use crate::study::{self, percentile, SCAN};
use crate::Args;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering::SeqCst};
use std::time::{Duration, Instant};

const INSTANCES: usize = 2000;
const ROWS: usize = 2 + INSTANCES + INSTANCES / 10;
/// Added to a package's number in `xxh3`, above every value `study::build` writes.
const VERSION_BASE: i64 = 10_000_000;
const BUSY: Duration = Duration::from_secs(5);
const GIVE_UP: Duration = Duration::from_secs(1);
const RETRY: Duration = Duration::from_millis(1);
const PAUSE_MAX_MS: u64 = 20;
const UPDATE: &str = "UPDATE groups SET body = ?1, xxh3 = ?2 WHERE uid = ?3";

pub const ENGINES: [&str; 4] = ["rusqlite", "turso", "turso-ro", "turso-mp"];
pub const SCENARIOS: [&str; 3] = ["a", "b", "c"];

/// Slots of the file both processes map.
#[derive(Clone, Copy)]
enum Slot {
    Committed,
    ReceiverBegun,
    ReceiverEnded,
    ServerBegun,
    ServerEnded,
    ReceiverReady,
    Stop,
}

struct Shared(*const AtomicU64);

impl Shared {
    fn map(path: &Path, create: bool) -> Result<Shared> {
        if create {
            std::fs::write(path, [0u8; 64])?;
        }
        let f = std::fs::OpenOptions::new().read(true).write(true).open(path)?;
        use std::os::fd::AsRawFd;
        // SAFETY: a 64-byte shared mapping of a 64-byte file, never unmapped while the process runs; every access
        // is an aligned AtomicU64 within it, which both processes use only atomically.
        let p = unsafe {
            libc::mmap(std::ptr::null_mut(), 64, libc::PROT_READ | libc::PROT_WRITE, libc::MAP_SHARED, f.as_raw_fd(), 0)
        };
        if p == libc::MAP_FAILED {
            bail!("mmap {}: {}", path.display(), std::io::Error::last_os_error());
        }
        Ok(Shared(p as *const AtomicU64))
    }
    fn at(&self, s: Slot) -> &AtomicU64 {
        // SAFETY: every Slot indexes one of the mapping's 8 AtomicU64s.
        unsafe { &*self.0.add(s as usize) }
    }
    fn get(&self, s: Slot) -> u64 {
        self.at(s).load(SeqCst)
    }
}

#[derive(Clone, Copy)]
struct Engine {
    turso: bool,
    multiprocess: bool,
    read_only: bool,
    busy: Duration,
}

impl Engine {
    fn of(name: &str, server: bool) -> Engine {
        let turso = name.starts_with("turso");
        let read_only = server && (name == "rusqlite" || name == "turso-ro");
        Engine { turso, multiprocess: name == "turso-mp", read_only, busy: BUSY }
    }
}

enum Handle {
    Rusqlite(rusqlite::Connection),
    Turso { _db: turso::Database, c: turso::Connection },
}

async fn open(path: &Path, e: Engine) -> Result<Handle> {
    if e.turso {
        let db = turso::Builder::new_local(path.to_str().context("path")?)
            .read_only(e.read_only)
            .experimental_multiprocess_wal(e.multiprocess)
            .build()
            .await?;
        let c = db.connect()?;
        c.busy_timeout(e.busy)?;
        if !e.read_only {
            c.execute("PRAGMA synchronous = FULL", ()).await?;
        }
        return Ok(Handle::Turso { _db: db, c });
    }
    let flags = if e.read_only {
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX
    } else {
        rusqlite::OpenFlags::default()
    };
    let c = rusqlite::Connection::open_with_flags(path, flags)?;
    c.busy_timeout(e.busy)?;
    if !e.read_only {
        c.pragma_update(None, "synchronous", "FULL")?;
    }
    Ok(Handle::Rusqlite(c))
}

/// One package: the series row and instance `k % INSTANCES`, both stamped with `k`, in one transaction.
async fn update(h: &Handle, k: u64) -> Result<()> {
    let v = VERSION_BASE + k as i64;
    let body = study::body(v as u64);
    let uids = [study::series_uid(1), study::instance_uid(1, k as usize % INSTANCES)];
    match h {
        Handle::Rusqlite(c) => {
            let tx = c.unchecked_transaction()?;
            for uid in &uids {
                tx.prepare_cached(UPDATE)?.execute(rusqlite::params![body, v, uid])?;
            }
            tx.commit()?;
        }
        Handle::Turso { c, .. } => {
            c.execute("BEGIN", ()).await?;
            for uid in &uids {
                if let Err(e) = c.execute(UPDATE, (turso::Value::Blob(body.clone()), v, uid.as_str())).await {
                    let _ = c.execute("ROLLBACK", ()).await;
                    return Err(e.into());
                }
            }
            c.execute("COMMIT", ()).await?;
        }
    }
    Ok(())
}

type Group = (String, Vec<u8>, i64);

async fn read(h: &Handle) -> Result<Vec<Group>> {
    let series = study::series_uid(1);
    let mut out = Vec::with_capacity(ROWS);
    match h {
        Handle::Rusqlite(c) => {
            let mut s = c.prepare_cached(SCAN)?;
            let rows = s.query_map([&series], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            for r in rows {
                out.push(r?);
            }
        }
        Handle::Turso { c, .. } => {
            let mut rows = c.query(SCAN, (series.as_str(),)).await?;
            while let Some(r) = rows.next().await? {
                let uid = r.get_value(0)?.as_text().context("uid")?.clone();
                let body = r.get_value(1)?.as_blob().context("body")?.clone();
                out.push((uid, body, *r.get_value(2)?.as_integer().context("xxh3")?));
            }
        }
    }
    Ok(out)
}

/// The package number a read saw, or `None` if it is torn: a row missing, a body not the one its `xxh3` names, or
/// the instance the series row names not carrying the same number.
fn seen(groups: &[Group]) -> Option<u64> {
    if groups.len() != ROWS || groups.iter().any(|(_, b, x)| *b != study::body(*x as u64)) {
        return None;
    }
    let series = groups.iter().find(|g| g.0 == study::series_uid(1))?.2;
    if series < VERSION_BASE {
        return Some(0);
    }
    let k = (series - VERSION_BASE) as u64;
    let instance = study::instance_uid(1, k as usize % INSTANCES);
    groups.iter().any(|g| g.0 == instance && g.2 == series).then_some(k)
}

#[derive(Default)]
struct Side {
    done: usize,
    refused: usize,
    stale: usize,
    torn: usize,
    lag: Vec<f64>,
    wait_ms: Vec<f64>,
    overlapped_ms: Vec<f64>,
    alone_ms: Vec<f64>,
    errors: HashMap<String, usize>,
}

impl Side {
    fn error(&mut self, e: &anyhow::Error, path: &Path) {
        let text = format!("{e:#}").replace(&path.display().to_string(), "<db>");
        *self.errors.entry(text).or_default() += 1;
    }
    fn json(&self) -> Value {
        json!({"done": self.done, "refused": self.refused, "stale": self.stale, "torn": self.torn, "lag": self.lag,
               "wait_ms": self.wait_ms, "overlapped_ms": self.overlapped_ms, "alone_ms": self.alone_ms,
               "errors": self.errors})
    }
}

/// The other side's begun and ended counters, read before an operation, tell whether it overlapped one of theirs.
struct Overlap {
    begun: u64,
    in_flight: bool,
    other: Slot,
}

impl Overlap {
    fn start(s: &Shared, begun: Slot, ended: Slot) -> Overlap {
        let ended_before = s.get(ended);
        let begun_before = s.get(begun);
        Overlap { begun: begun_before, in_flight: begun_before > ended_before, other: begun }
    }
    fn overlapped(&self, s: &Shared) -> bool {
        self.in_flight || s.get(self.other) > self.begun
    }
}

fn pause(n: u64) -> Duration {
    let x = n.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 11;
    Duration::from_micros(x % (PAUSE_MAX_MS * 1000 + 1))
}

/// Runs `attempt` until it succeeds or `GIVE_UP` passes, dropping the held handle after each failure.
/// Returns the wait before the attempt that succeeded and that attempt's own duration, or `None` if refused.
async fn retried<T, F>(
    side: &mut Side,
    path: &Path,
    e: Engine,
    held: &mut Option<Handle>,
    keep: bool,
    mut attempt: F,
) -> Option<(f64, f64, T)>
where
    F: for<'h> FnMut(&'h Handle) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<T>> + 'h>>,
{
    let t0 = Instant::now();
    let mut a = t0;
    loop {
        let result = match held.take() {
            Some(h) => Ok(h),
            None => open(path, e).await,
        };
        let result = match result {
            Ok(h) => {
                let r = attempt(&h).await;
                if r.is_ok() && keep {
                    *held = Some(h);
                }
                r
            }
            Err(err) => Err(err),
        };
        match result {
            Ok(v) => return Some((ms(a - t0), ms(a.elapsed()), v)),
            Err(err) => side.error(&err, path),
        }
        if t0.elapsed() >= GIVE_UP {
            return None;
        }
        tokio::time::sleep(RETRY).await;
        a = Instant::now();
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1e3
}

async fn receiver(path: &Path, s: &Shared, e: Engine, keep: bool) -> Side {
    let mut side = Side::default();
    let mut held = None;
    if keep {
        match open(path, e).await {
            Ok(h) => held = Some(h),
            Err(err) => side.error(&err, path),
        }
    }
    s.at(Slot::ReceiverReady).store(1, SeqCst);
    let mut k = 0;
    while s.get(Slot::Stop) == 0 {
        k += 1;
        let o = Overlap::start(s, Slot::ServerBegun, Slot::ServerEnded);
        s.at(Slot::ReceiverBegun).fetch_add(1, SeqCst);
        let r = retried(&mut side, path, e, &mut held, keep, |h| Box::pin(update(h, k))).await;
        if r.is_some() {
            s.at(Slot::Committed).store(k, SeqCst);
        }
        s.at(Slot::ReceiverEnded).fetch_add(1, SeqCst);
        record(&mut side, r.map(|(w, d, ())| (w, d)), o.overlapped(s));
        tokio::time::sleep(pause(k)).await;
    }
    side
}

fn record(side: &mut Side, r: Option<(f64, f64)>, overlapped: bool) {
    let Some((wait, took)) = r else {
        side.refused += 1;
        return;
    };
    side.done += 1;
    if wait > 0.0 {
        side.wait_ms.push(wait);
    }
    if overlapped { &mut side.overlapped_ms } else { &mut side.alone_ms }.push(took);
}

async fn server(path: &Path, s: &Shared, e: Engine, keep: bool, secs: f64) -> Side {
    let mut side = Side::default();
    let mut held = None;
    let end = Instant::now() + Duration::from_secs_f64(secs);
    let mut n = 1u64 << 32;
    while Instant::now() < end {
        n += 1;
        let committed = s.get(Slot::Committed);
        let o = Overlap::start(s, Slot::ReceiverBegun, Slot::ReceiverEnded);
        s.at(Slot::ServerBegun).fetch_add(1, SeqCst);
        let r = retried(&mut side, path, e, &mut held, keep, |h| Box::pin(read(h))).await;
        s.at(Slot::ServerEnded).fetch_add(1, SeqCst);
        let overlapped = o.overlapped(s);
        if let Some((_, _, groups)) = &r {
            match seen(groups) {
                None => side.torn += 1,
                Some(k) if k < committed => {
                    side.stale += 1;
                    side.lag.push((committed - k) as f64);
                }
                Some(_) => {}
            }
        }
        record(&mut side, r.map(|(w, d, _)| (w, d)), overlapped);
        tokio::time::sleep(pause(n)).await;
    }
    s.at(Slot::Stop).store(1, SeqCst);
    side
}

pub fn child(args: &Args) -> Result<()> {
    let path = PathBuf::from(args.str("path", ""));
    let role = args.str("role", "");
    let scenario = args.str("scenario", "a");
    let mut e = Engine::of(&args.str("engine", ""), role == "server");
    e.busy = Duration::from_millis(args.get("busy-ms", 5000));
    let keep = scenario == "c" || (scenario == "a" && role == "receiver");
    let s = Shared::map(Path::new(&args.str("shared", "")), false)?;
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let side = rt.block_on(async {
        if role == "receiver" {
            receiver(&path, &s, e, keep).await
        } else {
            server(&path, &s, e, keep, args.get("secs", 3.0)).await
        }
    });
    println!("{}", side.json());
    Ok(())
}

fn shared_path(db: &Path) -> PathBuf {
    PathBuf::from(format!("{}.shared", db.display()))
}

/// `busy0`: busy timeout 0, so an engine-internal wait becomes a counted error; `apart`: the server reads its own
/// copy of the file, so nothing but the host is shared.
fn round(dir: &Path, (engine, scenario, variant): Arm, secs: f64) -> Result<Value> {
    let path = dir.join("study.db");
    let apart = dir.join("apart.db");
    for e in std::fs::read_dir(dir)? {
        std::fs::remove_file(e?.path())?;
    }
    study::build(&path, 1, INSTANCES)?;
    study::build(&apart, 1, INSTANCES)?;
    let s = Shared::map(&shared_path(&path), true)?;
    let exe = std::env::current_exe()?;
    let busy_ms = if variant == "busy0" { "0" } else { "5000" };
    let spawn = |role: &str| {
        let file = if role == "server" && variant == "apart" { &apart } else { &path };
        Command::new(&exe)
            .args(["lock-child", "--role", role, "--engine", engine, "--scenario", scenario, "--secs", &secs.to_string()])
            .args(["--busy-ms", busy_ms, "--path"])
            .arg(file)
            .arg("--shared")
            .arg(shared_path(&path))
            .stdout(Stdio::piped())
            .spawn()
    };
    let receiver = spawn("receiver")?;
    let t = Instant::now();
    while s.get(Slot::ReceiverReady) == 0 {
        if t.elapsed() > Duration::from_secs(10) {
            bail!("{engine} {scenario}: the receiver never opened");
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    let server = spawn("server")?;
    let parse = |c: std::process::Child| -> Result<Value> {
        let o = c.wait_with_output()?;
        Ok(serde_json::from_slice(&o.stdout).unwrap_or_else(|_| json!({"exit": o.status.to_string()})))
    };
    let server = parse(server)?;
    Ok(json!({"engine": engine, "scenario": scenario, "variant": variant, "server": server, "receiver": parse(receiver)?}))
}

fn stats(mut v: Vec<f64>) -> Value {
    v.sort_by(f64::total_cmp);
    json!({"n": v.len(), "p50": percentile(&v, 0.5), "p99": percentile(&v, 0.99), "max": v.last()})
}

/// Pools one arm's rounds: counts summed, distributions merged, errors by text.
fn summary(rows: &[&Value]) -> Value {
    let side = |name: &str| {
        let sum = |k: &str| rows.iter().map(|r| r[name][k].as_u64().unwrap_or(0)).sum::<u64>();
        let pool = |k: &str| -> Vec<f64> {
            rows.iter().flat_map(|r| r[name][k].as_array().into_iter().flatten().filter_map(Value::as_f64)).collect()
        };
        let mut errors: HashMap<String, u64> = HashMap::new();
        for r in rows {
            for (text, n) in r[name]["errors"].as_object().into_iter().flatten() {
                *errors.entry(text.clone()).or_default() += n.as_u64().unwrap_or(0);
            }
        }
        json!({"done": sum("done"), "refused": sum("refused"), "stale": sum("stale"), "torn": sum("torn"),
               "lag": stats(pool("lag")), "wait_ms": stats(pool("wait_ms")), "overlapped_ms": stats(pool("overlapped_ms")),
               "alone_ms": stats(pool("alone_ms")), "errors": errors})
    };
    json!({"server": side("server"), "receiver": side("receiver")})
}

type Arm = (&'static str, &'static str, &'static str);

/// `engine:scenario[:variant]`, each from its list.
fn parse_arm(spec: &str) -> Result<Arm> {
    let mut it = spec.split(':');
    let pick = |v: Option<&str>, from: &[&'static str]| -> Result<&'static str> {
        let v = v.unwrap_or("");
        from.iter().copied().find(|x| *x == v).with_context(|| format!("{spec}: {v} is not one of {from:?}"))
    };
    Ok((pick(it.next(), &ENGINES)?, pick(it.next(), &SCENARIOS)?, pick(it.next(), &["", "busy0", "apart"])?))
}

pub fn run(args: &Args) -> Result<()> {
    let dir = PathBuf::from(args.str("dir", "target/lock"));
    let rounds: usize = args.get("rounds", 6);
    let secs: f64 = args.get("secs", 3.0);
    std::fs::create_dir_all(&dir)?;
    let spec = args.str("arms", "");
    let arms: Vec<Arm> = if spec.is_empty() {
        ENGINES.iter().flat_map(|e| SCENARIOS.iter().map(move |s| (*e, *s, ""))).collect()
    } else {
        spec.split(',').map(parse_arm).collect::<Result<_>>()?
    };
    let mut all = Vec::new();
    for r in 0..rounds {
        let k = r % arms.len();
        for arm in arms[k..].iter().chain(&arms[..k]) {
            let mut row = round(&dir, *arm, secs)?;
            row["round"] = json!(r);
            println!("{row}");
            all.push(row);
        }
    }
    for (engine, scenario, variant) in &arms {
        let rows: Vec<&Value> = all
            .iter()
            .filter(|r| r["engine"] == *engine && r["scenario"] == *scenario && r["variant"] == *variant)
            .collect();
        println!("{}", json!({"summary": format!("{engine} {scenario} {variant}"), "pooled": summary(&rows)}));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn study(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sqlite-engine-lock-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.db");
        study::build(&path, 1, INSTANCES).unwrap();
        path
    }

    /// Both engines read the package an update wrote, untorn, and a fresh file reads as package 0.
    #[tokio::test]
    async fn a_read_names_the_last_package_written() {
        for name in ["rusqlite", "turso"] {
            let path = study(name);
            let h = open(&path, Engine::of(name, false)).await.unwrap();
            assert_eq!(seen(&read(&h).await.unwrap()), Some(0), "{name}");
            update(&h, 7).await.unwrap();
            assert_eq!(seen(&read(&h).await.unwrap()), Some(7), "{name}");
        }
    }

    /// A read with the series row stamped but its instance not, or a body changed, or a row missing, is torn.
    #[tokio::test]
    async fn a_torn_read_is_named() {
        let path = study("torn");
        let h = open(&path, Engine::of("rusqlite", false)).await.unwrap();
        update(&h, 3).await.unwrap();
        let good = read(&h).await.unwrap();
        let series = study::series_uid(1);
        let mut half = good.clone();
        half.iter_mut().filter(|g| g.0 != series && g.2 == VERSION_BASE + 3).for_each(|g| {
            g.2 = 5;
            g.1 = study::body(5);
        });
        let mut flipped = good.clone();
        flipped[10].1[0] ^= 1;
        assert_eq!(seen(&good), Some(3));
        assert_eq!((seen(&half), seen(&flipped), seen(&good[1..])), (None, None, None));
    }

    /// An operation overlaps when the other side was mid-operation at its start or began one before it ended.
    #[test]
    fn overlap_is_in_flight_or_begun_during() {
        let dir = study("overlap");
        let s = Shared::map(&shared_path(&dir), true).unwrap();
        let o = Overlap::start(&s, Slot::ServerBegun, Slot::ServerEnded);
        assert!(!o.overlapped(&s));
        s.at(Slot::ServerBegun).fetch_add(1, SeqCst);
        assert!(o.overlapped(&s));
        assert!(Overlap::start(&s, Slot::ServerBegun, Slot::ServerEnded).overlapped(&s));
        s.at(Slot::ServerEnded).fetch_add(1, SeqCst);
        assert!(!Overlap::start(&s, Slot::ServerBegun, Slot::ServerEnded).overlapped(&s));
    }

    /// A failed attempt is counted and retried; the wait is what came before the attempt that succeeded, zero if
    /// the first did; an operation that never succeeds is refused after `GIVE_UP`.
    #[tokio::test]
    async fn a_retried_operation_waits_then_succeeds_or_is_refused() {
        let path = study("retry");
        let e = Engine::of("rusqlite", false);
        let (mut side, mut held) = (Side::default(), None);
        let first = retried(&mut side, &path, e, &mut held, false, |_| Box::pin(async { Ok(()) })).await.unwrap();
        assert_eq!(first.0, 0.0);
        let mut failures = 2;
        let r = retried(&mut side, &path, e, &mut held, false, |_| {
            failures -= 1;
            let fail = failures >= 0;
            Box::pin(async move { if fail { bail!("busy") } else { Ok(()) } })
        })
        .await
        .unwrap();
        assert!(r.0 >= 2.0 * ms(RETRY), "{r:?}");
        assert_eq!(side.errors["busy"], 2);
        let t = Instant::now();
        let refused: Option<(f64, f64, ())> =
            retried(&mut side, &path, e, &mut held, false, |_| Box::pin(async { bail!("busy") })).await;
        assert!(refused.is_none() && t.elapsed() >= GIVE_UP);
    }

    /// A Turso read-write open fails at once, not after a wait, while another process holds the file.
    #[test]
    fn a_second_turso_process_is_refused_at_once() {
        let path = study("refused");
        let mut holder = Command::new("python3")
            .args(["-c", "import fcntl,sys,time; f=open(sys.argv[1],'r+'); fcntl.lockf(f, fcntl.LOCK_EX); print(1, flush=True); time.sleep(3)"])
            .arg(&path)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        std::io::BufRead::read_line(&mut std::io::BufReader::new(holder.stdout.as_mut().unwrap()), &mut line).unwrap();
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let t = Instant::now();
        let r = rt.block_on(open(&path, Engine::of("turso", false)));
        let took = t.elapsed();
        holder.kill().unwrap();
        let err = format!("{:#}", r.err().expect("the open must fail"));
        assert!(err.contains("locked by another process"), "{err}");
        assert!(took < Duration::from_millis(500), "{took:?}");
    }
}
