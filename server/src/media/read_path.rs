//! A page-cache read on the executor, escalating to a ring or the blocking pool when the
//! bytes are not there. `docs/disk-access/adr.md`, `docs/disk-access/IMPLEMENTATION.md`.
//! Windows: `docs/disk-access/READ-PATH-DESIGN.md` §11 cuts 3 and 4.

use crate::media::frame_store::{FrameSpan, FrameStore, READ_WINDOW};
use anyhow::{Context, Result};
use std::mem;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tracing::warn;

#[cfg(feature = "uring")]
use crate::media::uring_reader::UringReader;

/// A window's index is also its ring slot, so a read never moves between them.
pub const WINDOWS: usize = 2;

/// Which read path a session takes, from `WTPACS_READ_PATH`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ReadMode {
    #[default]
    Auto,
    Pool,
    /// Lab lever, not a production mode: every frame through the ring, hits included.
    Uring,
}

impl ReadMode {
    pub fn from_env() -> Self {
        match std::env::var("WTPACS_READ_PATH").as_deref() {
            Ok("pool") => Self::Pool,
            Ok("uring") => Self::Uring,
            Ok("auto") | Err(_) => Self::Auto,
            Ok(other) => {
                warn!(
                    value = other,
                    "WTPACS_READ_PATH is not auto|pool|uring; using auto"
                );
                Self::Auto
            }
        }
    }
}

/// The session's ring, built on its first miss and never rebuilt.
#[cfg(feature = "uring")]
enum Ring {
    /// Never wanted, or refused once — both mean the pool.
    Off,
    /// Built on the first miss.
    Wanted,
    Built(Box<UringReader>),
}

/// Counted per read, not per frame. `docs/disk-access/IMPLEMENTATION.md` §Reporting.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReadStats {
    pub hits: u64,
    pub misses: u64,
}

impl ReadStats {
    pub fn miss_rate(&self) -> Option<f64> {
        let total = self.hits + self.misses;
        (total > 0).then(|| self.misses as f64 / total as f64)
    }
}

/// A buffer, whose bytes it holds, and the one read at most still landing in it.
struct Window {
    /// The frame and the position in it these bytes start at.
    key: Option<(FrameSpan, u32)>,
    buf: Vec<u8>,
    at: u64,
    len: usize,
    filled: usize,
    miss: bool,
    read: Option<InFlight>,
}

enum InFlight {
    #[cfg(feature = "uring")]
    Ring,
    Pool(JoinHandle<Result<Vec<u8>>>),
}

impl Window {
    fn new() -> Self {
        Self {
            key: None,
            buf: Vec::new(),
            at: 0,
            len: 0,
            filled: 0,
            miss: false,
            read: None,
        }
    }

    /// Never on a window with a read in flight — `begin` waits first.
    fn fit(&mut self, need: usize) {
        if self.buf.len() < need {
            self.buf.resize(need, 0);
        }
    }
}

pub struct ReadCtx {
    /// Try the page cache before escalating. False only under [`ReadMode::Uring`].
    probe: bool,
    #[cfg(feature = "uring")]
    ring: Ring,
    windows: [Window; WINDOWS],
    last: usize,
    stats: ReadStats,
}

#[cfg(feature = "uring")]
impl Ring {
    /// Built on the first miss: safe because nothing is in flight on a ring that is absent.
    fn build_on_first_miss(&mut self, store: &FrameStore) -> Option<&mut UringReader> {
        if matches!(self, Self::Wanted) {
            *self = match UringReader::new(store.file()) {
                Ok(reader) => Self::Built(Box::new(reader)),
                Err(err) => {
                    warn!(%err, "io_uring unavailable; this session reads through the pool");
                    Self::Off
                }
            };
        }
        match self {
            Self::Built(reader) => Some(reader),
            _ => None,
        }
    }
}

impl ReadCtx {
    /// Without `RWF_NOWAIT` a ring keyed on the shortfall would serve every *warm* read
    /// too — `docs/disk-access/IMPLEMENTATION.md` §The trap.
    #[cfg_attr(not(feature = "uring"), allow(unused_variables))]
    pub fn new(mode: ReadMode, store: &FrameStore) -> Self {
        #[cfg(feature = "uring")]
        let wants_ring = match mode {
            ReadMode::Auto => store.nowait_supported(),
            ReadMode::Uring => true,
            ReadMode::Pool => false,
        };
        Self {
            probe: mode != ReadMode::Uring,
            #[cfg(feature = "uring")]
            ring: if wants_ring { Ring::Wanted } else { Ring::Off },
            windows: std::array::from_fn(|_| Window::new()),
            last: 0,
            stats: ReadStats::default(),
        }
    }

    /// Bytes of `span` from `pos`; reads of `upcoming` started underneath, one window each.
    /// Current first, then upcoming that fit, then wait — the measured order.
    pub async fn read(
        &mut self,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        pos: u32,
        upcoming: impl IntoIterator<Item = FrameSpan>,
    ) -> Result<&[u8]> {
        let wanted: Vec<(FrameSpan, u32)> = std::iter::once((span, pos))
            .chain(upcoming.into_iter().take(WINDOWS - 1).map(|s| (s, 0)))
            .collect();
        for &(s, p) in &wanted {
            if self.holding(s, p).is_none() {
                let w = self.free_window(&wanted);
                self.wait(w).await?;
                self.begin(store, w, s, p)?;
            }
        }
        let w = self.holding(span, pos).expect("started above");
        self.wait(w).await?;
        self.last = w;
        if self.windows[w].miss {
            self.stats.misses += 1;
        } else {
            self.stats.hits += 1;
        }
        Ok(&self.windows[w].buf[..self.windows[w].len])
    }

    fn holding(&self, span: FrameSpan, pos: u32) -> Option<usize> {
        self.windows.iter().position(|w| w.key == Some((span, pos)))
    }

    fn free_window(&self, wanted: &[(FrameSpan, u32)]) -> usize {
        self.windows
            .iter()
            .position(|w| !w.key.is_some_and(|k| wanted.contains(&k)))
            .expect("at most W wanted, W windows")
    }

    /// Probe one window without waiting; on a shortfall ask for the rest of the frame.
    fn begin(
        &mut self,
        store: &Arc<FrameStore>,
        w: usize,
        span: FrameSpan,
        pos: u32,
    ) -> Result<()> {
        let at = span.offset + u64::from(pos);
        let remaining = (span.len - pos) as usize;
        let want = READ_WINDOW.min(remaining);
        self.windows[w].fit(want);
        let hit = if self.probe {
            store.read_at_nowait(&mut self.windows[w].buf[..want], at)?
        } else {
            0
        };
        let win = &mut self.windows[w];
        win.key = Some((span, pos));
        win.at = at;
        win.filled = hit;
        win.len = hit;
        win.miss = hit != want;
        if hit == want {
            return Ok(());
        }
        win.len = remaining;
        win.fit(remaining);
        let pending = self.escalate(store, w)?;
        self.windows[w].read = Some(pending);
        Ok(())
    }

    /// The ring if this session has one, the pool otherwise. Neither is waited on here.
    fn escalate(&mut self, store: &Arc<FrameStore>, w: usize) -> Result<InFlight> {
        #[cfg(feature = "uring")]
        {
            let Self { ring, windows, .. } = self;
            if let Some(reader) = ring.build_on_first_miss(store) {
                let win = &mut windows[w];
                // SAFETY: `win.buf` is neither grown, read nor dropped while `win.read` is
                // `Some`; `wait` clears it, and `Drop` drains the ring before the windows go.
                unsafe {
                    reader.submit(
                        w,
                        &mut win.buf[win.filled..win.len],
                        win.at + win.filled as u64,
                    )
                }?;
                return Ok(InFlight::Ring);
            }
        }
        #[cfg(test)]
        store.account_pool_start();
        let store = Arc::clone(store);
        let win = &mut self.windows[w];
        let (from, len, at) = (win.filled, win.len, win.at);
        let mut buf = mem::take(&mut win.buf);
        Ok(InFlight::Pool(tokio::task::spawn_blocking(move || {
            store.read_at_blocking(&mut buf[from..len], at + from as u64)?;
            Ok(buf)
        })))
    }

    async fn wait(&mut self, w: usize) -> Result<()> {
        match self.windows[w].read.take() {
            None => Ok(()),
            Some(InFlight::Pool(join)) => {
                self.windows[w].buf = join.await.context("join frame read")??;
                self.windows[w].filled = self.windows[w].len;
                Ok(())
            }
            #[cfg(feature = "uring")]
            Some(InFlight::Ring) => {
                self.windows[w].read = Some(InFlight::Ring);
                let Self {
                    ring: Ring::Built(ring),
                    windows,
                    ..
                } = self
                else {
                    unreachable!("a ring read outlived its ring")
                };
                while windows[w].read.is_some() {
                    for (slot, landed) in ring.reap()? {
                        let win = &mut windows[slot];
                        win.filled += landed;
                        if win.filled == win.len {
                            win.read = None;
                        } else {
                            // SAFETY: as in `escalate`; the same window, its unread tail.
                            unsafe {
                                ring.submit(
                                    slot,
                                    &mut win.buf[win.filled..win.len],
                                    win.at + win.filled as u64,
                                )
                            }?;
                        }
                    }
                    if windows[w].read.is_some() {
                        ring.park().await?;
                    }
                }
                Ok(())
            }
        }
    }

    pub fn stats(&self) -> ReadStats {
        self.stats
    }

    #[cfg(test)]
    pub(crate) fn holds(&self, span: FrameSpan, pos: u32) -> bool {
        self.holding(span, pos).is_some()
    }

    #[cfg(test)]
    pub(crate) fn pending_windows(&self) -> usize {
        self.windows.iter().filter(|w| w.read.is_some()).count()
    }

    #[cfg(test)]
    pub(crate) fn serving_window(&self) -> usize {
        self.last
    }

    /// The path actually taken, which is not always the one configured.
    pub fn ring_built(&self) -> bool {
        #[cfg(feature = "uring")]
        return matches!(self.ring, Ring::Built(_));
        #[cfg(not(feature = "uring"))]
        return false;
    }
}

impl Drop for ReadCtx {
    /// Waits for the kernel before the windows are freed. Here rather than in the ring's own
    /// `Drop` because `Drop::drop` runs before any field is, so field order cannot break it.
    fn drop(&mut self) {
        #[cfg(feature = "uring")]
        if let Ring::Built(ring) = &mut self.ring {
            ring.drain_in_flight();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::frame_store::READ_WINDOW;
    use std::io::Write;

    /// A study of `frames` frames of `len` bytes, each filled with a per-frame pattern so a
    /// mis-assembled frame cannot pass by accident.
    fn write_bundle(dir: &std::path::Path, frames: u32, len: u32) -> std::path::PathBuf {
        let meta = format!("{{\"frameCount\":{frames}}}");
        let data_base = 16 + 12 * frames as usize + meta.len();
        let path = dir.join("test.sbnd");
        let mut f = std::fs::File::create(&path).expect("create bundle");
        f.write_all(b"SBND").unwrap();
        f.write_all(&1u32.to_le_bytes()).unwrap();
        f.write_all(&(meta.len() as u32).to_le_bytes()).unwrap();
        f.write_all(&frames.to_le_bytes()).unwrap();
        for i in 0..frames {
            f.write_all(&((data_base as u64) + u64::from(i) * u64::from(len)).to_le_bytes())
                .unwrap();
            f.write_all(&len.to_le_bytes()).unwrap();
        }
        f.write_all(meta.as_bytes()).unwrap();
        for i in 0..frames {
            f.write_all(&frame_pattern(i, len)).unwrap();
        }
        f.sync_all().unwrap();
        path
    }

    fn frame_pattern(idx: u32, len: u32) -> Vec<u8> {
        (0..len)
            .map(|b| (b.wrapping_mul(31).wrapping_add(idx.wrapping_mul(7)) % 251) as u8)
            .collect()
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("wtpacs-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        dir
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("rt")
    }

    /// `stream_codestream`'s loop against a buffer instead of a stream: what came out, and
    /// how many reads it took. Copied, not shared, so this needs no QUIC connection.
    fn drain(
        rt: &tokio::runtime::Runtime,
        ctx: &mut ReadCtx,
        store: &Arc<FrameStore>,
        idx: u32,
        next: Option<u32>,
    ) -> (Vec<u8>, usize) {
        let span = store.frame_span(idx).expect("span");
        let next = next.map(|n| store.frame_span(n).expect("next span"));
        let mut out: Vec<u8> = Vec::new();
        let mut pos = 0u32;
        let mut reads = 0usize;
        while pos < span.len {
            let ready = rt
                .block_on(ctx.read(store, span, pos, next))
                .expect("read");
            assert!(!ready.is_empty(), "an empty read would spin forever");
            reads += 1;
            out.extend_from_slice(ready);
            pos += ready.len() as u32;
        }
        (out, reads)
    }

    /// Six windows long, so a frame that misses can be told from a window that does.
    const LEN: u32 = (READ_WINDOW * 5 + 17) as u32;
    const SHORT: usize = READ_WINDOW / 3;

    /// **The ADR's claim, as an assertion**: a window that misses reads to the end of the
    /// *frame*, so a missing frame costs one round trip however many windows long it is.
    /// `docs/disk-access/RERUN-miss.md` has what windowing the escalation cost instead.
    #[test]
    fn a_frame_that_misses_costs_one_round_trip_not_one_per_window() {
        let dir = scratch("trips");
        let path = write_bundle(&dir, 3, LEN);
        let rt = rt();
        for shape in ["total miss", "partial hit"] {
            for mode in [ReadMode::Auto, ReadMode::Pool] {
                let mut store = FrameStore::open(&path).expect("open store");
                match shape {
                    "total miss" => store.force_pool_reads(),
                    _ => store.force_short_reads(SHORT),
                }
                let store = Arc::new(store);
                let mut ctx = ReadCtx::new(mode, &store);
                for idx in 0..3u32 {
                    let (out, reads) = drain(&rt, &mut ctx, &store, idx, None);
                    assert_eq!(
                        out,
                        frame_pattern(idx, LEN),
                        "frame {idx} came back wrong on a {shape} under {mode:?}"
                    );
                    assert_eq!(
                        reads, 1,
                        "frame {idx} is 6 windows long and took {reads} round trips on a \
                         {shape} under {mode:?}, not 1"
                    );
                }
            }
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Assembly across the window boundary, on every branch of the read, at the lengths most
    /// likely to be off by one — and with the read ahead both off and on, because it decides
    /// which of the two windows the bytes come out of.
    #[test]
    fn refilling_reassembles_every_frame_whatever_the_read_path() {
        let dir = scratch("fill");
        let rt = rt();
        for &len in &[
            1u32,
            (READ_WINDOW - 1) as u32,
            READ_WINDOW as u32,
            (READ_WINDOW + 1) as u32,
            (READ_WINDOW * 3 + 17) as u32,
        ] {
            let path = write_bundle(&dir, 3, len);
            for shape in ["hit", "total miss", "partial hit"] {
                for mode in [ReadMode::Auto, ReadMode::Pool, ReadMode::Uring] {
                    for ahead in [false, true] {
                        let mut store = FrameStore::open(&path).expect("open store");
                        match shape {
                            "hit" => {}
                            "total miss" => store.force_pool_reads(),
                            _ => store.force_short_reads(SHORT),
                        }
                        let store = Arc::new(store);
                        let mut ctx = ReadCtx::new(mode, &store);
                        for idx in 0..3u32 {
                            let next = (ahead && idx < 2).then_some(idx + 1);
                            let (out, _) = drain(&rt, &mut ctx, &store, idx, next);
                            assert_eq!(
                                out,
                                frame_pattern(idx, len),
                                "frame {idx} of length {len} came back wrong on a {shape} \
                                 under {mode:?}, read ahead {ahead}"
                            );
                        }
                    }
                }
            }
            std::fs::remove_file(&path).ok();
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **What the second window is for.** A frame served with the next one named starts that
    /// frame's read before its own bytes are waited on, and the next frame is then served
    /// out of the other window — the overlap that is worth +67% on missing tiles
    /// (`docs/adr-frame-framing-and-loop-shape.md` §Serving depth).
    #[test]
    fn naming_the_next_frame_starts_its_read_and_serves_it_from_the_other_window() {
        let dir = scratch("ahead");
        let path = write_bundle(&dir, 3, LEN);
        let rt = rt();
        for shape in ["hit", "total miss", "partial hit"] {
            let mut store = FrameStore::open(&path).expect("open store");
            match shape {
                "hit" => {}
                "total miss" => store.force_pool_reads(),
                _ => store.force_short_reads(SHORT),
            }
            let store = Arc::new(store);
            let mut ctx = ReadCtx::new(ReadMode::Auto, &store);
            let span1 = store.frame_span(1).unwrap();

            let served = ctx.serving_window();
            let (out, _) = drain(&rt, &mut ctx, &store, 0, Some(1));
            assert_eq!(out, frame_pattern(0, LEN), "frame 0 on a {shape}");
            assert!(
                ctx.holds(span1, 0),
                "frame 1's read was never started on a {shape}"
            );
            assert_eq!(
                ctx.serving_window(),
                served,
                "the frame in hand moved windows on a {shape}"
            );

            let first = rt
                .block_on(ctx.read(&store, span1, 0, None))
                .expect("frame 1 first window")
                .to_vec();
            assert_ne!(
                ctx.serving_window(),
                served,
                "frame 1 was re-read instead of taken from the window it landed in \
                 on a {shape}"
            );
            let mut assembled = first;
            let mut pos = assembled.len() as u32;
            while pos < span1.len {
                let ready = rt
                    .block_on(ctx.read(&store, span1, pos, None))
                    .expect("frame 1");
                pos += ready.len() as u32;
                assembled.extend_from_slice(ready);
            }
            assert_eq!(assembled, frame_pattern(1, LEN), "frame 1 on a {shape}");
            assert_eq!(
                ctx.pending_windows(),
                0,
                "an unasked-for read is still pending"
            );
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A batch that does not go the way it was hinted — a refused frame, a client that
    /// stopped — leaves a read the kernel or the pool is still writing into. Serving a
    /// different frame has to wait for it rather than reuse the window under it.
    #[test]
    fn a_read_ahead_nobody_asked_for_is_waited_for_before_its_window_is_reused() {
        let dir = scratch("stale");
        let path = write_bundle(&dir, 3, LEN);
        let rt = rt();
        for shape in ["hit", "total miss", "partial hit"] {
            let mut store = FrameStore::open(&path).expect("open store");
            match shape {
                "hit" => {}
                "total miss" => store.force_pool_reads(),
                _ => store.force_short_reads(SHORT),
            }
            let store = Arc::new(store);
            let mut ctx = ReadCtx::new(ReadMode::Auto, &store);
            let span1 = store.frame_span(1).unwrap();

            drain(&rt, &mut ctx, &store, 0, Some(1));
            assert!(ctx.holds(span1, 0), "nothing to abandon on a {shape}");

            let (out, _) = drain(&rt, &mut ctx, &store, 2, Some(0));
            assert_eq!(
                out,
                frame_pattern(2, LEN),
                "frame 2 came back wrong after abandoning frame 1 on a {shape}"
            );
            let (out, _) = drain(&rt, &mut ctx, &store, 0, None);
            assert_eq!(
                out,
                frame_pattern(0, LEN),
                "the window that held the abandoned read serves the wrong bytes on a {shape}"
            );
            assert_eq!(
                ctx.pending_windows(),
                0,
                "the abandoned read is still recorded"
            );
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// An unrecognised value must not become a mode nobody asked for, or disable the kill
    /// switch.
    #[test]
    fn read_mode_parses_the_three_it_documents() {
        assert_eq!(ReadMode::default(), ReadMode::Auto);
        for (value, want) in [
            ("pool", ReadMode::Pool),
            ("uring", ReadMode::Uring),
            ("auto", ReadMode::Auto),
            ("Pool", ReadMode::Auto),
            ("", ReadMode::Auto),
        ] {
            // This test owns the variable: no other test reads it, and the rest construct
            // `ReadMode` directly.
            std::env::set_var("WTPACS_READ_PATH", value);
            assert_eq!(ReadMode::from_env(), want, "WTPACS_READ_PATH={value:?}");
        }
        std::env::remove_var("WTPACS_READ_PATH");
        assert_eq!(ReadMode::from_env(), ReadMode::Auto, "unset");
    }

    /// The number every read-path threshold is expressed in, and the one the server could
    /// not report about itself. Both ends are pinned: a session that only hits reports 0,
    /// a session that only escalates reports 1, and one that read nothing reports neither.
    #[test]
    fn read_stats_report_the_session_miss_rate() {
        let dir = scratch("stats");
        let path = write_bundle(&dir, 3, LEN);
        let rt = rt();

        let mut store = FrameStore::open(&path).expect("open store");
        store.force_pool_reads();
        let store = Arc::new(store);
        let mut ctx = ReadCtx::new(ReadMode::Pool, &store);
        assert_eq!(ctx.stats().miss_rate(), None, "nothing read, nothing to say");
        for idx in 0..3u32 {
            drain(&rt, &mut ctx, &store, idx, None);
        }
        let stats = ctx.stats();
        assert_eq!(
            (stats.hits, stats.misses, stats.miss_rate()),
            (0, 3, Some(1.0)),
            "every read escalated, and one read covered each frame"
        );

        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        if store.nowait_supported() {
            let mut ctx = ReadCtx::new(ReadMode::Auto, &store);
            for idx in 0..3u32 {
                drain(&rt, &mut ctx, &store, idx, None);
            }
            let stats = ctx.stats();
            assert_eq!(stats.misses, 0, "a warm session escalated");
            assert_eq!(stats.miss_rate(), Some(0.0));
            assert!(stats.hits >= 3, "windows read: {}", stats.hits);
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **The arm's whole point**: a session that never misses never builds a ring, so on a
    /// hit-dominated workload the change is inert by design rather than by configuration.
    #[test]
    #[cfg(feature = "uring")]
    fn lazy_ring_is_not_built_when_every_read_hits() {
        let dir = scratch("nohit");
        let path = write_bundle(&dir, 3, LEN);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        if !store.nowait_supported() {
            eprintln!("skipped: this filesystem refuses RWF_NOWAIT, so every read reports a miss");
            std::fs::remove_dir_all(&dir).ok();
            return;
        }
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Auto, &store);
        for idx in 0..3u32 {
            let (out, _) = drain(&rt, &mut ctx, &store, idx, Some((idx + 1) % 3));
            assert_eq!(out, frame_pattern(idx, LEN));
        }
        assert!(
            !ctx.ring_built(),
            "a session that only ever hit the page cache built a ring anyway"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **The container trap**: where `RWF_NOWAIT` is refused every read reports a miss, so
    /// a ring keyed on the shortfall alone would then serve every *warm* read. The gate is
    /// `nowait_supported`, so no ring appears here at all.
    #[test]
    #[cfg(feature = "uring")]
    fn lazy_ring_is_never_built_without_nowait() {
        let dir = scratch("nonowait");
        let path = write_bundle(&dir, 3, LEN);
        let mut store = FrameStore::open(&path).expect("open store");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Auto, &store);
        for idx in 0..3u32 {
            let (out, _) = drain(&rt, &mut ctx, &store, idx, None);
            assert_eq!(out, frame_pattern(idx, LEN), "the pooled path still serves");
        }
        assert!(
            !ctx.ring_built(),
            "a ring was built on a filesystem that refuses RWF_NOWAIT — every warm read \
             would now go through it"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The prefix from the inline read plus the remainder from the ring is the frame.
    #[test]
    #[cfg(feature = "uring")]
    fn nowait_and_ring_compose_into_the_whole_frame() {
        let dir = scratch("compose");
        let path = write_bundle(&dir, 3, LEN);
        let mut store = FrameStore::open(&path).expect("open store");
        if !store.nowait_supported() {
            eprintln!("skipped: this filesystem refuses RWF_NOWAIT");
            std::fs::remove_dir_all(&dir).ok();
            return;
        }
        store.force_short_reads(SHORT);
        let store = Arc::new(store);
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Auto, &store);
        for idx in 0..3u32 {
            let (out, reads) = drain(&rt, &mut ctx, &store, idx, None);
            assert_eq!(out, frame_pattern(idx, LEN), "frame {idx} did not compose");
            assert_eq!(
                reads, 1,
                "the ring read the rest of the frame, not the window"
            );
        }
        assert!(ctx.ring_built(), "the miss path never reached the ring");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The lab lever reads every frame through the ring, so a layout experiment measures
    /// the `uring` arm and not a broken one.
    #[test]
    #[cfg(feature = "uring")]
    fn the_uring_lever_serves_whole_frames_through_the_ring() {
        let dir = scratch("lever");
        let path = write_bundle(&dir, 3, LEN);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Uring, &store);
        for idx in 0..3u32 {
            let (out, reads) = drain(&rt, &mut ctx, &store, idx, None);
            assert_eq!(out, frame_pattern(idx, LEN), "frame {idx} came back wrong");
            assert_eq!(reads, 1, "the lever reads whole frames, not windows");
        }
        assert!(ctx.ring_built(), "the lever never built a ring");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Where nowait is refused a frame is one pooled read, not one per window. Cut 4:
    /// `read_window` is gone; the miss size lives in `begin`.
    #[test]
    fn read_window_collapses_to_the_frame_without_nowait() {
        let dir = scratch("collapse");
        let path = write_bundle(&dir, 1, 250_000);
        let mut store = FrameStore::open(&path).expect("open");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Auto, &store);
        store.reset_pool_starts();
        let (out, reads) = drain(&rt, &mut ctx, &store, 0, None);
        assert_eq!(out, frame_pattern(0, 250_000));
        assert_eq!(reads, 1, "a pooled frame took {reads} reads, not 1");
        assert_eq!(
            store.pool_starts(),
            1,
            "a pooled 250 KB frame started {} blocking reads",
            store.pool_starts()
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Naming W − 1 upcoming frames starts W − 1 reads before the first is waited on.
    #[test]
    fn w_named_frames_put_w_reads_in_flight() {
        let dir = scratch("inflight");
        let path = write_bundle(&dir, WINDOWS as u32, LEN);
        let mut store = FrameStore::open(&path).expect("open");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Pool, &store);
        let span = store.frame_span(0).unwrap();
        let upcoming: Vec<FrameSpan> = (1..WINDOWS as u32)
            .map(|i| store.frame_span(i).unwrap())
            .collect();
        store.reset_pool_starts();
        rt.block_on(ctx.read(&store, span, 0, upcoming))
            .expect("read");
        assert_eq!(
            store.pool_starts(),
            WINDOWS,
            "started {} pooled reads, not {WINDOWS}",
            store.pool_starts()
        );
        assert_eq!(
            ctx.pending_windows(),
            WINDOWS - 1,
            "{} upcoming reads should still be in flight",
            WINDOWS - 1
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A hit never touches the ring; the trap in `IMPLEMENTATION.md`, pinned.
    #[test]
    #[cfg(feature = "uring")]
    fn a_hit_never_touches_the_ring() {
        let dir = scratch("hithole");
        let path = write_bundle(&dir, 3, LEN);
        let store = Arc::new(FrameStore::open(&path).expect("open"));
        if !store.nowait_supported() {
            eprintln!("skipped: this filesystem refuses RWF_NOWAIT");
            std::fs::remove_dir_all(&dir).ok();
            return;
        }
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Auto, &store);
        for idx in 0..3u32 {
            drain(&rt, &mut ctx, &store, idx, None);
        }
        assert!(!ctx.ring_built(), "a warm frame built a ring");
        assert_eq!(ctx.stats().misses, 0, "a warm frame reported a miss");
        std::fs::remove_dir_all(&dir).ok();
    }
}
