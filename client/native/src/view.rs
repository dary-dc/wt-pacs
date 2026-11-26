//! The view-worker design on native threads: the downloader turns the view's ordered want into the wire, `N` decoders
//! hand each frame to the view through `K` credits, and the store holds frames by byte budget.
//! `docs/native/README.md` §The view-worker design, native.

use crate::cache::Cache;
use crate::count::{self, Sent};
use crate::decode::Decoder;
use crate::transport::{Event, Session};
use crate::verify::{exact, Exact};
use anyhow::{bail, Result};
use bytes::Bytes;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, watch, Mutex};

/// A frame for a decoder: its coded bytes from the wire, or `None` to read them from the cache.
pub struct Job {
    pub index: u32,
    pub coded: Option<Bytes>,
}

/// A decoder's frame for the view. `written` turns true once the cache holds it, or at once when there is no cache.
pub struct Decoded {
    pub index: u32,
    pub samples: Result<Vec<u8>, String>,
    pub exact: Exact,
    pub written: Arc<AtomicBool>,
}

/// After the frame's send and its cache write: the downloader's record of it ends. `refetch` when the cache's copy
/// failed its check and was removed, so the frame is asked of the wire.
pub struct Done {
    pub index: u32,
    pub refetch: bool,
}

pub enum Wire {
    Fill(u32, u32),
    Ask(u32),
    Cached(u32),
}

/// The downloader's records: the want, newest first replacing the last, and what is owed against it.
pub struct Asking {
    want: Vec<u32>,
    asked: Vec<u32>,
    fill: Option<(u32, u32)>,
    decoding: BTreeSet<u32>,
    /// Frames sent to a decoder from the cache under the current want.
    read: BTreeSet<u32>,
    depth: usize,
}

impl Asking {
    /// At most `depth` asks on the wire at once.
    pub fn new(depth: usize) -> Self {
        Self { want: Vec::new(), asked: Vec::new(), fill: None, decoding: BTreeSet::new(), read: BTreeSet::new(), depth: depth.max(1) }
    }

    pub fn want(&mut self, want: Vec<u32>) {
        self.want = want;
        self.read.clear();
    }

    /// What to send next, in the want's order: one fill where the misses are ascending and nothing is owed, else asks
    /// up to `depth`; a frame `on_disk` goes to a decoder instead. Any message ends a running fill on the server, so
    /// its frames not yet here stop being owed. `docs/WIRE.md` §An ask during a fill.
    pub fn next(&mut self, on_disk: impl Fn(u32) -> bool) -> Option<Wire> {
        let misses: Vec<u32> = self.want.iter().copied().filter(|i| !self.asked.contains(i) && !self.decoding.contains(i)).collect();
        let (&first, &last) = (misses.first()?, misses.last()?);
        if on_disk(first) {
            self.dispatched(first);
            self.read.insert(first);
            return Some(Wire::Cached(first));
        }
        if let Some((from, to)) = self.fill.take() {
            self.asked.retain(|i| !(from..=to).contains(i));
        }
        let ascending = misses.windows(2).all(|w| w[1] == w[0] + 1);
        if self.asked.is_empty() && self.decoding.is_empty() && misses.len() > 1 && ascending {
            self.fill = Some((first, last));
            self.asked = misses;
            return Some(Wire::Fill(first, last));
        }
        if self.asked.len() >= self.depth {
            return None;
        }
        self.asked.push(first);
        Some(Wire::Ask(first))
    }

    /// False for a frame no longer owed, which is decoded and kept all the same.
    pub fn arrived(&mut self, index: u32) -> bool {
        let owed = self.asked.contains(&index);
        self.asked.retain(|&i| i != index);
        if self.asked.is_empty() {
            self.fill = None;
        }
        self.dispatched(index);
        owed
    }

    fn dispatched(&mut self, index: u32) {
        self.want.retain(|&i| i != index);
        self.decoding.insert(index);
    }

    /// A refetch goes first only under the want it was read for; a newer want has already placed the frame, or dropped it.
    pub fn done(&mut self, index: u32, refetch: bool) {
        self.decoding.remove(&index);
        if self.read.remove(&index) && refetch {
            self.want.insert(0, index);
        }
    }

    pub fn refused(&mut self, index: u32) {
        self.asked.retain(|&i| i != index);
        self.want.retain(|&i| i != index);
    }

    pub fn idle(&self) -> bool {
        self.asked.is_empty() && self.decoding.is_empty()
    }
}

/// Runs until the view drops `want` and nothing is owed. `jobs` holds `K` coded frames; while it is full the session
/// is not read, so its stream readers stop and QUIC's windows reach the server.
pub async fn download(
    mut session: Session,
    mut want: watch::Receiver<Vec<u32>>,
    jobs: mpsc::Sender<Sent<Job>>,
    mut done: mpsc::UnboundedReceiver<Sent<Done>>,
    cache: Option<Arc<Cache>>,
    depth: usize,
) -> Result<()> {
    let mut asking = Asking::new(depth);
    asking.want(want.borrow_and_update().clone());
    let (mut pending, mut viewing, mut late) = (None, true, 0);
    loop {
        while pending.is_none() {
            match asking.next(|i| cache.as_ref().is_some_and(|c| c.has(i))) {
                Some(Wire::Fill(from, to)) => session.fill(from, to).await?,
                Some(Wire::Ask(index)) => session.ask(index).await?,
                Some(Wire::Cached(index)) => pending = Some(Job { index, coded: None }),
                None => break,
            }
        }
        if !viewing && pending.is_none() && asking.idle() {
            println!("downloader late={late}");
            session.close();
            return Ok(());
        }
        tokio::select! {
            changed = want.changed(), if viewing => match changed {
                Ok(()) => asking.want(want.borrow_and_update().clone()),
                Err(_) => viewing = false,
            },
            permit = jobs.reserve(), if pending.is_some() => permit?.send(Sent::now(pending.take().expect("pending"))),
            Some(d) = done.recv() => {
                let d = d.received("done");
                count::hop(d.index);
                asking.done(d.index, d.refetch);
            }
            event = session.next(), if pending.is_none() => match event {
                Some(Ok(Event::Frame { index, body, .. })) => {
                    late += usize::from(!asking.arrived(index));
                    pending = Some(Job { index, coded: Some(body) });
                }
                Some(Ok(Event::Refused { frame, reason })) => {
                    println!("failed scope=frame frame={frame} reason={reason:?}");
                    asking.refused(frame);
                }
                Some(Err(e)) => return Err(e),
                None => bail!("the session ended with frames owed"),
            },
        }
    }
}

/// `n` decoder threads. Each takes a credit — room in `frames` — before it takes a job, so decoded frames the view
/// has not received never number more than `frames`' capacity. The frame goes to the view first, then the cache
/// write, then `done`.
pub fn decoders(
    n: usize,
    metadata: &str,
    digests: Option<Vec<u64>>,
    cache: Option<Arc<Cache>>,
    jobs: mpsc::Receiver<Sent<Job>>,
    frames: mpsc::Sender<Sent<Decoded>>,
    done: mpsc::UnboundedSender<Sent<Done>>,
) -> Result<()> {
    let jobs = Arc::new(Mutex::new(jobs));
    let digests = Arc::new(digests);
    for _ in 0..n {
        let mut decoder = Decoder::new(metadata)?;
        let (jobs, frames, done, cache, digests) = (jobs.clone(), frames.clone(), done.clone(), cache.clone(), digests.clone());
        let runtime = tokio::runtime::Builder::new_current_thread().build()?;
        std::thread::Builder::new().name("decoder".into()).spawn(move || {
            runtime.block_on(async {
                while let Ok(credit) = frames.reserve().await {
                    let Some(job) = jobs.lock().await.recv().await else { return };
                    let Job { index, coded } = job.received("job");
                    count::hop(index);
                    let digest = digests.as_ref().as_ref().and_then(|d| d.get(index as usize).copied());
                    let mut check = |coded: &[u8]| {
                        count::copy(index, decoder.copies());
                        let samples = decoder.decode(coded).map_err(|e| format!("{e:#}"));
                        let exact = samples.as_ref().map_or(Exact::False, |s| exact(s, digest));
                        (samples, exact)
                    };
                    let (from_disk, (samples, exact)) = match (&coded, &cache) {
                        (Some(coded), _) => (false, check(coded)),
                        (None, Some(cache)) => {
                            let hit = cache.get(index, |coded| Some(check(coded)).filter(|(_, e)| *e == Exact::True)).unwrap_or(None);
                            (true, hit.unwrap_or((Err("cache: absent or failed its check".into()), Exact::False)))
                        }
                        (None, None) => (true, (Err("no cache".into()), Exact::False)),
                    };
                    println!("frame={index} exact={}{}", format!("{exact:?}").to_lowercase(), if from_disk { " source=cache" } else { "" });
                    let refetch = from_disk && exact != Exact::True;
                    let written = Arc::new(AtomicBool::new(cache.is_none() || from_disk || exact != Exact::True));
                    if !refetch {
                        credit.send(Sent::now(Decoded { index, samples, exact, written: written.clone() }));
                    }
                    if let (Some(cache), Some(coded), false) = (&cache, &coded, written.load(Ordering::Relaxed)) {
                        if let Err(e) = cache.put(index, coded, &Exact::True) {
                            println!("failed scope=cache frame={index} reason={e:#}");
                        }
                        written.store(true, Ordering::Release);
                    }
                    let _ = done.send(Sent::now(Done { index, refetch }));
                }
            })
        })?;
    }
    Ok(())
}

/// Frames held in memory by byte budget. Over it, the frame farthest from `near` goes first, the earlier at equal
/// distance as `want` ranks it last, and only once written.
pub struct Store {
    budget: usize,
    bytes: usize,
    frames: BTreeMap<u32, (Vec<u8>, Arc<AtomicBool>)>,
}

impl Store {
    pub fn new(budget: usize) -> Self {
        Self { budget, bytes: 0, frames: BTreeMap::new() }
    }

    /// False when the frame is already held; the copy that came second is dropped.
    pub fn put(&mut self, index: u32, samples: Vec<u8>, written: Arc<AtomicBool>, near: u32) -> bool {
        if self.frames.contains_key(&index) {
            return false;
        }
        self.bytes += samples.len();
        self.frames.insert(index, (samples, written));
        while self.bytes > self.budget {
            let evictable = self.frames.iter().filter(|(&i, (_, w))| i != near && w.load(Ordering::Acquire));
            let Some(&far) = evictable.map(|(i, _)| i).max_by_key(|&&i| (i.abs_diff(near), i < near)) else { break };
            self.bytes -= self.frames.remove(&far).expect("held").0.len();
        }
        true
    }

    pub fn get(&self, index: u32) -> Option<&[u8]> {
        self.frames.get(&index).map(|(s, _)| &s[..])
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    /// The frames to want, nearest `near` first and the later one first at equal distance, as many as `budget`
    /// holds of `frame_bytes` each, less those held.
    pub fn want(&self, near: u32, count: u32, frame_bytes: usize) -> Vec<u32> {
        let room = (self.budget / frame_bytes.max(1)).clamp(1, count as usize);
        let around = (0..count).flat_map(|d| [near.checked_add(d), near.checked_sub(d).filter(|_| d > 0)]).flatten();
        around.filter(|&i| i < count).take(room).filter(|i| !self.frames.contains_key(i)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::tests::{serve, temp_dir, until_up};
    use crate::transport::{dial_bounded, Windows};
    use std::path::Path;
    use std::time::Duration;

    const PAYLOADS: [&str; 4] = ["g9", "g10", "g12", "g14"];

    /// The window check's grey series, its four AV1 payloads repeated to `count` frames, with each frame's digest.
    fn series(count: usize) -> (String, Vec<Bytes>) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let metadata = std::fs::read_to_string(root.join("lab/fixtures/window_grey16/metadata.json")).unwrap();
        let mut metadata: serde_json::Value = serde_json::from_str(&metadata).unwrap();
        let digests = metadata["digests"]["frames"].as_array().unwrap().clone();
        metadata["frameCount"] = count.into();
        metadata["digests"]["frames"] = (0..count).map(|i| digests[i % 4].clone()).collect();
        let plain = root.join("client/contract/av1/payloads/plain");
        let frames = (0..count).map(|i| std::fs::read(plain.join(format!("{}.av1", PAYLOADS[i % 4]))).unwrap().into()).collect();
        (metadata.to_string(), frames)
    }

    fn digests(metadata: &str) -> Option<Vec<u64>> {
        crate::verify::digests(metadata).unwrap()
    }

    fn pool(n: usize, credits: usize, metadata: &str, cache: Option<Arc<Cache>>) -> (mpsc::Sender<Sent<Job>>, mpsc::Receiver<Sent<Decoded>>, mpsc::UnboundedReceiver<Sent<Done>>) {
        let (jobs, queued) = mpsc::channel(64);
        let (decoded, frames) = mpsc::channel(credits);
        let (done, finished) = mpsc::unbounded_channel();
        decoders(n, metadata, digests(metadata), cache, queued, decoded, done).unwrap();
        (jobs, frames, finished)
    }

    /// **The ordered want reaches the wire in order.** A want that is not ascending goes out as asks in the want's
    /// order, at most `depth` at once, topped up as frames land; a replacing want's order is followed from then on,
    /// a frame asked under the old one is not asked again, and when it lands it is kept though no longer owed.
    #[test]
    fn the_ordered_want_reaches_the_wire_in_order() {
        let mut asking = Asking::new(2);
        let mut sent = Vec::new();
        let drain = |asking: &mut Asking, sent: &mut Vec<u32>| {
            while let Some(wire) = asking.next(|_| false) {
                match wire {
                    Wire::Ask(i) => sent.push(i),
                    _ => panic!("not an ask"),
                }
            }
        };
        asking.want(vec![5, 2, 7, 0, 3]);
        drain(&mut asking, &mut sent);
        assert_eq!(sent, [5, 2]);
        for landed in [5, 2] {
            assert!(asking.arrived(landed));
            drain(&mut asking, &mut sent);
        }
        assert_eq!(sent, [5, 2, 7, 0]);
        asking.want(vec![9, 0, 8]);
        assert!(asking.arrived(7));
        drain(&mut asking, &mut sent);
        assert_eq!(sent, [5, 2, 7, 0, 9]);
        assert!(asking.arrived(0) && asking.arrived(9));
        drain(&mut asking, &mut sent);
        assert_eq!(sent, [5, 2, 7, 0, 9, 8]);
        assert!(!asking.arrived(3), "a frame asked under no want was owed");
    }

    /// An ascending want with nothing owed is one fill; a frame the cache holds goes to a decoder, not the wire; a
    /// later want that needs an ask ends the fill, and the fill's frames not yet here are owed no longer.
    #[test]
    fn an_ascending_want_is_one_fill_and_an_ask_ends_it() {
        let mut asking = Asking::new(4);
        asking.want(vec![0, 1, 2, 3]);
        assert!(matches!(asking.next(|i| i == 0), Some(Wire::Cached(0))));
        assert!(matches!(asking.next(|_| false), Some(Wire::Ask(1))));
        asking.done(0, false);

        let mut asking = Asking::new(4);
        asking.want(vec![0, 1, 2, 3]);
        assert!(matches!(asking.next(|_| false), Some(Wire::Fill(0, 3))));
        assert!(asking.next(|_| false).is_none());
        assert!(asking.arrived(0));
        asking.want(vec![7, 2]);
        assert!(matches!(asking.next(|_| false), Some(Wire::Ask(7))));
        assert!(matches!(asking.next(|_| false), Some(Wire::Ask(2))));
        assert!(!asking.arrived(3), "a frame of an ended fill was still owed");
    }

    /// A frame read from the cache that fails its check is asked of the wire first while the want it was read for
    /// stands; once the view has replaced that want, the frame keeps the place the new want gives it, or none.
    #[test]
    fn a_refetch_follows_the_want_it_was_read_for() {
        let mut asking = Asking::new(4);
        asking.want(vec![1, 3]);
        assert!(matches!(asking.next(|i| i == 1), Some(Wire::Cached(1))));
        asking.done(1, true);
        assert!(matches!(asking.next(|_| false), Some(Wire::Ask(1))));

        let mut asking = Asking::new(4);
        asking.want(vec![1, 3]);
        assert!(matches!(asking.next(|i| i == 1), Some(Wire::Cached(1))));
        asking.want(vec![9, 8]);
        asking.done(1, true);
        assert!(matches!(asking.next(|_| false), Some(Wire::Ask(9))));
        assert!(matches!(asking.next(|_| false), Some(Wire::Ask(8))));
        assert!(asking.next(|_| false).is_none(), "a frame the view no longer wants was asked");

        let mut asking = Asking::new(4);
        asking.want(vec![1, 3]);
        assert!(matches!(asking.next(|i| i == 1), Some(Wire::Cached(1))));
        asking.want(vec![9, 1]);
        asking.done(1, true);
        assert!(matches!(asking.next(|_| false), Some(Wire::Ask(9))));
        assert!(matches!(asking.next(|_| false), Some(Wire::Ask(1))));
    }

    /// Over the budget the store drops the frame farthest from the one shown, never that one, and never a frame
    /// not yet written; a frame it already holds is not taken twice; its want is the nearest frames it has room for.
    #[test]
    fn the_store_evicts_by_budget_farthest_first_and_only_once_written() {
        let flag = |w: bool| Arc::new(AtomicBool::new(w));
        let mut store = Store::new(3 * 10);
        let unwritten = flag(false);
        for (i, written) in [(0, flag(true)), (9, unwritten.clone()), (5, flag(true))] {
            assert!(store.put(i, vec![i as u8; 10], written, 4));
        }
        assert!(!store.put(5, vec![0; 10], flag(true), 4), "a frame held was taken twice");
        assert!(store.put(4, vec![4; 10], flag(true), 4));
        assert!(store.get(9).is_some() && store.get(0).is_none(), "the unwritten frame 9 went, or written 0 stayed");
        unwritten.store(true, Ordering::Release);
        assert!(store.put(3, vec![3; 10], flag(true), 4));
        assert!(store.get(9).is_none() && store.get(4).is_some());
        assert_eq!(store.bytes(), 30);
        assert_eq!(store.want(4, 10, 10), Vec::<u32>::new());
        assert_eq!(store.want(8, 10, 10), [8, 9, 7]);
        assert_eq!(store.want(0, 10, 10), [0, 1, 2]);
    }

    /// **The store keeps what its want asks for.** At equal distance from the frame shown the earlier frame goes, since
    /// the want takes the later one first: a frame fetched for the want is not the one evicted on arrival. The frame
    /// shown stays though nothing else can go.
    #[test]
    fn the_store_evicts_what_its_want_ranks_last_and_never_the_frame_shown() {
        let flag = |w: bool| Arc::new(AtomicBool::new(w));
        let mut store = Store::new(2 * 10);
        for i in [0, 1] {
            store.put(i, vec![i as u8; 10], flag(true), 1);
        }
        assert_eq!(store.want(1, 10, 10), [2]);
        store.put(2, vec![2; 10], flag(true), 1);
        assert!(store.get(2).is_some() && store.get(0).is_none(), "the frame the want asked for was evicted on arrival");
        assert_eq!(store.want(1, 10, 10), Vec::<u32>::new());

        let mut store = Store::new(10);
        store.put(5, vec![5; 10], flag(true), 5);
        store.put(6, vec![6; 10], flag(false), 5);
        assert!(store.get(5).is_some(), "the frame shown was evicted");
    }

    /// **Credits bound the frames the view has not received.** With the view receiving nothing, two decoders and
    /// one credit take one job of four and decode no further; each frame received frees one credit, and all four
    /// arrive exact.
    #[tokio::test]
    async fn credits_bound_the_frames_the_view_has_not_received() {
        let (metadata, coded) = series(4);
        let (jobs, mut frames, _done) = pool(2, 1, &metadata, None);
        for (index, coded) in coded.into_iter().enumerate() {
            jobs.send(Sent::now(Job { index: index as u32, coded: Some(coded) })).await.unwrap();
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(jobs.max_capacity() - jobs.capacity(), 3, "decoders took more jobs than credits");
        let mut got = Vec::new();
        while got.len() < 4 {
            let f = frames.recv().await.unwrap().received("decoded");
            assert_eq!(f.exact, Exact::True, "frame {}", f.index);
            got.push(f.index);
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(jobs.max_capacity() - jobs.capacity() >= 3 - got.len().min(3), "a credit was not returned");
        }
        got.sort();
        assert_eq!(got, [0, 1, 2, 3]);
    }

    /// **The cache write lands after the frame reaches the view.** With writes slowed, each frame arrives with its
    /// `written` false and the cache without it; its `done` comes once the cache holds it.
    #[tokio::test]
    async fn the_cache_write_lands_after_the_view_has_the_frame() {
        let (metadata, coded) = series(2);
        let root = temp_dir("view-write");
        let _ = std::fs::remove_dir_all(&root);
        let cache = Arc::new(Cache::open(&root, "s", "v1").unwrap().slow_writes(Duration::from_millis(300)));
        let (jobs, mut frames, mut done) = pool(2, 2, &metadata, Some(cache.clone()));
        for (index, coded) in coded.into_iter().enumerate() {
            jobs.send(Sent::now(Job { index: index as u32, coded: Some(coded) })).await.unwrap();
        }
        for _ in 0..2 {
            let f = frames.recv().await.unwrap().received("decoded");
            assert!(!cache.has(f.index) && !f.written.load(Ordering::Acquire), "frame {} was written before the view had it", f.index);
        }
        for _ in 0..2 {
            let d = done.recv().await.unwrap().received("done");
            assert!(cache.has(d.index) && !d.refetch);
        }
        std::fs::remove_dir_all(&root).ok();
    }

    /// **The hand-over loses no frame and duplicates none.** A fill of twelve frames over raw QUIC, through the
    /// downloader, three decoders and two credits into the store: each frame is taken once and exact, and once the
    /// view drops its want the downloader ends, which it does only with no frame still owed.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_hand_over_loses_no_frame_and_duplicates_none() {
        let (metadata, coded) = series(12);
        let dir = temp_dir("view-hand-over");
        let bundle = dir.join("series.sbnd");
        let frames: Vec<&[u8]> = coded.iter().map(|c| &c[..]).collect();
        series_bundle::write_bundle(&bundle, metadata.as_bytes(), &frames).unwrap();
        let (url, hash) = serve(&dir, &bundle, "per-frame").await;
        let windows = Windows::default();
        let session = until_up(|| dial_bounded(&url, hash, &windows, 1)).await;
        let (jobs, queued) = mpsc::channel(2);
        let (decoded, mut received) = mpsc::channel(2);
        let (done, finished) = mpsc::unbounded_channel();
        decoders(3, &metadata, digests(&metadata), None, queued, decoded, done).unwrap();
        let (want, wanted) = watch::channel((0..12).collect());
        let downloader = tokio::spawn(download(session, wanted, jobs, finished, None, 4));
        let mut store = Store::new(usize::MAX);
        for _ in 0..12 {
            let f = tokio::time::timeout(Duration::from_secs(10), received.recv()).await.expect("a frame stalled").unwrap().received("decoded");
            assert_eq!(f.exact, Exact::True, "frame {}", f.index);
            assert!(store.put(f.index, f.samples.unwrap(), f.written, 0), "frame {} taken twice", f.index);
        }
        drop(want);
        tokio::time::timeout(Duration::from_secs(10), downloader).await.expect("the downloader still owes frames").unwrap().unwrap();
        assert!((0..12).all(|i| store.get(i).is_some()));
        std::fs::remove_dir_all(&dir).ok();
    }
}
