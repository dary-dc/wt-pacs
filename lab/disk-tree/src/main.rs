use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::time::Instant;
use xxhash_rust::xxh3::xxh3_64;

const ALPHABET: &[u8; 64] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";
const STUDIES_PER_DAY: u64 = 1000;
const UNDATED_ONE_IN: u64 = 50;
const UID_ROOT: &str = "1.2.826.0.1.3680043.8.498.";
const SERIES_FILE: &str = "x.sbnd";
const ARMS: [&str; 5] = ["flat", "coded-date", "ymd", "hash1", "hash2"];

/// The PCS's coding of a UID or a date: docs/ingest/contract.md §The layout.
fn code(s: &str) -> String {
    let nib = |c: u8| match c {
        0 => 0,
        b'\\' => 1,
        b'^' => 2,
        b'-' => 3,
        b'+' => 4,
        b'.' => 5,
        b'0'..=b'9' => c - b'0' + 6,
        _ => panic!("not a UID character: {c}"),
    } as usize;
    let a = |i: usize| ALPHABET[i] as char;
    let mut out = String::new();
    for ch in s.as_bytes().chunks(3) {
        let n: Vec<usize> = ch.iter().map(|&c| nib(c)).collect();
        match n.len() {
            3 => {
                let v = n[0] << 8 | n[1] << 4 | n[2];
                out.push(a(v >> 6));
                out.push(a(v & 63));
            }
            2 => {
                out.push(a((n[0] << 2) + (n[1] >> 2)));
                out.push(a((n[1] & 3) << 4));
            }
            _ => {
                out.push(a(n[0] << 2));
                out.push('0');
            }
        }
    }
    out
}

fn civil(day: u64) -> (u64, u64, u64) {
    let z = day as i64 + 19723 + 719468; // day 0 is 2024-01-01
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y as u64, m as u64, d as u64)
}

#[derive(Clone)]
struct Study {
    name: String,
    day: Option<u64>,
}

fn digits(seed: u64, i: u64, len: usize) -> String {
    let mut s = String::with_capacity(len);
    let mut k = 0u64;
    while s.len() < len {
        let h = xxh3_64(&[seed.to_le_bytes(), i.to_le_bytes(), k.to_le_bytes()].concat());
        s.push_str(&format!("{:019}", h % 10_000_000_000_000_000_000));
        k += 1;
    }
    s.truncate(len);
    if s.starts_with('0') {
        s.replace_range(0..1, "1");
    }
    s
}

/// Study `i` of a site that receives `STUDIES_PER_DAY` a day, one in `UNDATED_ONE_IN` without a date.
fn study(seed: u64, i: u64) -> Study {
    let uid = format!("{UID_ROOT}{}", digits(seed, i, 64 - UID_ROOT.len()));
    let undated = xxh3_64(&[seed.to_le_bytes(), i.to_le_bytes()].concat()) % UNDATED_ONE_IN == 0;
    Study { name: code(&uid), day: (!undated).then_some(i / STUDIES_PER_DAY) }
}

fn parent(arm: &str, s: &Study) -> String {
    match arm {
        "flat" => String::new(),
        "coded-date" => match s.day {
            Some(d) => {
                let (y, m, dd) = civil(d);
                format!("{}/", code(&format!("{:02}{m:02}{dd:02}", y % 100)))
            }
            None => "PbPb/".into(),
        },
        "ymd" => match s.day {
            Some(d) => {
                let (y, m, dd) = civil(d);
                format!("{y:04}/{m:02}/{dd:02}/")
            }
            None => "0000/00/00/".into(),
        },
        "hash1" => format!("{:02x}/", xxh3_64(s.name.as_bytes()) & 0xff),
        "hash2" => {
            let h = xxh3_64(s.name.as_bytes());
            format!("{:02x}/{:02x}/", h & 0xff, (h >> 8) & 0xff)
        }
        _ => panic!("no arm {arm}"),
    }
}

fn study_dir(root: &Path, arm: &str, s: &Study) -> PathBuf {
    root.join(format!("{}{}", parent(arm, s), s.name))
}

/// Unit order per round: a Williams square, as lab/order.mjs.
fn williams(n: usize, round: usize) -> Vec<usize> {
    let mut first = vec![0usize];
    let mut k = 1;
    while first.len() < n {
        first.push(k);
        if first.len() < n {
            first.push(n - k);
        }
        k += 1;
    }
    let rows: Vec<Vec<usize>> = (0..n).map(|r| first.iter().map(|u| (u + r) % n).collect()).collect();
    let rows: Vec<Vec<usize>> = if n % 2 == 1 {
        rows.into_iter().flat_map(|r| [r.clone(), r.into_iter().rev().collect()]).collect()
    } else {
        rows
    };
    rows[round % rows.len()].clone()
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn pct(v: &mut [u64], p: f64) -> u64 {
    v.sort_unstable();
    v[((v.len() as f64 - 1.0) * p).round() as usize]
}

fn fsync_dir(p: &Path) {
    File::open(p).and_then(|f| f.sync_all()).unwrap_or_else(|e| panic!("fsync {}: {e}", p.display()));
}

/// Bytes read from every loop device so far: a timed pass that reads none was served from memory.
fn device_reads() -> u64 {
    let stats = fs::read_to_string("/proc/diskstats").unwrap();
    let sectors: u64 = stats
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>())
        .filter(|f| f[2].starts_with("loop"))
        .map(|f| f[5].parse::<u64>().unwrap())
        .sum();
    sectors * 512
}

fn syncfs(p: &Path) {
    let f = File::open(p).unwrap();
    // SAFETY: the descriptor is open for the call's duration.
    assert_eq!(unsafe { libc::syncfs(f.as_raw_fd()) }, 0);
}

struct Args(BTreeMap<String, String>);
impl Args {
    fn get(&self, k: &str) -> &str {
        self.0.get(k).unwrap_or_else(|| panic!("missing {k}="))
    }
    fn num(&self, k: &str) -> u64 {
        self.get(k).parse().unwrap()
    }
    fn or(&self, k: &str, d: u64) -> u64 {
        self.0.get(k).map_or(d, |v| v.parse().unwrap())
    }
    /// `roots=flat:/mnt/a,hash1:/mnt/d`: each arm's mount; its tree is `<mount>/tree`.
    fn roots(&self) -> Vec<(String, PathBuf)> {
        self.get("roots")
            .split(',')
            .map(|r| {
                let (a, p) = r.split_once(':').unwrap();
                assert!(ARMS.contains(&a), "no arm {a}");
                (a.to_string(), PathBuf::from(p))
            })
            .collect()
    }
}

fn row(fields: &[(&str, String)]) {
    let body: Vec<String> = fields.iter().map(|(k, v)| format!("\"{k}\":{v}")).collect();
    println!("{{{}}}", body.join(","));
    std::io::stdout().flush().unwrap();
}

fn q(s: &str) -> String {
    format!("\"{s}\"")
}

fn build(a: &Args) {
    let (arm, mnt) = a.roots().remove(0);
    let (seed, n) = (a.num("seed"), a.num("n"));
    let tree = mnt.join("tree");
    fs::create_dir_all(&tree).unwrap();
    fs::create_dir_all(mnt.join("incoming")).unwrap();
    let mut made = HashSet::new();
    let t = Instant::now();
    for i in 0..n {
        let s = study(seed, i);
        let p = parent(&arm, &s);
        if made.insert(p.clone()) {
            fs::create_dir_all(tree.join(&p)).unwrap();
        }
        let d = tree.join(format!("{p}{}", s.name));
        fs::create_dir(&d).unwrap();
        File::create(d.join(SERIES_FILE)).unwrap();
    }
    syncfs(&tree);
    row(&[("p", q("build")), ("arm", q(&arm)), ("n", n.to_string()), ("s", format!("{:.1}", t.elapsed().as_secs_f64()))]);
}

/// P1: from a study's coded name (and, for a dated arm, its date as the URL would carry it) to an open series file.
fn lookup(a: &Args) {
    let roots = a.roots();
    let (seed, n) = (a.num("seed"), a.num("n"));
    let (sample_n, rounds, per) = (a.or("sample", 100_000).min(n), a.or("rounds", 10), a.or("per", 20_000));
    let mut rng = Rng(seed ^ 0x1);
    let sample: Vec<Study> = (0..sample_n).map(|_| study(seed, rng.below(n))).collect();
    for (arm, mnt) in &roots {
        for s in &sample {
            File::open(study_dir(&mnt.join("tree"), arm, s).join(SERIES_FILE)).unwrap();
        }
    }
    let mut lat: Vec<Vec<u64>> = vec![Vec::new(); roots.len()];
    let mut read = vec![0u64; roots.len()];
    for r in 0..rounds as usize {
        for ai in williams(roots.len(), r) {
            let (arm, mnt) = &roots[ai];
            let tree = mnt.join("tree");
            let mut pick = Rng(seed ^ (r as u64) << 8);
            let before = device_reads();
            for _ in 0..per {
                let s = &sample[pick.below(sample_n) as usize];
                let t = Instant::now();
                let f = File::open(study_dir(&tree, arm, s).join(SERIES_FILE)).unwrap();
                lat[ai].push(t.elapsed().as_nanos() as u64);
                drop(f);
            }
            read[ai] += device_reads() - before;
        }
    }
    for (ai, (arm, _)) in roots.iter().enumerate() {
        let v = &mut lat[ai];
        row(&[
            ("p", q("lookup")),
            ("arm", q(arm)),
            ("n", n.to_string()),
            ("sample", sample_n.to_string()),
            ("ops", v.len().to_string()),
            ("p50_ns", pct(v, 0.5).to_string()),
            ("p99_ns", pct(v, 0.99).to_string()),
            ("read_bytes", read[ai].to_string()),
        ]);
    }
}

fn walk(dir: &Path) -> u64 {
    let mut n = 0;
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        let m = fs::symlink_metadata(&p).unwrap();
        n += 1;
        if m.is_dir() {
            n += walk(&p);
        }
    }
    n
}

/// P4: every entry listed and `lstat`ed, as a file-level backup; the second of two back-to-back walks is timed.
fn scan(a: &Args) {
    let roots = a.roots();
    for r in 0..a.or("rounds", 5) as usize {
        for ai in williams(roots.len(), r) {
            let (arm, mnt) = &roots[ai];
            let tree = mnt.join("tree");
            walk(&tree);
            let before = device_reads();
            let t = Instant::now();
            let entries = walk(&tree);
            let ns = t.elapsed().as_nanos() as u64;
            let read = device_reads() - before;
            row(&[
                ("p", q("scan")),
                ("arm", q(arm)),
                ("round", r.to_string()),
                ("entries", entries.to_string()),
                ("s", format!("{:.3}", ns as f64 / 1e9)),
                ("ns_per_entry", (ns / entries).to_string()),
                ("read_mb", (read >> 20).to_string()),
            ]);
        }
    }
}

/// Lists every directory down to `depth` levels below `dir`: the warm-up before an operation that writes there.
fn list_dirs(dir: &Path, depth: usize) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd {
        let p = e.unwrap().path();
        if depth > 0 {
            list_dirs(&p, depth - 1);
        }
    }
}

/// Reads a study's directory entry, inode and contents: the warm-up before moving or removing it.
fn touch_study(p: &Path) {
    fs::symlink_metadata(p).unwrap();
    fs::read_dir(p).unwrap().for_each(|e| drop(e.unwrap().metadata()));
}

fn parent_depth(arm: &str) -> usize {
    match arm {
        "flat" => 0,
        "coded-date" | "hash1" => 1,
        "hash2" => 2,
        _ => 3,
    }
}

fn publish_one(arm: &str, mnt: &Path, s: &Study, buf: &[u8]) -> (u64, u64) {
    let t0 = Instant::now();
    let staging = mnt.join("incoming").join(&s.name);
    fs::create_dir(&staging).unwrap();
    let mut f = File::create(staging.join(SERIES_FILE)).unwrap();
    f.write_all(buf).unwrap();
    f.sync_all().unwrap();
    fsync_dir(&staging);
    let dest = study_dir(&mnt.join("tree"), arm, s);
    let dest_parent = dest.parent().unwrap();
    fs::create_dir_all(dest_parent).unwrap();
    let t1 = Instant::now();
    fs::rename(&staging, &dest).unwrap();
    let rename = t1.elapsed().as_nanos() as u64;
    fsync_dir(dest_parent);
    (t0.elapsed().as_nanos() as u64, rename)
}

/// P3: k writers, each publishing new studies of the next day by staging, `fsync`, `rename`, `fsync` of the parent.
fn publish(a: &Args) {
    let roots = a.roots();
    let (seed, n, per) = (a.num("seed"), a.num("n"), a.or("per", 100));
    let ks: Vec<usize> = a.get("ks").split(',').map(|k| k.parse().unwrap()).collect();
    let buf = vec![0x5au8; 4096];
    let mut next = n.div_ceil(STUDIES_PER_DAY) * STUDIES_PER_DAY;
    let mut lat: BTreeMap<(usize, usize), (Vec<u64>, Vec<u64>, u64)> = BTreeMap::new();
    for r in 0..a.or("rounds", 4) as usize {
        for ki in williams(ks.len(), r) {
            let k = ks[ki];
            let studies: Vec<Vec<Study>> = (0..k)
                .map(|w| (0..per).map(|j| study(seed, next + w as u64 * per + j)).collect())
                .collect();
            next += k as u64 * per;
            for ai in williams(roots.len(), r) {
                let (arm, mnt) = &roots[ai];
                list_dirs(&mnt.join("tree"), parent_depth(arm));
                let before = device_reads();
                let got: Vec<Vec<(u64, u64)>> = std::thread::scope(|sc| {
                    let hs: Vec<_> = studies
                        .iter()
                        .map(|ws| sc.spawn(|| ws.iter().map(|s| publish_one(arm, mnt, s, &buf)).collect()))
                        .collect();
                    hs.into_iter().map(|h| h.join().unwrap()).collect()
                });
                let e = lat.entry((ai, k)).or_default();
                e.2 += device_reads() - before;
                for (total, rename) in got.into_iter().flatten() {
                    e.0.push(total);
                    e.1.push(rename);
                }
            }
        }
    }
    for ((ai, k), (mut total, mut rename, read)) in lat {
        row(&[
            ("p", q("publish")),
            ("arm", q(&roots[ai].0)),
            ("n", n.to_string()),
            ("k", k.to_string()),
            ("ops", total.len().to_string()),
            ("p50_us", (pct(&mut total, 0.5) / 1000).to_string()),
            ("p99_us", (pct(&mut total, 0.99) / 1000).to_string()),
            ("rename_p50_us", format!("{:.1}", pct(&mut rename, 0.5) as f64 / 1e3)),
            ("rename_p99_us", format!("{:.1}", pct(&mut rename, 0.99) as f64 / 1e3)),
            ("read_bytes", read.to_string()),
        ]);
    }
}

/// Deletion by age: the oldest `days` days. Hashed and flat arms take the day's studies from the catalog
/// (here the generator; the query is not timed); dated arms list the day's folder and remove it.
fn delete(a: &Args) {
    let roots = a.roots();
    let (seed, n, days) = (a.num("seed"), a.num("n"), a.num("days"));
    let mut lat: Vec<(u64, u64)> = vec![(0, 0); roots.len()];
    let mut read = vec![0u64; roots.len()];
    for d in 0..days {
        let catalog: Vec<Study> = (d * STUDIES_PER_DAY..((d + 1) * STUDIES_PER_DAY).min(n))
            .map(|i| study(seed, i))
            .filter(|s| s.day == Some(d))
            .collect();
        for ai in williams(roots.len(), d as usize) {
            let (arm, mnt) = &roots[ai];
            let tree = mnt.join("tree");
            catalog.iter().for_each(|s| touch_study(&study_dir(&tree, arm, s)));
            let before = device_reads();
            let t = Instant::now();
            let removed = if matches!(arm.as_str(), "coded-date" | "ymd") {
                let folder = study_dir(&tree, arm, &catalog[0]).parent().unwrap().to_path_buf();
                let mut c = 0;
                for e in fs::read_dir(&folder).unwrap() {
                    let p = e.unwrap().path();
                    fs::remove_file(p.join(SERIES_FILE)).unwrap();
                    fs::remove_dir(&p).unwrap();
                    c += 1;
                }
                fs::remove_dir(&folder).unwrap();
                if arm == "ymd" {
                    let _ = fs::remove_dir(folder.parent().unwrap());
                }
                c
            } else {
                for s in &catalog {
                    let p = study_dir(&tree, arm, s);
                    fs::remove_file(p.join(SERIES_FILE)).unwrap();
                    fs::remove_dir(&p).unwrap();
                }
                catalog.len() as u64
            };
            lat[ai].0 += t.elapsed().as_nanos() as u64;
            lat[ai].1 += removed;
            read[ai] += device_reads() - before;
        }
    }
    let mut sync = vec![0u64; roots.len()];
    for ai in williams(roots.len(), 0) {
        let t = Instant::now();
        syncfs(&roots[ai].1);
        sync[ai] = t.elapsed().as_nanos() as u64;
    }
    for (ai, (arm, _)) in roots.iter().enumerate() {
        row(&[
            ("p", q("delete")),
            ("arm", q(arm)),
            ("n", n.to_string()),
            ("studies", lat[ai].1.to_string()),
            ("us_per_study", format!("{:.1}", lat[ai].0 as f64 / lat[ai].1 as f64 / 1e3)),
            ("syncfs_ms", (sync[ai] / 1_000_000).to_string()),
            ("read_bytes", read[ai].to_string()),
        ]);
    }
}

/// A corrected study date: dated arms move the study and `fsync` both parents; the old path then fails.
fn correct(a: &Args) {
    let roots = a.roots();
    let (seed, n, count, from_day) = (a.num("seed"), a.num("n"), a.or("count", 500), a.num("from_day"));
    let last_day = (n - 1) / STUDIES_PER_DAY;
    assert!(last_day > from_day, "no other day to correct to");
    let mut rng = Rng(seed ^ 0x2);
    let mut picks = Vec::new();
    let mut seen = HashSet::new();
    while picks.len() < count as usize {
        let i = from_day * STUDIES_PER_DAY + rng.below(n - from_day * STUDIES_PER_DAY);
        let s = study(seed, i);
        if let Some(d) = s.day {
            let nd = from_day + rng.below(last_day - from_day + 1);
            if nd != d && seen.insert(s.name.clone()) {
                picks.push((s.clone(), Study { name: s.name, day: Some(nd) }));
            }
        }
    }
    let rounds = a.or("rounds", 10) as usize;
    let mut lat: Vec<Vec<u64>> = vec![Vec::new(); roots.len()];
    let mut broken = vec![0u64; roots.len()];
    let mut read = vec![0u64; roots.len()];
    for (r, chunk) in picks.chunks(picks.len().div_ceil(rounds)).enumerate() {
        for ai in williams(roots.len(), r) {
            let (arm, mnt) = &roots[ai];
            let tree = mnt.join("tree");
            for (old, new) in chunk {
                let (from, to) = (study_dir(&tree, arm, old), study_dir(&tree, arm, new));
                if from == to {
                    continue;
                }
                touch_study(&from);
                list_dirs(to.parent().unwrap(), 0);
                let before = device_reads();
                let t = Instant::now();
                fs::create_dir_all(to.parent().unwrap()).unwrap();
                fs::rename(&from, &to).unwrap();
                fsync_dir(from.parent().unwrap());
                fsync_dir(to.parent().unwrap());
                lat[ai].push(t.elapsed().as_nanos() as u64);
                read[ai] += device_reads() - before;
                if File::open(from.join(SERIES_FILE)).is_err() {
                    broken[ai] += 1;
                }
            }
        }
    }
    for (ai, (arm, _)) in roots.iter().enumerate() {
        let v = &mut lat[ai];
        let (p50, p99) = if v.is_empty() { (0, 0) } else { (pct(v, 0.5), pct(v, 0.99)) };
        row(&[
            ("p", q("correct")),
            ("arm", q(arm)),
            ("n", n.to_string()),
            ("corrected", count.to_string()),
            ("moved", v.len().to_string()),
            ("old_path_gone", broken[ai].to_string()),
            ("read_bytes", read[ai].to_string()),
            ("p50_us", (p50 / 1000).to_string()),
            ("p99_us", (p99 / 1000).to_string()),
        ]);
    }
}

/// P2: entries in one directory until the filesystem refuses. `kind=link` adds hard links (an htree entry is the
/// same for a link as for a subdirectory, and costs no inode or block); `kind=dir` adds subdirectories.
fn ceiling(a: &Args) {
    let dir = PathBuf::from(a.get("dir"));
    let (len, limit, seed) = (a.num("len"), a.or("limit", u64::MAX), a.or("seed", 7));
    let link = a.get("kind") == "link";
    fs::create_dir_all(&dir).unwrap();
    let base = dir.parent().unwrap().join("base");
    fs::create_dir_all(&base).unwrap();
    let per_base = 60_000;
    let t = Instant::now();
    let mut lap = Instant::now();
    let mut i = 0u64;
    let uid = |i: u64| match len {
        44 => format!("{UID_ROOT}{}", digits(seed, i, 64 - UID_ROOT.len())),
        30 => format!("2.25.{}", digits(seed, i, 39)),
        _ => panic!("len is 30 or 44"),
    };
    let err = loop {
        if i == limit {
            break None;
        }
        let name = dir.join(code(&uid(i)));
        let res = if link {
            let b = base.join((i / per_base).to_string());
            if i % per_base == 0 {
                File::create(&b).unwrap();
            }
            fs::hard_link(&b, &name)
        } else {
            fs::create_dir(&name)
        };
        if let Err(e) = res {
            break Some(e);
        }
        i += 1;
        if i % 1_000_000 == 0 {
            row(&[("p", q("ceiling")), ("entries", i.to_string()), ("ns_per_entry", (lap.elapsed().as_nanos() / 1_000_000).to_string())]);
            lap = Instant::now();
        }
    };
    let what = match &err {
        None => "limit".to_string(),
        Some(e) if e.kind() == ErrorKind::StorageFull => "ENOSPC".into(),
        Some(e) => format!("{e}"),
    };
    row(&[
        ("p", q("ceiling")),
        ("kind", q(a.get("kind"))),
        ("name_len", code(&uid(0)).len().to_string()),
        ("entries", i.to_string()),
        ("stopped", q(&what)),
        ("s", format!("{:.0}", t.elapsed().as_secs_f64())),
    ]);
}

fn main() {
    let mut argv = std::env::args().skip(1);
    let cmd = argv.next().expect("build|lookup|scan|publish|delete|correct|ceiling key=value…");
    let a = Args(argv.map(|kv| kv.split_once('=').map(|(k, v)| (k.into(), v.into())).unwrap()).collect());
    match cmd.as_str() {
        "build" => build(&a),
        "lookup" => lookup(&a),
        "scan" => scan(&a),
        "publish" => publish(&a),
        "delete" => delete(&a),
        "correct" => correct(&a),
        "ceiling" => ceiling(&a),
        _ => panic!("no command {cmd}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The coding matches contract.md's worked example and its stated lengths.
    #[test]
    fn coding() {
        assert_eq!(code("1.2.3\0"), "TOMG");
        assert_eq!(study(1, 0).name.len(), 44);
        assert_eq!(code(&format!("2.25.{}", digits(1, 0, 39))).len(), 30);
        assert_eq!(code("261025").len(), 4);
    }

    /// Day 0 is 2024-01-01 and the leap day is kept.
    #[test]
    fn dates() {
        assert_eq!(civil(0), (2024, 1, 1));
        assert_eq!(civil(59), (2024, 2, 29));
        assert_eq!(civil(366), (2025, 1, 1));
    }

    /// Each arm places a study where the ADR's §1 table says.
    #[test]
    fn paths() {
        let s = Study { name: "S".into(), day: Some(0) };
        let u = Study { name: "S".into(), day: None };
        assert_eq!(parent("flat", &s), "");
        assert_eq!(parent("ymd", &s), "2024/01/01/");
        assert_eq!(parent("ymd", &u), "0000/00/00/");
        assert_eq!(parent("coded-date", &s), format!("{}/", code("240101")));
        assert_eq!(parent("coded-date", &u), "PbPb/");
        assert_eq!(parent("hash1", &s).len(), 3);
        assert_eq!(parent("hash2", &s).len(), 6);
    }

    /// Over a period every unit sits at every position equally often, and follows every other equally often.
    #[test]
    fn williams_balances() {
        for n in [2, 4, 5] {
            let period = if n % 2 == 1 { 2 * n } else { n };
            let mut at = vec![vec![0; n]; n];
            let mut after = vec![vec![0; n]; n];
            for r in 0..period {
                let o = williams(n, r);
                for (pos, &u) in o.iter().enumerate() {
                    at[u][pos] += 1;
                }
                for w in o.windows(2) {
                    after[w[0]][w[1]] += 1;
                }
            }
            assert!(at.iter().flatten().all(|&c| c == at[0][0]));
            let off: Vec<i32> = (0..n * n).filter(|i| i / n != i % n).map(|i| after[i / n][i % n]).collect();
            assert!(off.iter().all(|&c| c == off[0]), "n={n}: {after:?}");
        }
    }
}
