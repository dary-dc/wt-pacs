//! A page-cache read on the executor, escalating to a ring or the blocking pool when the
//! bytes are not there. `docs/disk-access/adr.md`, `docs/disk-access/IMPLEMENTATION.md`.

use crate::media::frame_store::{FrameSpan, FrameStore};
use anyhow::{Context, Result};
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
    Off,
    Pending,
    Ready(Box<UringReader>),
    /// Remembered, so a kernel that refused once is not asked again on every miss.
    Refused,
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

/// How the bytes for one read arrive. `Ring` writes into the window of its own index.
enum Pending {
    Ready,
    #[cfg(feature = "uring")]
    Ring,
    Pool(JoinHandle<Result<Vec<u8>>>),
}

/// A read started early, in the window not being served. Only `span`'s first read takes it.
struct Ahead {
    span: FrameSpan,
    len: usize,
    pending: Pending,
}

pub struct ReadCtx {
    /// Try the page cache before escalating. False only under [`ReadMode::Uring`].
    probe: bool,
    #[cfg(feature = "uring")]
    ring: Ring,
    windows: [Vec<u8>; WINDOWS],
    cur: usize,
    ahead: Option<Ahead>,
    stats: ReadStats,
}

#[cfg(feature = "uring")]
impl Ring {
    /// Built on the first miss: safe because nothing is in flight on a ring that is absent.
    fn reader(&mut self, store: &FrameStore) -> Option<&mut UringReader> {
        if matches!(self, Self::Pending) {
            *self = match UringReader::new(store.file()) {
                Ok(reader) => Self::Ready(Box::new(reader)),
                Err(err) => {
                    warn!(%err, "io_uring unavailable; this session reads through the pool");
                    Self::Refused
                }
            };
        }
        match self {
            Self::Ready(reader) => Some(reader),
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
            ring: if wants_ring { Ring::Pending } else { Ring::Off },
            windows: [Vec::new(), Vec::new()],
            cur: 0,
            ahead: None,
            stats: ReadStats::default(),
        }
    }

    /// One window on a hit; **the rest of the frame on a miss**.
    ///
    /// `next`, where the caller knows it, is started before this read is waited on, so the
    /// device carries both. `docs/adr-frame-framing-and-loop-shape.md` §Serving depth.
    pub async fn read(
        &mut self,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        pos: u32,
        next: Option<FrameSpan>,
    ) -> Result<&[u8]> {
        let stride = store.read_window(span.len);
        let at = span.offset + u64::from(pos);
        let remaining = (span.len - pos) as usize;

        let take_ahead = pos == 0 && matches!(&self.ahead, Some(a) if a.span == span);
        let (pending, len) = if take_ahead {
            let ahead = self.ahead.take().expect("matched just above");
            self.cur ^= 1;
            (ahead.pending, ahead.len)
        } else {
            if pos == 0 {
                self.abandon_ahead().await?;
            }
            self.begin(store, self.cur, at, stride.min(remaining), remaining)?
        };

        if self.ahead.is_none() {
            if let Some(span) = next {
                self.begin_ahead(store, span)?;
            }
        }

        match pending {
            Pending::Ready => self.stats.hits += 1,
            _ => self.stats.misses += 1,
        }
        self.settle(pending, self.cur).await?;
        Ok(&self.windows[self.cur][..len])
    }

    /// Probe for `want` bytes into `slot` and escalate the shortfall without waiting.
    fn begin(
        &mut self,
        store: &Arc<FrameStore>,
        slot: usize,
        at: u64,
        want: usize,
        remaining: usize,
    ) -> Result<(Pending, usize)> {
        self.grow(slot, want);
        let hit = if self.probe {
            store.read_at_nowait(&mut self.windows[slot][..want], at)?
        } else {
            0
        };
        if hit == want {
            return Ok((Pending::Ready, want));
        }
        let rest = remaining - hit;
        self.grow(slot, hit + rest);
        let pending = self.escalate(store, slot, at + hit as u64, hit, rest)?;
        Ok((pending, hit + rest))
    }

    fn begin_ahead(&mut self, store: &Arc<FrameStore>, span: FrameSpan) -> Result<()> {
        let slot = self.cur ^ 1;
        let remaining = span.len as usize;
        let want = store.read_window(span.len).min(remaining);
        let (pending, len) = self.begin(store, slot, span.offset, want, remaining)?;
        self.ahead = Some(Ahead { span, len, pending });
        Ok(())
    }

    /// Waits before discarding: the kernel or the pool is still writing into that window.
    async fn abandon_ahead(&mut self) -> Result<()> {
        let Some(ahead) = self.ahead.take() else {
            return Ok(());
        };
        self.settle(ahead.pending, self.cur ^ 1).await
    }

    /// Ask for `len` bytes into `windows[slot][from..]`, returning before they arrive.
    fn escalate(
        &mut self,
        store: &Arc<FrameStore>,
        slot: usize,
        at: u64,
        from: usize,
        len: usize,
    ) -> Result<Pending> {
        #[cfg(feature = "uring")]
        {
            let Self { ring, windows, .. } = self;
            if let Some(reader) = ring.reader(store) {
                // SAFETY: `windows[slot]` is this session's own buffer. It is neither grown
                // nor read while its slot is busy — a slot is only started when it is idle,
                // and `settle` is what makes it idle again — and `Drop` waits for the kernel
                // if this session ends first.
                unsafe { reader.start(slot, &mut windows[slot][from..from + len], at) }?;
                return Ok(Pending::Ring);
            }
        }
        let store = Arc::clone(store);
        // The pool borrows the window for longer than this task holds `&mut self`.
        let mut window = std::mem::take(&mut self.windows[slot]);
        Ok(Pending::Pool(tokio::task::spawn_blocking(move || {
            store.read_at_blocking(&mut window[from..from + len], at)?;
            Ok(window)
        })))
    }

    async fn settle(&mut self, pending: Pending, slot: usize) -> Result<()> {
        match pending {
            Pending::Ready => Ok(()),
            #[cfg(feature = "uring")]
            Pending::Ring => match &mut self.ring {
                Ring::Ready(reader) => reader.finish(slot).await,
                _ => unreachable!("a ring read outlived its ring"),
            },
            Pending::Pool(join) => {
                self.windows[slot] = join.await.context("join frame read")??;
                Ok(())
            }
        }
    }

    /// Never called on a busy window — that would move the buffer out from under the kernel.
    fn grow(&mut self, slot: usize, need: usize) {
        if self.windows[slot].len() < need {
            self.windows[slot].resize(need, 0);
        }
    }

    pub fn stats(&self) -> ReadStats {
        self.stats
    }

    /// Test-only: a correct serial path returns the same bytes, so the overlap is
    /// otherwise unobservable.
    #[cfg(test)]
    pub(crate) fn ahead_for(&self) -> Option<FrameSpan> {
        self.ahead.as_ref().map(|a| a.span)
    }

    #[cfg(test)]
    pub(crate) fn serving_window(&self) -> usize {
        self.cur
    }

    /// The path actually taken, which is not always the one configured.
    pub fn ring_built(&self) -> bool {
        #[cfg(feature = "uring")]
        return matches!(self.ring, Ring::Ready(_));
        #[cfg(not(feature = "uring"))]
        return false;
    }
}

impl Drop for ReadCtx {
    /// Waits for the kernel before the windows are freed. Here rather than in the ring's own
    /// `Drop` because `Drop::drop` runs before any field is, so field order cannot break it.
    fn drop(&mut self) {
        #[cfg(feature = "uring")]
        if let Ring::Ready(ring) = &mut self.ring {
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

            let served = ctx.serving_window();
            let (out, _) = drain(&rt, &mut ctx, &store, 0, Some(1));
            assert_eq!(out, frame_pattern(0, LEN), "frame 0 on a {shape}");
            assert_eq!(
                ctx.ahead_for(),
                Some(store.frame_span(1).unwrap()),
                "frame 1's read was never started on a {shape}"
            );
            assert_eq!(
                ctx.serving_window(),
                served,
                "the frame in hand moved windows on a {shape}"
            );

            let (out, _) = drain(&rt, &mut ctx, &store, 1, None);
            assert_eq!(out, frame_pattern(1, LEN), "frame 1 on a {shape}");
            assert_eq!(
                ctx.serving_window(),
                served ^ 1,
                "frame 1 was re-read instead of taken from the window it landed in \
                 on a {shape}"
            );
            assert_eq!(ctx.ahead_for(), None, "an unasked-for read is still pending");
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

            drain(&rt, &mut ctx, &store, 0, Some(1));
            assert!(ctx.ahead_for().is_some(), "nothing to abandon on a {shape}");

            // Frame 2, not the hinted 1 — and hinting again, so the abandoned read's window
            // and ring slot have to be free by now rather than still owned by the kernel.
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
            assert_eq!(ctx.ahead_for(), None, "the abandoned read is still recorded");
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
        // A real partial hit: the seam between the two is where the arithmetic lives.
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
}
