//! Times what a page open reads from each of four metadata stores: lab/metadata-store/README.md.

mod group;
mod stores;
#[cfg(test)]
mod tests;

use anyhow::{ensure, Context, Result};
use group::PageValues;
use std::path::PathBuf;
use std::time::Instant;
use stores::{KeyFile, Paths};

struct Args {
    dir: PathBuf,
    instances: Vec<u16>,
    rounds: usize,
}

fn args() -> Result<Args> {
    let mut a = Args {
        dir: PathBuf::from("target/metadata-store"),
        instances: vec![4, 200, 2000],
        rounds: 200,
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
            _ => anyhow::bail!("unknown flag {flag}: --dir, --instances, --rounds"),
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
    let a = args()?;
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures");
    let series = group::parse(&std::fs::read(fixtures.join("ct1-series.grp"))?)?;
    let template = group::parse(&std::fs::read(fixtures.join("ct1-instance.grp"))?)?;
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
