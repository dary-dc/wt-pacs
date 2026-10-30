//! The `ui` paint thread's loader: the whole series asked, each frame read from the cache or the wire, decoded and
//! checked on the runtime's worker, and handed on. `docs/native/README.md` §Parity with the browser core.

use crate::cache::Cache;
use crate::count;
use crate::decode::Decoder;
use crate::resume::{Heard, ResumingSession};
use crate::transport::Event;
use crate::verify::{exact, Exact};
use crate::view::{Asking, Wire};
use anyhow::Result;

pub enum Loaded {
    /// A frame whose check was not `false`.
    Frame { index: u32, samples: Vec<u8>, exact: Exact },
    /// A frame that failed its check, was refused, or was lost with its session; or a cache that could not write.
    Failed { index: u32, reason: String },
}

/// Ends once every frame is handed on or failed. A cache write runs before the frame's hand-off, as the branches merged
/// it, and its failure is reported, never fatal (#209).
pub async fn load(
    mut session: ResumingSession,
    mut decoder: Decoder,
    digests: Option<Vec<u64>>,
    count: u32,
    cache: Option<Cache>,
    depth: usize,
    mut hand: impl FnMut(Loaded) -> Result<()>,
) -> Result<()> {
    let digest = |index: u32| digests.as_ref().and_then(|d| d.get(index as usize).copied());
    let mut asking = Asking::new(depth);
    asking.want((0..count).collect());
    loop {
        while let Some(wire) = asking.next(|i| cache.as_ref().is_some_and(|c| c.has(i))) {
            match wire {
                Wire::Fill(from, to) => session.fill(from, to).await?,
                Wire::Ask(index) => session.ask(index).await?,
                Wire::End => session.end_stream().await?,
                Wire::Cached(index) => {
                    let mut check = |coded: &[u8]| {
                        count::copy(index, decoder.copies());
                        let samples = decoder.decode(coded).ok()?;
                        let e = exact(&samples, digest(index));
                        (e == Exact::True).then_some(samples)
                    };
                    let hit = cache.as_ref().expect("on disk").get(index, &mut check).unwrap_or_else(|e| {
                        println!("failed scope=cache frame={index} reason={e:#}");
                        None
                    });
                    if let Some(samples) = &hit {
                        println!("frame={index} exact=true source=cache");
                        hand(Loaded::Frame { index, samples: samples.clone(), exact: Exact::True })?;
                    }
                    asking.done(index, hit.is_none());
                }
            }
        }
        if asking.finished() {
            break;
        }
        match session.next(asking.owed()).await? {
            Heard::Event(Event::Frame { index, body, .. }) => {
                asking.arrived(index);
                count::copy(index, decoder.copies());
                let checked = decoder.decode(&body).map(|s| (exact(&s, digest(index)), s));
                match checked {
                    Ok((Exact::False, _)) => {
                        println!("frame={index} exact=false");
                        hand(Loaded::Failed { index, reason: "NOT EXACT".into() })?;
                    }
                    Ok((e, samples)) => {
                        println!("frame={index} exact={}", format!("{e:?}").to_lowercase());
                        if let Some(Err(err)) = cache.as_ref().map(|c| c.put(index, &body, &e)) {
                            println!("failed scope=cache frame={index} reason={err:#}");
                            hand(Loaded::Failed { index, reason: format!("cache: {err:#}") })?;
                        }
                        hand(Loaded::Frame { index, samples, exact: e })?;
                    }
                    Err(e) => {
                        println!("frame={index} exact=false reason={e:#}");
                        hand(Loaded::Failed { index, reason: format!("NOT EXACT: {e:#}") })?;
                    }
                }
                asking.done(index, false);
            }
            Heard::Event(Event::Refused { frame, reason }) => {
                println!("frame={frame} refused={reason:?}");
                asking.refused(frame);
                hand(Loaded::Failed { index: frame, reason: format!("refused: {reason}") })?;
            }
            Heard::Resumed => asking.resumed(),
            Heard::Lost(reason) => {
                for index in asking.lost() {
                    println!("frame={index} exact=false reason={reason:?}");
                    hand(Loaded::Failed { index, reason: reason.clone() })?;
                }
            }
        }
    }
    session.close();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resume::tests::{quick, Relay};
    use crate::transport::tests::{serve, temp_dir, until_up};
    use crate::transport::Windows;
    use crate::view::tests::series;
    use std::path::Path;
    use std::sync::atomic::Ordering;

    struct Run {
        frames: Vec<(u32, Exact)>,
        failed: Vec<(u32, String)>,
    }

    async fn run(url: &str, hash: [u8; 32], metadata: &str, count: u32, cache: Option<Cache>, after_dial: impl FnOnce()) -> Run {
        let session = until_up(|| ResumingSession::open(url, hash, Windows::default(), tokio::sync::Semaphore::MAX_PERMITS, quick())).await;
        after_dial();
        let decoder = Decoder::new(metadata).unwrap();
        let digests = crate::verify::digests(metadata).unwrap();
        let mut got = Run { frames: Vec::new(), failed: Vec::new() };
        let hand = |l: Loaded| {
            match l {
                Loaded::Frame { index, exact, .. } => got.frames.push((index, exact)),
                Loaded::Failed { index, reason } => got.failed.push((index, reason)),
            }
            Ok(())
        };
        tokio::time::timeout(std::time::Duration::from_secs(20), load(session, decoder, digests, count, cache, 4, hand)).await.expect("the load stalled").unwrap();
        got.frames.sort_by_key(|f| f.0);
        got
    }

    fn bundle(dir: &Path, count: usize) -> (String, std::path::PathBuf) {
        let (metadata, coded) = series(count);
        let path = dir.join("series.sbnd");
        let frames: Vec<&[u8]> = coded.iter().map(|c| &c[..]).collect();
        series_bundle::write_bundle(&path, metadata.as_bytes(), &frames).unwrap();
        (metadata, path)
    }

    fn all_exact(count: u32) -> Vec<(u32, Exact)> {
        (0..count).map(|i| (i, Exact::True)).collect()
    }

    /// **A cache that cannot write does not stop the load (#209).** With the cache's directory replaced by a file,
    /// every frame is still handed on exact, and each failed write is reported by its frame.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_cache_that_cannot_write_does_not_stop_the_load() {
        let dir = temp_dir("load-broken-cache");
        let (metadata, path) = bundle(&dir, 6);
        let (url, hash) = serve(&dir, &path, "per-frame").await;
        let root = dir.join("cache");
        let cache = Cache::open(&root, "s", "v1").unwrap();
        std::fs::remove_dir(root.join("s/v1")).unwrap();
        std::fs::write(root.join("s/v1"), b"not a directory").unwrap();
        let got = run(&url, hash, &metadata, 6, Some(cache), || ()).await;
        assert_eq!(got.frames, all_exact(6));
        let mut reported: Vec<u32> = got.failed.iter().filter(|(_, r)| r.starts_with("cache:")).map(|f| f.0).collect();
        reported.sort();
        assert_eq!(reported, [0, 1, 2, 3, 4, 5], "a failed write was not reported");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **Under `ui` the cache is read.** A second load over a warm cache takes every frame from disk, exact, with
    /// every packet dropped from the dial on; a frame whose entry was flipped fails its check, is removed and comes from the
    /// wire.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_cache_is_read_and_a_flipped_entry_comes_from_the_wire() {
        let dir = temp_dir("load-warm-cache");
        let (metadata, path) = bundle(&dir, 6);
        let (url, hash) = serve(&dir, &path, "per-frame").await;
        let root = dir.join("cache");
        let warm = run(&url, hash, &metadata, 6, Some(Cache::open(&root, "s", "v1").unwrap()), || ()).await;
        assert_eq!(warm.frames, all_exact(6));

        let relay = Relay::to(&url).await;
        let cold = run(&relay.url, hash, &metadata, 6, Some(Cache::open(&root, "s", "v1").unwrap()), || relay.dead.store(true, Ordering::Relaxed)).await;
        assert_eq!(cold.frames, all_exact(6), "a frame on disk was not read from it");
        assert!(cold.failed.is_empty(), "{:?}", cold.failed);

        let entry = root.join("s/v1/3");
        let mut bytes = std::fs::read(&entry).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        std::fs::write(&entry, bytes).unwrap();
        let mended = run(&url, hash, &metadata, 6, Some(Cache::open(&root, "s", "v1").unwrap()), || ()).await;
        assert_eq!(mended.frames, all_exact(6));
        assert!(entry.exists(), "the frame fetched again was not written back");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **The `ui` loader survives a silent path.** With the path silent once the fill is asked, the load resumes and
    /// hands on every frame exact, once each.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_ui_loader_survives_a_silent_path() {
        let dir = temp_dir("load-resume");
        let (metadata, path) = bundle(&dir, 8);
        let (url, hash) = serve(&dir, &path, "per-frame").await;
        let relay = Relay::to(&url).await;
        let got = run(&relay.url, hash, &metadata, 8, None, || relay.cut()).await;
        assert_eq!(got.frames, all_exact(8));
        assert!(got.failed.is_empty(), "{:?}", got.failed);
        std::fs::remove_dir_all(&dir).ok();
    }
}
