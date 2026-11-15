//! Times what a page open reads from each of four metadata stores: lab/metadata-store/README.md.

mod group;
mod pair;
mod pair_run;
mod revision;
mod stores;
#[cfg(feature = "study-db")]
mod study_db;
#[cfg(test)]
mod tests;
mod update_cost;

use anyhow::{ensure, Context, Result};
use group::PageValues;
use std::path::PathBuf;
use std::time::Instant;
use stores::{KeyFile, Paths};

struct Args {
    dir: PathBuf,
    instances: Vec<u16>,
    rounds: usize,
    mode: String,
    updates: usize,
    packages: PathBuf,
    builds: usize,
}

fn args() -> Result<Args> {
    let mut a = Args {
        dir: PathBuf::from("target/metadata-store"),
        instances: vec![4, 200, 2000],
        rounds: 200,
        mode: "stores".into(),
        updates: 60,
        packages: PathBuf::new(),
        builds: 30,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let value = it.next().with_context(|| format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--dir" => a.dir = value.into(),
            "--instances" => {
                a.instances = value.split(',').map(str::parse).collect::<Result<_, _>>()?
            }
            "--rounds" => a.rounds = value.parse()?,
            "--updates" => a.updates = value.parse()?,
            "--mode" => a.mode = value,
            "--packages" => a.packages = value.into(),
            "--builds" => a.builds = value.parse()?,
            _ => anyhow::bail!(
                "unknown flag {flag}: --dir, --instances, --rounds, --mode pair|pair-followup|update-cost|study-db|ce-ratio, \
                 --updates, --packages, --builds"
            ),
        }
    }
    Ok(a)
}

type Read<'a> = Box<dyn Fn() -> Result<Vec<PageValues>> + 'a>;

fn variants<'a>(
    paths: &'a Paths,
    columns: &'a rusqlite::Connection,
    rows: &'a rusqlite::Connection,
    keys: &'a KeyFile,
) -> Vec<(&'static str, Read<'a>)> {
    vec![
        ("A files", Box::new(|| stores::read_files(&paths.files))),
        (
            "B columns, opened",
            Box::new(|| stores::read_columns(&stores::open(&paths.columns)?)),
        ),
        (
            "B columns, held",
            Box::new(|| stores::read_columns(columns)),
        ),
        (
            "C rows scan, opened",
            Box::new(|| stores::read_rows_scan(&stores::open(&paths.rows)?)),
        ),
        (
            "C rows scan, held",
            Box::new(|| stores::read_rows_scan(rows)),
        ),
        (
            "C rows filter, opened",
            Box::new(|| stores::read_rows_filter(&stores::open(&paths.rows)?)),
        ),
        (
            "C rows filter, held",
            Box::new(|| stores::read_rows_filter(rows)),
        ),
        (
            "C rows seek, opened",
            Box::new(|| stores::read_rows_seek(&stores::open(&paths.rows)?)),
        ),
        (
            "C rows seek, held",
            Box::new(|| stores::read_rows_seek(rows)),
        ),
        (
            "D keys scan, opened",
            Box::new(|| Ok(KeyFile::open(&paths.keys, &paths.values)?.read_scan())),
        ),
        ("D keys scan, held", Box::new(|| Ok(keys.read_scan()))),
        (
            "D keys seek, opened",
            Box::new(|| Ok(KeyFile::open(&paths.keys, &paths.values)?.read_seek())),
        ),
        ("D keys seek, held", Box::new(|| Ok(keys.read_seek()))),
    ]
}

fn quantile(sorted: &[f64], q: f64) -> f64 {
    sorted[((sorted.len() - 1) as f64 * q).round() as usize]
}

fn main() -> Result<()> {
    let argv: Vec<String> = std::env::args().collect();
    if let [_, flag, db, a, b, stop, intervals, core] = argv.as_slice() {
        if flag == "--reader" {
            if let Ok(core) = core.parse() {
                pair::pin(core)?;
            }
            let valid = [std::fs::read(a)?, std::fs::read(b)?];
            println!("{}", pair::reader(db.as_ref(), &valid, stop.as_ref(), intervals.as_ref())?);
            return Ok(());
        }
    }
    if let [_, flag, model, how, store, a, b, stop, intervals, core] = argv.as_slice() {
        if flag == "--reader-of" {
            pair::pin(core.parse()?)?;
            let valid = [std::fs::read(a)?, std::fs::read(b)?];
            let report = update_cost::reader(model, how, store.as_ref(), &valid, stop.as_ref(), intervals.as_ref())?;
            println!("{report}");
            return Ok(());
        }
    }
    if let [_, flag, model, store, target, updates] = argv.as_slice() {
        if flag == "--update-child" {
            return update_cost::update_child(model, store.as_ref(), target.parse()?, updates.parse()?);
        }
    }
    let a = args()?;
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures");
    let series = group::parse(&std::fs::read(fixtures.join("ct1-series.grp"))?)?;
    let template = group::parse(&std::fs::read(fixtures.join("ct1-instance.grp"))?)?;
    match a.mode.as_str() {
        "pair" => return pair_run::run(&a.dir, &series, &template, &a.instances, a.rounds, a.updates),
        "pair-followup" => return pair_run::followup(&a.dir, &series, &template, &a.instances, a.updates),
        "update-cost" => return update_cost::run(&a.dir, &series, &template, &a.instances, a.updates),
        #[cfg(feature = "study-db")]
        "study-db" => return study_db::run::run(&a.packages, &a.dir, a.rounds, a.builds, a.updates),
        #[cfg(feature = "study-db")]
        "ce-ratio" => return study_db::ratio::run(&a.packages, a.rounds),
        _ => {}
    }
    for &n in &a.instances {
        let dir = a.dir.join(format!("n{n}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        let paths = Paths::under(&dir);
        let instances = group::synthetic_series(&template, n);
        stores::build(&paths, &series, &instances)?;

        let (columns, rows) = (stores::open(&paths.columns)?, stores::open(&paths.rows)?);
        let keys = KeyFile::open(&paths.keys, &paths.values)?;
        for (i, records) in instances.iter().enumerate() {
            ensure!(
                stores::group_from_rows(&rows, i as u16 + 1)? == group::write(records),
                "instance {}: rows do not give the group back",
                i + 1
            );
        }
        let vs = variants(&paths, &columns, &rows, &keys);
        let truth: Vec<PageValues> = instances
            .iter()
            .map(|r| group::page_values(r.iter().map(|r| (r.tag(), r.value.clone()))))
            .collect();
        for (name, read) in &vs {
            ensure!(
                read()? == truth,
                "{name} read a different page for {n} instances"
            );
        }

        let mut times = vec![Vec::with_capacity(a.rounds); vs.len()];
        for round in 0..a.rounds {
            for k in 0..vs.len() {
                let v = (round + k) % vs.len();
                let t = Instant::now();
                std::hint::black_box(vs[v].1()?);
                times[v].push(t.elapsed().as_secs_f64() * 1e6);
            }
        }
        let sizes = stores::on_disk(&paths)?;
        for ((name, _), mut t) in vs.iter().zip(times) {
            t.sort_by(f64::total_cmp);
            let row = serde_json::json!({"instances": n, "variant": name, "rounds": a.rounds,
                "us_p10": quantile(&t, 0.1), "us_median": quantile(&t, 0.5), "us_p90": quantile(&t, 0.9)});
            println!("{row}");
        }
        println!("{}", serde_json::json!({"instances": n, "on_disk": sizes}));
    }
    Ok(())
}
