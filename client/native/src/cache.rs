//! Frames whose check passed, as their coded bytes, one file per frame under `root/series/version/`.
//! `docs/native/README.md` §8.4, `docs/adr/exactness-in-production.md` §8 *A client cache*.

use crate::verify::Exact;
use anyhow::{ensure, Context, Result};
use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::PathBuf;

pub struct Cache {
    dir: PathBuf,
}

impl Cache {
    /// `series` and `version` are the key with the frame's index, never a digest; each is one path component.
    pub fn open(root: impl Into<PathBuf>, series: &str, version: &str) -> Result<Self> {
        for part in [series, version] {
            ensure!(!part.is_empty() && part != "." && part != ".." && !part.contains(['/', '\\']), "{part:?} is not a cache key");
        }
        let dir = root.into().join(series).join(version);
        fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
        Ok(Self { dir })
    }

    /// Stores `coded` only when its check is `true`; a crash leaves the frame absent or whole, never torn.
    pub fn put(&self, index: u32, coded: &[u8], exact: &Exact) -> Result<bool> {
        if *exact != Exact::True {
            return Ok(false);
        }
        let (part, path) = (self.dir.join(format!("{index}.part")), self.dir.join(index.to_string()));
        let mut file = File::create(&part)?;
        file.write_all(coded)?;
        file.sync_all()?;
        fs::rename(&part, &path)?;
        // The rename is durable only once the directory is: `docs/native/README.md` §3.
        File::open(&self.dir)?.sync_all()?;
        Ok(true)
    }

    /// The frame through `check`, which hands back its samples when they pass; an entry that fails is removed.
    pub fn get<T>(&self, index: u32, check: impl FnOnce(&[u8]) -> Option<T>) -> Result<Option<T>> {
        let path = self.dir.join(index.to_string());
        let coded = match fs::read(&path) {
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            coded => coded?,
        };
        let checked = check(&coded);
        if checked.is_none() {
            fs::remove_file(&path)?;
        }
        Ok(checked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("native-cache-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn frame(index: u32, len: usize) -> Vec<u8> {
        vec![index as u8; len]
    }

    fn same(want: Vec<u8>) -> impl FnOnce(&[u8]) -> Option<Vec<u8>> {
        move |got| (got == want).then(|| got.to_vec())
    }

    /// A frame checked `true` comes back through its check; `false` and `unchecked` frames are never stored, and a
    /// frame never stored is absent rather than an error.
    #[test]
    fn only_a_true_frame_is_stored_and_read_back() {
        let cache = Cache::open(scratch("true"), "series", "v1").unwrap();
        assert!(cache.put(0, &frame(0, 4096), &Exact::True).unwrap());
        assert!(!cache.put(1, &frame(1, 4096), &Exact::False).unwrap());
        assert!(!cache.put(2, &frame(2, 4096), &Exact::Unchecked).unwrap());
        assert_eq!(cache.get(0, same(frame(0, 4096))).unwrap(), Some(frame(0, 4096)));
        assert_eq!(cache.get(1, same(frame(1, 4096))).unwrap(), None);
        assert_eq!(cache.get(2, same(frame(2, 4096))).unwrap(), None);
        assert_eq!(cache.get(3, same(frame(3, 4096))).unwrap(), None);
    }

    /// A byte flipped on disk fails the check on read: the frame is refused, its entry removed, and a fresh copy
    /// stored after it reads back.
    #[test]
    fn a_flipped_byte_is_refused_and_its_entry_removed() {
        let root = scratch("flip");
        let cache = Cache::open(&root, "series", "v1").unwrap();
        cache.put(7, &frame(7, 4096), &Exact::True).unwrap();
        let path = root.join("series/v1/7");
        let mut bytes = fs::read(&path).unwrap();
        bytes[2048] ^= 0x10;
        fs::write(&path, bytes).unwrap();
        assert_eq!(cache.get(7, same(frame(7, 4096))).unwrap(), None);
        assert!(!path.exists());
        cache.put(7, &frame(7, 4096), &Exact::True).unwrap();
        assert_eq!(cache.get(7, same(frame(7, 4096))).unwrap(), Some(frame(7, 4096)));
    }

    /// The key is series, version and index: another version or series of the same index is absent, and a key
    /// that would leave the cache's directory is refused.
    #[test]
    fn the_key_is_series_version_and_index() {
        let root = scratch("key");
        Cache::open(&root, "series", "v1").unwrap().put(0, &frame(0, 64), &Exact::True).unwrap();
        assert_eq!(Cache::open(&root, "series", "v2").unwrap().get(0, same(frame(0, 64))).unwrap(), None);
        assert_eq!(Cache::open(&root, "other", "v1").unwrap().get(0, same(frame(0, 64))).unwrap(), None);
        for bad in ["", ".", "..", "a/b", "a\\b"] {
            assert!(Cache::open(&root, bad, "v1").is_err(), "{bad:?}");
            assert!(Cache::open(&root, "series", bad).is_err(), "{bad:?}");
        }
    }

    const FRAMES: u32 = 100;
    const FRAME_LEN: usize = 701 << 10;

    /// Not a claim: the writer the kill test runs as a child and kills.
    #[test]
    #[ignore]
    fn kill_child_writes_frames() {
        let Some(root) = std::env::var_os("NATIVE_CACHE_KILL_ROOT") else { return };
        let cache = Cache::open(root, "series", "v1").unwrap();
        for index in 0..FRAMES {
            cache.put(index, &frame(index, FRAME_LEN), &Exact::True).unwrap();
        }
    }

    fn writer(root: &std::path::Path) -> std::process::Child {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "cache::tests::kill_child_writes_frames", "--ignored", "--quiet"])
            .env("NATIVE_CACHE_KILL_ROOT", root)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap()
    }

    /// **A kill at any point leaves each frame absent or whole.** A child writing 100 frames of 701 KB is killed
    /// (SIGKILL) at a uniformly random time within one whole run's duration, `NATIVE_CACHE_KILLS` times (default
    /// 20); after each kill every frame is absent or passes its check. Power loss is not tested.
    #[test]
    fn a_killed_writer_leaves_each_frame_absent_or_whole() {
        let kills: u32 = std::env::var("NATIVE_CACHE_KILLS").ok().and_then(|k| k.parse().ok()).unwrap_or(20);
        let root = scratch("kill");
        let start = Instant::now();
        assert!(writer(&root).wait().unwrap().success());
        let whole_run = start.elapsed();
        let mut seed = 0x9e3779b97f4a7c15u64 ^ u64::from(std::process::id());
        let (mut absent, mut whole, mut torn) = (0, 0, 0);
        for _ in 0..kills {
            fs::remove_dir_all(&root).unwrap();
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let mut child = writer(&root);
            std::thread::sleep(whole_run.mul_f64((seed >> 11) as f64 / (1u64 << 53) as f64));
            child.kill().unwrap();
            child.wait().unwrap();
            let cache = Cache::open(&root, "series", "v1").unwrap();
            for index in 0..FRAMES {
                let stored = root.join("series/v1").join(index.to_string()).exists();
                match (stored, cache.get(index, same(frame(index, FRAME_LEN))).unwrap()) {
                    (false, _) => absent += 1,
                    (true, Some(_)) => whole += 1,
                    (true, None) => torn += 1,
                }
            }
        }
        println!("kills={kills} whole_run_ms={} whole={whole} absent={absent} torn={torn}", whole_run.as_millis());
        assert_eq!(torn, 0);
    }
}
