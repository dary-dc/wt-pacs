//! How a session reads frame bytes: page cache on the executor, ring or pool on a miss.
//! Shape and numbers: `docs/disk-access/adr.md`, `docs/disk-access/IMPLEMENTATION.md`.

use crate::media::frame_store::FrameStore;
use anyhow::{Context, Result};
use std::sync::Arc;
use tracing::warn;

#[cfg(feature = "uring")]
use crate::media::uring_reader::UringReader;

/// From `WTPACS_READ_PATH`. Unknown values warn and fall back to [`Auto`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ReadMode {
    /// Page cache first, ring on the miss. The shipping path.
    #[default]
    Auto,
    /// Kill switch: page cache first, blocking pool on the miss. Never a ring.
    Pool,
    /// Lab lever, not a production mode: skip the page-cache probe, every frame through
    /// the ring.
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

/// Built on the first miss and never rebuilt.
#[cfg(feature = "uring")]
enum Ring {
    Off,
    Pending,
    Ready(Box<UringReader>),
    /// Kernel refused a ring. Recorded so the next miss does not retry.
    Refused,
}

/// One session's read state.
pub struct ReadCtx {
    /// False only under [`ReadMode::Uring`]. Where the filesystem refuses `RWF_NOWAIT`
    /// this stays true and every read comes up short — same effect, different route.
    probe: bool,
    #[cfg(feature = "uring")]
    ring: Ring,
    /// Grows to the largest frame this session has escalated on.
    window: Vec<u8>,
}

#[cfg(feature = "uring")]
impl Ring {
    /// Build on the first miss. `None` if a ring is not wanted or was refused — the
    /// caller then uses the pool rather than failing the ask.
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
    /// Resolve the mode once so the read loop has no mode to branch on.
    ///
    /// No ring where `RWF_NOWAIT` is refused: every read reports a miss there, hit or
    /// cold, and a ring keyed on the shortfall would serve every warm read.
    /// `IMPLEMENTATION.md` §The trap.
    #[cfg_attr(not(feature = "uring"), allow(unused_variables))]
    pub fn new(mode: ReadMode, store: &FrameStore) -> Self {
        // Exhaustive: a new mode has to decide this rather than inherit it.
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
            window: Vec::new(),
        }
    }

    /// Read the next piece of a frame.
    ///
    /// `stride` is the page-cache attempt; `remaining` is what is left of the frame.
    /// A hit returns `stride` bytes. A miss returns the whole of `remaining` — one
    /// round trip per frame, not per window (`RERUN-miss.md`).
    pub async fn read(
        &mut self,
        store: &Arc<FrameStore>,
        at: u64,
        stride: usize,
        remaining: usize,
    ) -> Result<&[u8]> {
        let want = stride.min(remaining);
        self.grow(want);
        let hit = if self.probe {
            store.read_at_nowait(&mut self.window[..want], at)?
        } else {
            0
        };
        if hit == want {
            return Ok(&self.window[..want]);
        }

        let rest = remaining - hit;
        self.grow(hit + rest);
        self.escalate(store, at + hit as u64, hit, rest).await?;
        Ok(&self.window[..hit + rest])
    }

    async fn escalate(
        &mut self,
        store: &Arc<FrameStore>,
        at: u64,
        from: usize,
        len: usize,
    ) -> Result<()> {
        #[cfg(feature = "uring")]
        {
            // Split the borrow: the ring writes into the window.
            let Self { ring, window, .. } = self;
            if let Some(reader) = ring.reader(store) {
                return reader
                    .read_exact_at(&mut window[from..from + len], at)
                    .await;
            }
        }
        self.read_on_pool(store, at, from, len).await
    }

    /// Move the window to the blocking pool and back: the read borrows it longer than
    /// this task holds `&mut self`.
    async fn read_on_pool(
        &mut self,
        store: &Arc<FrameStore>,
        at: u64,
        from: usize,
        len: usize,
    ) -> Result<()> {
        let store = Arc::clone(store);
        let mut window = std::mem::take(&mut self.window);
        window = tokio::task::spawn_blocking(move || {
            store.read_at_blocking(&mut window[from..from + len], at)?;
            Ok::<Vec<u8>, anyhow::Error>(window)
        })
        .await
        .context("join frame read")??;
        self.window = window;
        Ok(())
    }

    fn grow(&mut self, need: usize) {
        if self.window.len() < need {
            self.window.resize(need, 0);
        }
    }

    #[cfg(all(test, feature = "uring"))]
    pub(crate) fn has_ring(&self) -> bool {
        matches!(self.ring, Ring::Ready(_))
    }
}

impl Drop for ReadCtx {
    /// Wait for any kernel write still targeting `window`.
    ///
    /// Session tasks are dropped at an await on shutdown; the ring parks on exactly one.
    /// Lives here rather than on the ring alone because a struct's `Drop` runs before
    /// its fields, so the guarantee does not depend on field order.
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
    use std::io::Write;

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

    /// `stream_codestream`'s loop against a buffer: what came out, and how many reads.
    /// Copied rather than shared so this can run with no QUIC connection.
    fn drain(
        rt: &tokio::runtime::Runtime,
        ctx: &mut ReadCtx,
        store: &Arc<FrameStore>,
        idx: u32,
        stride: usize,
    ) -> (Vec<u8>, usize) {
        let span = store.frame_span(idx).expect("span");
        let mut out: Vec<u8> = Vec::new();
        let mut pos = 0u32;
        let mut reads = 0usize;
        while pos < span.len {
            let remaining = (span.len - pos) as usize;
            let at = span.offset + u64::from(pos);
            let ready = rt
                .block_on(ctx.read(store, at, stride, remaining))
                .expect("read");
            assert!(!ready.is_empty(), "an empty read would spin forever");
            reads += 1;
            out.extend_from_slice(ready);
            pos += ready.len() as u32;
        }
        (out, reads)
    }

    const STRIDE: usize = 4096;
    const LEN: u32 = (STRIDE * 5 + 17) as u32;

    /// A miss reads to the end of the frame, not the window. Misses are forced through
    /// the store's test levers — `fadvise(DONTNEED)` is not a reliable eviction.
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
                    _ => store.force_short_reads(STRIDE / 3),
                }
                let store = Arc::new(store);
                let mut ctx = ReadCtx::new(mode, &store);
                for idx in 0..3u32 {
                    let (out, reads) = drain(&rt, &mut ctx, &store, idx, STRIDE);
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

    #[test]
    fn refilling_reassembles_every_frame_whatever_the_read_path() {
        let dir = scratch("fill");
        let rt = rt();
        for &len in &[
            1u32,
            (STRIDE - 1) as u32,
            STRIDE as u32,
            (STRIDE + 1) as u32,
            (STRIDE * 3 + 17) as u32,
            crate::media::frame_store::READ_WINDOW as u32,
        ] {
            let path = write_bundle(&dir, 3, len);
            for shape in ["hit", "total miss", "partial hit"] {
                for mode in [ReadMode::Auto, ReadMode::Pool, ReadMode::Uring] {
                    let mut store = FrameStore::open(&path).expect("open store");
                    match shape {
                        "hit" => {}
                        "total miss" => store.force_pool_reads(),
                        _ => store.force_short_reads(STRIDE / 3),
                    }
                    let store = Arc::new(store);
                    let mut ctx = ReadCtx::new(mode, &store);
                    for idx in 0..3u32 {
                        let (out, _) = drain(&rt, &mut ctx, &store, idx, STRIDE);
                        assert_eq!(
                            out,
                            frame_pattern(idx, len),
                            "frame {idx} of length {len} came back wrong on a {shape} \
                             under {mode:?}"
                        );
                    }
                }
            }
            std::fs::remove_file(&path).ok();
        }
        std::fs::remove_dir_all(&dir).ok();
    }

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
            // This test owns the variable for its duration; others construct `ReadMode` directly.
            std::env::set_var("WTPACS_READ_PATH", value);
            assert_eq!(ReadMode::from_env(), want, "WTPACS_READ_PATH={value:?}");
        }
        std::env::remove_var("WTPACS_READ_PATH");
        assert_eq!(ReadMode::from_env(), ReadMode::Auto, "unset");
    }

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
            let (out, _) = drain(&rt, &mut ctx, &store, idx, STRIDE);
            assert_eq!(out, frame_pattern(idx, LEN));
        }
        assert!(
            !ctx.has_ring(),
            "a session that only ever hit the page cache built a ring anyway"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Where `RWF_NOWAIT` is refused, every read reports a miss. A ring keyed on the
    /// shortfall would then serve every warm read.
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
            let (out, _) = drain(&rt, &mut ctx, &store, idx, STRIDE);
            assert_eq!(out, frame_pattern(idx, LEN), "the pooled path still serves");
        }
        assert!(
            !ctx.has_ring(),
            "a ring was built on a filesystem that refuses RWF_NOWAIT — every warm read \
             would now go through it"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

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
        store.force_short_reads(STRIDE / 3);
        let store = Arc::new(store);
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Auto, &store);
        for idx in 0..3u32 {
            let (out, reads) = drain(&rt, &mut ctx, &store, idx, STRIDE);
            assert_eq!(out, frame_pattern(idx, LEN), "frame {idx} did not compose");
            assert_eq!(
                reads, 1,
                "the ring read the rest of the frame, not the window"
            );
        }
        assert!(ctx.has_ring(), "the miss path never reached the ring");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    #[cfg(feature = "uring")]
    fn the_uring_lever_serves_whole_frames_through_the_ring() {
        let dir = scratch("lever");
        let path = write_bundle(&dir, 3, LEN);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Uring, &store);
        for idx in 0..3u32 {
            let (out, reads) = drain(&rt, &mut ctx, &store, idx, STRIDE);
            assert_eq!(out, frame_pattern(idx, LEN), "frame {idx} came back wrong");
            assert_eq!(reads, 1, "the lever reads whole frames, not windows");
        }
        assert!(ctx.has_ring(), "the lever never built a ring");
        std::fs::remove_dir_all(&dir).ok();
    }
}
