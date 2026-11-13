//! An addition's frames merged into its series' bundle, in display order: docs/adr/pacs-receiver.md §5.

use crate::group;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Map, Value};
use series_bundle::{read_layout, BundleWriter, ParsedLayout};
use std::collections::HashSet;
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::path::Path;

/// An instance by its coded UID and its group's bytes.
pub type Instance<'a> = (&'a str, &'a [u8]);

/// Instance Number, then the coded UID; an instance without a number after every numbered one.
fn in_display_order<'a>(
    instances: impl Iterator<Item = Instance<'a>>,
) -> Result<Vec<Instance<'a>>> {
    let mut keyed = instances
        .map(|i| Ok((group::instance_number(i.1)?, i)))
        .collect::<Result<Vec<_>>>()?;
    keyed.sort_by_key(|&(number, (uid, _))| (number.is_none(), number, uid));
    Ok(keyed.into_iter().map(|(_, i)| i).collect())
}

fn frames(instances: &[Instance]) -> Result<u64> {
    instances.iter().try_fold(0, |sum, (_, bytes)| {
        Ok(sum + u64::from(group::number_of_frames(bytes)?))
    })
}

/// A bundle's frames read in index order, one instance's run at a time.
struct Frames {
    file: File,
    layout: ParsedLayout,
    next: usize,
}

impl Frames {
    fn open(path: &Path) -> Result<Self> {
        let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
        let layout = read_layout(&file).with_context(|| format!("{}", path.display()))?;
        Ok(Self {
            file,
            layout,
            next: 0,
        })
    }

    fn metadata(&self) -> Result<Map<String, Value>> {
        match serde_json::from_str(&self.layout.metadata).context("a bundle's metadata")? {
            Value::Object(map) => Ok(map),
            _ => anyhow::bail!("a bundle's metadata is not a JSON object"),
        }
    }

    /// The indexes of the next `n` frames.
    fn take(&mut self, n: u32) -> std::ops::Range<usize> {
        let run = self.next..self.next + n as usize;
        self.next = run.end;
        run
    }

    fn read(&self, frame: usize) -> Result<Vec<u8>> {
        let (offset, length) = self.layout.index[frame];
        let mut bytes = vec![0u8; length as usize];
        self.file.read_exact_at(&mut bytes, offset)?;
        Ok(bytes)
    }
}

/// Writes `to`: every frame of `served` and of `addition`, in the display order of `kept` and
/// `added`; `addition` must hold `added`'s frames. A `served` already holding `added` (a restart
/// after step 6c) gives the same file.
pub fn merge(
    served: &Path,
    kept: &[Instance],
    addition: &Path,
    added: &[Instance],
    to: &Path,
) -> Result<()> {
    let (mut old, mut new) = (Frames::open(served)?, Frames::open(addition)?);
    let added_uids: HashSet<&str> = added.iter().map(|a| a.0).collect();
    let all = in_display_order(kept.iter().chain(added).copied())?;
    let (served_frames, added_frames) = (old.layout.index.len() as u64, frames(added)?);
    let merged_before = served_frames == frames(kept)? + added_frames;
    ensure!(
        merged_before || served_frames == frames(kept)?,
        "the served bundle holds {served_frames} frames, its {} instances {}",
        kept.len(),
        frames(kept)?
    );

    let mut order = Vec::new();
    for &(uid, bytes) in &all {
        let n = group::number_of_frames(bytes)?;
        let is_added = added_uids.contains(uid);
        if is_added && merged_before {
            old.take(n);
        }
        order.push(match is_added {
            true => (true, new.take(n)),
            false => (false, old.take(n)),
        });
    }
    let metadata = merged_metadata(&old, &new, &order)?;
    let mut lengths = Vec::new();
    for (is_added, run) in &order {
        let source = if *is_added { &new } else { &old };
        lengths.extend(run.clone().map(|f| source.layout.index[f].1));
    }
    let mut writer = BundleWriter::create(to, &metadata, &lengths)?;
    for (is_added, run) in &order {
        let source = if *is_added { &new } else { &old };
        for frame in run.clone() {
            writer.write_frame(&source.read(frame)?)?;
        }
    }
    writer.finish()?;
    File::open(to)?
        .sync_all()
        .with_context(|| format!("fsync {}", to.display()))
}

/// The served bundle's metadata with the count, the range and the frame digests of both; every
/// other key must be the same in both.
fn merged_metadata(
    old: &Frames,
    new: &Frames,
    order: &[(bool, std::ops::Range<usize>)],
) -> Result<Vec<u8>> {
    let (mut merged, added) = (old.metadata()?, new.metadata()?);
    for (key, value) in &added {
        if !matches!(key.as_str(), "frameCount" | "min" | "max" | "digests") {
            ensure!(
                merged.get(key) == Some(value),
                "the addition's {key} is {value}, the series' {:?}",
                merged.get(key)
            );
        }
    }
    let total: usize = order.iter().map(|(_, run)| run.len()).sum();
    merged.insert("frameCount".into(), json!(total));
    for (key, pick) in [("min", i64::min as fn(i64, i64) -> i64), ("max", i64::max)] {
        if let (Some(a), Some(b)) = (merged.get(key), added.get(key)) {
            let (a, b) = (a.as_i64(), b.as_i64());
            let (a, b) = a
                .zip(b)
                .with_context(|| format!("{key} is not an integer"))?;
            merged.insert(key.into(), json!(pick(a, b)));
        }
    }
    let digests = |m: &Map<String, Value>| m.get("digests").cloned();
    if let Some(old_digests) = digests(&merged) {
        let new_digests = digests(&added).context("the addition's bundle has no digests")?;
        ensure!(
            old_digests["algorithm"] == new_digests["algorithm"],
            "the addition's digests are another algorithm"
        );
        let list = |d: &Value, n: usize| -> Result<Vec<Value>> {
            let list = d["frames"].as_array().context("digests without frames")?;
            ensure!(list.len() == n, "{} digests for {n} frames", list.len());
            Ok(list.clone())
        };
        let old_list = list(&old_digests, old.layout.index.len())?;
        let new_list = list(&new_digests, new.layout.index.len())?;
        let frames: Vec<Value> = order
            .iter()
            .flat_map(|(is_added, run)| {
                let source = if *is_added { &new_list } else { &old_list };
                source[run.clone()].to_vec()
            })
            .collect();
        merged.insert(
            "digests".into(),
            json!({ "algorithm": old_digests["algorithm"], "frames": frames }),
        );
    }
    Ok(serde_json::to_vec(&Value::Object(merged))?)
}
