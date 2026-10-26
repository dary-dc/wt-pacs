//! README §Sync: lag from the receiver's commit to the index, a burst, a correction, and recovery after an outage.

use crate::bench::{uids, Client};
use crate::gen::{self, Study};
use crate::index;
use crate::query::encode;
use crate::receiver::{self, Published};
use crate::Args;
use mysql_async::prelude::Queryable;
use mysql_async::Pool;
use serde_json::json;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

pub const HOST: &str = "pacs-sync";
pub const KEY: &str = "site-sync";
const BACKOFF_CAP: Duration = Duration::from_secs(1);

struct Arm {
    name: String,
    url: String,
    pool: Pool,
    api: String,
    notify: UnboundedSender<PathBuf>,
    done: UnboundedReceiver<Published>,
    task: tokio::task::JoinHandle<()>,
}

fn start_publisher(pool: &Pool) -> (UnboundedSender<PathBuf>, UnboundedReceiver<Published>, tokio::task::JoinHandle<()>) {
    let (tx, rx) = unbounded_channel();
    let (dtx, drx) = unbounded_channel();
    let task = tokio::spawn(receiver::publisher(pool.clone(), rx, dtx, BACKOFF_CAP));
    (tx, drx, task)
}

/// Polls the arm's API every millisecond until `query` returns `want` studies; the time it first did.
async fn visible(api: &str, token: &str, query: &str, want: usize) -> anyhow::Result<Instant> {
    let (api, token, query) = (api.to_string(), token.to_string(), query.to_string());
    tokio::task::spawn_blocking(move || {
        let mut c = Client::connect(&api, &token)?;
        loop {
            let r = c.get(&format!("/studies?{query}"))?;
            if r.status == 200 && uids(&r.body, "0020000D").len() == want {
                return Ok(Instant::now());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    })
    .await?
}

fn fresh(seed: u64, n: usize) -> Vec<Study> {
    gen::studies(n, seed)
}

async fn wait_published(arm: &mut Arm, path: &Path) -> Published {
    loop {
        let p = arm.done.recv().await.expect("publisher alive");
        if p.path == path {
            return p;
        }
    }
}

fn shell(cmd: &str) {
    let ok = std::process::Command::new("sh").arg("-c").arg(cmd).status().map(|s| s.success()).unwrap_or(false);
    assert!(ok, "failed: {cmd}");
}

async fn up(url: &str) -> Instant {
    loop {
        let pool = Pool::from_url(url).expect("url");
        let ok = async { pool.get_conn().await?.query_drop("DO 1").await }.await.is_ok();
        let _ = pool.disconnect().await;
        if ok {
            return Instant::now();
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

pub async fn run(a: &Args) -> anyhow::Result<()> {
    let dir = PathBuf::from(a.get("dir"));
    let token = a.get("token").to_string();
    let mut out = std::fs::File::create(a.get("out"))?;
    let mut log = |v: serde_json::Value| -> anyhow::Result<()> { Ok(writeln!(out, "{v}")?) };
    let mut arms: Vec<Arm> = Vec::new();
    for (name, v) in a.pairs("arms") {
        let (url, api) = v.split_once('|').expect("dburl|api");
        let pool = index::pool(url)?;
        let (notify, done, task) = start_publisher(&pool);
        arms.push(Arm { name, url: url.to_string(), pool, api: api.to_string(), notify, done, task });
    }

    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
        let seeded = fresh(9_000, a.or("seed-studies", 10_000usize));
        let t = Instant::now();
        for s in &seeded {
            receiver::commit_new(&dir, s, HOST, KEY, false)?;
        }
        log(json!({"scenario": "seed", "studies": seeded.len(), "ms": t.elapsed().as_millis()}))?;
    }
    for arm in &arms {
        let mut c = arm.pool.get_conn().await?;
        c.exec_drop("DELETE se FROM series se JOIN study st USING (study_uid) WHERE st.host = ?", (HOST,)).await?;
        c.exec_drop("DELETE FROM study WHERE host = ?", (HOST,)).await?;
        drop(c);
        for pass in ["rebuild", "rescan"] {
            let t = Instant::now();
            let r = receiver::reconcile(&arm.pool, HOST, &dir).await?;
            log(json!({"scenario": pass, "arm": arm.name, "scanned": r.scanned, "published": r.published,
                "removed": r.removed, "ms": t.elapsed().as_millis()}))?;
        }
    }

    let rounds = a.or("rounds", 12usize);
    let mut seq = 0u64;
    let mut next_studies = |n: usize| {
        seq += 1;
        fresh(10_000 + seq, n)
    };
    for round in 0..rounds {
        for k in 0..arms.len() {
            let i = (round + k) % arms.len();
            for s in next_studies(a.or("idle", 50usize)) {
                let path = receiver::commit_new(&dir, &s, HOST, KEY, true)?;
                let committed = Instant::now();
                arms[i].notify.send(path.clone())?;
                let p = wait_published(&mut arms[i], &path).await;
                let seen = visible(&arms[i].api, &token, &format!("StudyInstanceUID={}", s.uid), 1).await?;
                log(json!({"scenario": "idle", "round": round, "arm": arms[i].name,
                    "index_us": (p.at - committed).as_micros(), "visible_us": (seen - committed).as_micros()}))?;
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            let burst = next_studies(a.or("burst", 200usize));
            let mut committed = HashMap::new();
            let t0 = Instant::now();
            for s in &burst {
                let path = receiver::commit_new(&dir, s, HOST, KEY, true)?;
                committed.insert(path.clone(), Instant::now());
                arms[i].notify.send(path)?;
            }
            let receiver_ms = t0.elapsed().as_secs_f64() * 1e3;
            let mut lags = Vec::new();
            while lags.len() < burst.len() {
                let p = arms[i].done.recv().await.expect("publisher");
                if let Some(c) = committed.get(&p.path) {
                    lags.push((p.at - *c).as_micros() as u64);
                }
            }
            lags.sort_unstable();
            log(json!({"scenario": "burst", "round": round, "arm": arms[i].name, "studies": burst.len(),
                "receiver_ms": receiver_ms, "drained_ms": t0.elapsed().as_secs_f64() * 1e3,
                "lag_p50_us": lags[lags.len() / 2], "lag_max_us": lags[lags.len() - 1]}))?;
            correction(&mut arms[i], &dir, &token, round, &mut log).await?;
        }
        eprintln!("sync round {round} done");
    }

    let outage = a.or("outage", 1000usize);
    for round in 0..a.or("recovery-rounds", 6usize) {
        for k in 0..arms.len() * 2 {
            let i = (round + k / 2) % arms.len();
            let restart_publisher = (round + k) % 2 == 1;
            if !a.0.get("recovery-arms").is_none_or(|l| l.split(',').any(|n| n == arms[i].name)) {
                continue;
            }
            shell(a.get("stop"));
            let down = Instant::now();
            if restart_publisher {
                arms[i].task.abort();
            }
            let mut pending = HashMap::new();
            for s in next_studies(outage) {
                let path = receiver::commit_new(&dir, &s, HOST, KEY, true)?;
                if !restart_publisher {
                    arms[i].notify.send(path.clone())?;
                }
                pending.insert(path, ());
            }
            shell(a.get("start"));
            let t_up = up(&arms[i].url).await;
            let mut first = None;
            let (scanned, drained) = if restart_publisher {
                let (n, d, t) = start_publisher(&arms[i].pool);
                (arms[i].notify, arms[i].done, arms[i].task) = (n, d, t);
                let r = receiver::reconcile(&arms[i].pool, HOST, &dir).await?;
                (r.scanned, Instant::now())
            } else {
                while !pending.is_empty() {
                    let p = arms[i].done.recv().await.expect("publisher");
                    first.get_or_insert(p.at);
                    pending.remove(&p.path);
                }
                (0, Instant::now())
            };
            log(json!({"scenario": "recovery", "round": round, "arm": arms[i].name,
                "publisher": if restart_publisher { "restarted" } else { "kept" }, "studies": outage,
                "outage_ms": (t_up - down).as_millis(), "scanned": scanned,
                "first_ms": first.map(|f| (f.max(t_up) - t_up).as_secs_f64() * 1e3),
                "drain_ms": (drained - t_up).as_secs_f64() * 1e3}))?;
            shell(a.get("after-start"));
        }
    }
    Ok(())
}

/// A patient's name corrected in every study DB holding it: found through the index, applied by the receiver,
/// timed until the API returns all of them under the new name.
async fn correction(
    arm: &mut Arm,
    dir: &Path,
    token: &str,
    round: usize,
    log: &mut impl FnMut(serde_json::Value) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    let mut c = arm.pool.get_conn().await?;
    let (pid, issuer, n): (String, String, usize) = c
        .exec_first(
            "SELECT patient_id, issuer_of_patient_id, COUNT(*) n FROM study WHERE host = ? \
             GROUP BY patient_id, issuer_of_patient_id HAVING n >= 3 ORDER BY patient_id LIMIT 1 OFFSET ?",
            (HOST, round * 7 + arm.name.len()),
        )
        .await?
        .expect("a patient with three studies");
    drop(c);
    let name = format!("Corrección^R{round} {}", arm.name);
    let t0 = Instant::now();
    let (api, tok, q) = (arm.api.clone(), token.to_string(), format!("PatientID={}&IssuerOfPatientID={}&limit=200", encode(&pid), encode(&issuer)));
    let found = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<String>> {
        Ok(uids(&Client::connect(&api, &tok)?.get(&format!("/studies?{q}"))?.body, "0020000D"))
    })
    .await??;
    let t_found = Instant::now();
    for uid in &found {
        let path = receiver::path_of(dir, uid);
        receiver::correct_name(&path, &name)?;
        arm.notify.send(path)?;
    }
    let t_updated = Instant::now();
    let seen = visible(&arm.api, token, &format!("PatientName={}&limit=200", encode(&name)), found.len()).await?;
    log(json!({"scenario": "correction", "round": round, "arm": arm.name, "studies": found.len(), "expected": n,
        "find_us": (t_found - t0).as_micros(), "update_us": (t_updated - t_found).as_micros(),
        "total_us": (seen - t0).as_micros()}))?;
    while arm.done.try_recv().is_ok() {}
    Ok(())
}
