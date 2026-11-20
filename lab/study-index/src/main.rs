//! The study index prototype: `gen`, `api`, `forward`, `bench`, `sweep`, `check`, `sync` — README §Run.

mod api;
mod bench;
mod engine;
mod forward;
mod gen;
mod index;
mod lite;
mod pg;
mod query;
mod receiver;
mod sync;

use bench::{Client, Samples, CELLS};
use gen::{Rng, Study};
use serde_json::json;
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use std::time::{Duration, Instant};

struct Args(HashMap<String, String>);

impl Args {
    fn parse() -> (String, Args) {
        let mut it = std::env::args().skip(1);
        let cmd = it.next().unwrap_or_default();
        let mut map = HashMap::new();
        while let Some(k) = it.next() {
            map.insert(k.trim_start_matches("--").to_string(), it.next().unwrap_or_default());
        }
        (cmd, Args(map))
    }
    fn get(&self, k: &str) -> &str {
        self.0.get(k).map(String::as_str).unwrap_or_else(|| panic!("--{k} is required"))
    }
    fn or<T: std::str::FromStr>(&self, k: &str, default: T) -> T {
        self.0.get(k).and_then(|v| v.parse().ok()).unwrap_or(default)
    }
    /// `name=value,…` pairs, in order.
    fn pairs(&self, k: &str) -> Vec<(String, String)> {
        self.get(k)
            .split(',')
            .map(|p| p.split_once('=').map(|(a, b)| (a.to_string(), b.to_string())).expect("name=value"))
            .collect()
    }
}

/// `size:seed` datasets, generated once.
fn datasets(spec: &str) -> Vec<(usize, Vec<Study>)> {
    spec.split(',')
        .map(|p| {
            let (n, seed) = p.split_once(':').expect("size:seed");
            let n: usize = n.parse().expect("size");
            (n, gen::studies(n, seed.parse().expect("seed")))
        })
        .collect()
}

fn shell(cmd: &str) {
    let ok = std::process::Command::new("sh").arg("-c").arg(cmd).status().map(|s| s.success()).unwrap_or(false);
    assert!(ok, "failed: {cmd}");
}

/// `arm=size@host:port` → (arm, size, address).
fn arms(a: &Args) -> Vec<(String, usize, String)> {
    a.pairs("arms")
        .into_iter()
        .map(|(arm, v)| {
            let (size, addr) = v.split_once('@').expect("size@addr");
            (arm, size.parse().expect("size"), addr.to_string())
        })
        .collect()
}

fn rotate<T: Clone>(v: &[T], by: usize) -> Vec<T> {
    let k = by % v.len().max(1);
    v[k..].iter().chain(&v[..k]).cloned().collect()
}

fn cells() -> Vec<(&'static str, u64)> {
    CELLS.iter().flat_map(|c| if *c == "series" { vec![(*c, 0)] } else { vec![(*c, 0), (*c, 1000)] }).collect()
}

/// §11's rounds: a cold pass after the restart command, the whole index loaded, then `warm` interleaved passes.
fn latency(a: &Args) -> anyhow::Result<()> {
    let data = datasets(a.get("sizes"));
    let key = a.get("key");
    let samples: HashMap<usize, Samples> = data.iter().map(|(n, s)| (*n, Samples::new(s, key))).collect();
    let arms = arms(a);
    let mut out = std::io::BufWriter::new(std::fs::File::create(a.get("out"))?);
    let (rounds, warm) = (a.or("rounds", 12usize), a.or("warm", 20usize));
    let cells = cells();
    for round in 0..rounds {
        shell(a.get("restart"));
        let mut clients: Vec<Client> = arms.iter().map(|(_, _, addr)| Client::connect(addr, a.get("token"))).collect::<Result<_, _>>()?;
        for c in clients.iter_mut() {
            c.get("/health")?;
        }
        let mut rng = Rng::new(1000 + round as u64);
        let order: Vec<usize> = (0..arms.len()).collect();
        let mut record = |phase: &str, i: usize, cell: &str, offset: u64, rng: &mut Rng, clients: &mut [Client]| -> anyhow::Result<()> {
            let (arm, size, _) = &arms[i];
            let (q, s) = samples[size].draw(cell, offset, rng);
            let r = clients[i].get(&bench::path(cell, &q, s))?;
            let rows = serde_json::from_slice::<Vec<serde_json::Value>>(&r.body).map(|v| v.len()).unwrap_or(0);
            writeln!(out, "{}", json!({"phase": phase, "round": round, "arm": arm, "size": size, "cell": cell,
                "offset": offset, "status": r.status, "client_us": r.client_us, "db_us": r.db_us,
                "app_us": r.app_us, "rows": rows}))?;
            Ok(())
        };
        for (size, _) in &data {
            let of_size: Vec<usize> = (0..arms.len()).filter(|&i| arms[i].1 == *size).collect();
            let i = of_size[round % of_size.len()];
            for (cell, offset) in rotate(&cells, round) {
                record("cold", i, cell, offset, &mut rng, &mut clients)?;
            }
        }
        shell(a.get("warm-load"));
        for _ in 0..3 {
            for (cell, offset) in &cells {
                for &i in &order {
                    let (q, s) = samples[&arms[i].1].draw(cell, *offset, &mut rng);
                    clients[i].get(&bench::path(cell, &q, s))?;
                }
            }
        }
        for pass in 0..warm {
            for (cell, offset) in rotate(&cells, round + pass) {
                for i in rotate(&order, round * warm + pass) {
                    record("warm", i, cell, offset, &mut rng, &mut clients)?;
                }
            }
        }
        out.flush()?;
        eprintln!("round {round} done");
    }
    Ok(())
}

fn cpu_busy() -> (u64, u64) {
    let stat = std::fs::read_to_string("/proc/stat").unwrap_or_default();
    let v: Vec<u64> = stat.lines().next().unwrap_or("").split_whitespace().skip(1).filter_map(|x| x.parse().ok()).collect();
    let idle = v.get(3).copied().unwrap_or(0) + v.get(4).copied().unwrap_or(0);
    (v.iter().sum::<u64>() - idle, v.iter().sum())
}

/// Closed-loop clients at each concurrency, the mix drawn uniformly, arms alternating level by level.
fn sweep(a: &Args) -> anyhow::Result<()> {
    let data = Arc::new(datasets(a.get("sizes")));
    let arms = arms(a);
    let levels: Vec<usize> = a.get("levels").split(',').map(|l| l.parse().expect("level")).collect();
    let secs = Duration::from_secs(a.or("secs", 5u64));
    let mut out = std::fs::File::create(a.get("out"))?;
    let cells = cells();
    for rep in 0..a.or("reps", 2usize) {
        for (li, &level) in levels.iter().enumerate() {
            for (arm, size, addr) in rotate(&arms, rep + li) {
                let deadline = Instant::now() + secs;
                let cpu0 = cpu_busy();
                let handles: Vec<_> = (0..level)
                    .map(|t| {
                        let (data, addr, token, cells) = (data.clone(), addr.clone(), a.get("token").to_string(), cells.clone());
                        let key = a.get("key").to_string();
                        std::thread::spawn(move || -> Vec<(u64, u64, u64)> {
                            let all = &data.iter().find(|(n, _)| *n == size).expect("size").1;
                            let samples = Samples::new(all, &key);
                            let mut rng = Rng::new((rep * 1000 + t) as u64 + 7);
                            let mut c = Client::connect(&addr, &token).expect("connect");
                            let mut got = Vec::new();
                            while Instant::now() < deadline {
                                let (cell, offset) = cells[rng.below(cells.len())];
                                let (q, s) = samples.draw(cell, offset, &mut rng);
                                let r = c.get(&bench::path(cell, &q, s)).expect("get");
                                got.push((r.client_us, r.db_us, r.app_us));
                            }
                            got
                        })
                    })
                    .collect();
                let all: Vec<(u64, u64, u64)> = handles.into_iter().flat_map(|h| h.join().expect("thread")).collect();
                let cpu1 = cpu_busy();
                let busy = (cpu1.0 - cpu0.0) as f64 / (cpu1.1 - cpu0.1).max(1) as f64;
                let pct = |mut v: Vec<u64>, p: f64| {
                    v.sort_unstable();
                    v.get(((v.len() as f64 * p) as usize).min(v.len().saturating_sub(1))).copied().unwrap_or(0)
                };
                let col = |k: usize| all.iter().map(|t| [t.0, t.1, t.2][k]).collect::<Vec<_>>();
                writeln!(out, "{}", json!({"rep": rep, "arm": arm, "size": size, "concurrency": level,
                    "requests": all.len(), "secs": secs.as_secs(), "cpu_busy": busy,
                    "client_p50": pct(col(0), 0.5), "client_p95": pct(col(0), 0.95),
                    "app_p50": pct(col(2), 0.5), "app_p95": pct(col(2), 0.95),
                    "db_p50": pct(col(1), 0.5), "db_p95": pct(col(1), 0.95)}))?;
                eprintln!("sweep rep {rep} {arm} c={level} n={}", all.len());
            }
        }
    }
    Ok(())
}

/// Every cell's API answer against the brute-force filter; exit 1 on any difference.
fn check(a: &Args) -> anyhow::Result<()> {
    let data = datasets(a.get("sizes"));
    let key = a.get("key").to_string();
    let only: Option<Vec<String>> = a.0.get("cells").map(|c| c.split(',').map(str::to_string).collect());
    let mut bad = 0;
    for (arm, size, addr) in arms(a) {
        let all = &data.iter().find(|(n, _)| *n == size).expect("size").1;
        let visible: Vec<&Study> = all.iter().filter(|s| s.access_key == key).collect();
        let samples = Samples::new(all, &key);
        let mut c = Client::connect(&addr, a.get("token"))?;
        let mut rng = Rng::new(42);
        for (cell, offset) in cells() {
            if only.as_ref().is_some_and(|o| !o.iter().any(|x| x == cell)) {
                continue;
            }
            let (mut checked, mut nonempty) = (0, 0);
            for _ in 0..a.or("queries", 20usize) {
                let (q, s) = samples.draw(cell, offset, &mut rng);
                let tag = if cell == "series" { "0020000E" } else { "0020000D" };
                let got = bench::uids(&c.get(&bench::path(cell, &q, s))?.body, tag);
                let want = bench::expected(&visible, cell, &q, s, std::slice::from_ref(&key));
                checked += 1;
                nonempty += usize::from(!want.is_empty());
                if got != want {
                    bad += 1;
                    eprintln!("MISMATCH {arm} {cell} offset={offset} {}: got {} want {}", q.to_query(), got.len(), want.len());
                }
            }
            println!("{arm} {size} {cell} offset={offset}: {checked} queries, {nonempty} with results");
        }
    }
    println!("{bad} mismatches");
    std::process::exit(i32::from(bad > 0));
}

fn gen_tsv(a: &Args) -> anyhow::Result<()> {
    let studies = gen::studies(a.or("n", 100_000usize), a.or("seed", 1u64));
    let (mut st, mut se) = (String::new(), String::new());
    gen::write_tsv(&studies, &mut st, &mut se);
    std::fs::write(format!("{}.study.tsv", a.get("out")), st)?;
    std::fs::write(format!("{}.series.tsv", a.get("out")), se)?;
    let series: usize = studies.iter().map(|s| s.series.len()).sum();
    println!("{} studies, {series} series", studies.len());
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let (cmd, a) = Args::parse();
    match cmd.as_str() {
        "gen" => gen_tsv(&a),
        "api" => {
            let grants = a
                .pairs("grants")
                .into_iter()
                .map(|(t, keys)| (t, keys.split('+').map(str::to_string).collect()))
                .collect();
            let index = engine::Index::open(a.get("db"))?;
            let state = Arc::new(api::Api { index, grants, tuned: a.or("shape", String::new()) == "tuned" });
            let listener = tokio::net::TcpListener::bind(a.get("listen")).await?;
            axum::serve(listener, api::router(state)).await?;
            Ok(())
        }
        "forward" => forward::run(a.get("a"), a.get("b"), Duration::from_micros(a.or("one-way-us", 0u64))),
        "bench" => tokio::task::block_in_place(|| latency(&a)),
        "sweep" => tokio::task::block_in_place(|| sweep(&a)),
        "check" => tokio::task::block_in_place(|| check(&a)),
        "sync" => sync::run(&a).await,
        "lite-settings" => lite::settings(a.get("db")),
        "lite-load" => lite::load(a.get("tsv"), std::path::Path::new(a.get("out")), a.or("fold", String::from("on")) == "on"),
        _ => anyhow::bail!("usage: study-index gen|lite-load|lite-settings|api|forward|bench|sweep|check|sync --key value … (README §Run)"),
    }
}
