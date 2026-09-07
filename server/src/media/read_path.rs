//! Per-session read state: one window, and a ring that exists only once this session has
//! actually missed.
//!
//! This is `hybrid_lazyring` — the arm the read-path campaign chose. On a page-cache hit it
//! is exactly the path that shipped before it (`preadv2(RWF_NOWAIT)` inline, no ring work at
//! all); on a miss it finishes the read through io_uring instead of a `spawn_blocking` round
//! trip, which the campaign prices at **24–34 µs on four hosts**.
//!
//! A session that never misses never builds a ring, so the change is inert by design on a
//! hit-dominated workload rather than by configuration. See
//! `docs/disk-access/IMPLEMENTATION.md`.
//!
//! ## The trap this is shaped around
//!
//! On a filesystem that refuses `RWF_NOWAIT` — overlayfs, tmpfs, i.e. **any container
//! serving studies from its own layer** (`docs/disk-access/DEPLOYMENT.md`) —
//! `read_at_nowait` returns `0` for *every* read, hit or miss, because the flag is refused
//! and not because the bytes are cold. A ring keyed naively on "the inline read came up
//! short" would build one on the first ask and then serve **every warm read through it**.
//! That is the `uring` arm, measured at **+131 to +142% on hits**: it would make the
//! container case significantly worse than doing nothing.
//!
//! So the ring is gated on [`FrameStore::nowait_supported`], not on the shortfall alone.

use crate::media::frame_store::FrameStore;
use anyhow::{Context, Result};
use std::sync::Arc;
use tracing::warn;

#[cfg(feature = "uring")]
use crate::media::uring_reader::UringReader;

/// Which read path a session takes, resolved once per process from `WTPACS_READ_PATH`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ReadMode {
    /// `hybrid_lazyring`: inline hit, ring on the miss where the filesystem and kernel
    /// allow one. The shipping path.
    #[default]
    Auto,
    /// **Kill switch.** The pre-change path: inline hit, `spawn_blocking` on the miss. An
    /// operational escape from a ring misbehaving in production, and it costs nothing to
    /// keep because it is the code that shipped before.
    Pool,
    /// **Lab lever, not a production mode.** No inline probe at all: every read goes
    /// through the ring, whole frame at a time. This is the `uring` arm, measured
    /// **+131 to +142% CPU on hits** — it exists so tile-based layouts can be experimented
    /// with against a genuinely miss-optimised path, and nothing routes traffic here.
    Uring,
}

impl ReadMode {
    /// Read `WTPACS_READ_PATH`. An unset or unrecognised value is [`Auto`](Self::Auto); an
    /// unrecognised one also warns, because a typo in a kill switch that silently does
    /// nothing is the worst possible outcome for a kill switch.
    pub fn from_env() -> Self {
        match std::env::var("WTPACS_READ_PATH").as_deref() {
            Ok("pool") => Self::Pool,
            Ok("uring") => Self::Uring,
            Ok("auto") | Err(_) => Self::Auto,
            Ok(other) => {
                warn!(
                    value = other,
                    "WTPACS_READ_PATH is not one of auto|pool|uring; using auto"
                );
                Self::Auto
            }
        }
    }
}

/// A ring is built at most once per session, and never again if the kernel refuses.
#[cfg(feature = "uring")]
enum Ring {
    Untried,
    Ready(Box<UringReader>),
    /// io_uring is unavailable here — an old kernel, a seccomp filter, or
    /// `kernel.io_uring_disabled`. Recorded so the next miss does not try again.
    Unavailable,
}

/// One session's read state.
pub struct ReadCtx {
    /// Without the `uring` feature every mode reads through the pool, so nothing consults
    /// this — which is the point: the kill switch cannot change behaviour that has only one
    /// behaviour.
    #[cfg_attr(not(feature = "uring"), allow(dead_code))]
    mode: ReadMode,
    /// Declared before `window` so the drop order reads correctly, though `Drop for
    /// ReadCtx` is what actually guarantees it — see there.
    #[cfg(feature = "uring")]
    ring: Ring,
    /// One reusable buffer for the whole session — not a buffer per frame, and not a
    /// whole-frame envelope. It grows to the largest frame this session escalates on.
    window: Vec<u8>,
}

impl ReadCtx {
    pub fn new(mode: ReadMode) -> Self {
        Self {
            mode,
            #[cfg(feature = "uring")]
            ring: Ring::Untried,
            window: Vec::new(),
        }
    }

    /// Bytes filled by the last [`fill`](Self::fill).
    pub fn window(&self) -> &[u8] {
        &self.window
    }

    /// Fill the front of the window from the frame, and say how much is ready.
    ///
    /// The window is taken from the page cache with `read_at_nowait`, which returns short
    /// instead of waiting on disk — so no ask can park this executor thread on I/O the way
    /// a major fault on an mmap'd slice does.
    ///
    /// **A miss reads the rest of the frame, not the rest of the window.** The window
    /// bounds how long the executor copies without yielding, and that argument applies only
    /// to the inline read, which happens on a *hit*. The escalation runs off the executor,
    /// where a large read costs no more than a small one and a small one costs a whole
    /// extra round trip. Measured on a fixture where a miss is a real device read: windowing
    /// the escalation too costs 2–3 round trips per 250 KB frame instead of one, which is
    /// **2.1× the throughput at one session and 3.0–3.2× at 8, 16 and 32**
    /// (`docs/disk-access/RERUN-miss.md`). The axis is inside io_uring too — whole-frame
    /// ring reads beat windowed ones by the same mechanism.
    ///
    /// Returns `stride.min(remaining)` on a hit and `remaining` on a miss, so **the caller
    /// must advance by the return value, not by what it asked for.**
    pub async fn fill(
        &mut self,
        store: &Arc<FrameStore>,
        at: u64,
        stride: usize,
        remaining: usize,
    ) -> Result<usize> {
        // The lab lever: no inline probe, straight to the ring, whole frame at a time.
        #[cfg(feature = "uring")]
        if self.mode == ReadMode::Uring {
            self.grow(remaining);
            if self.read_through_ring(store, at, 0, remaining).await? {
                return Ok(remaining);
            }
            // The ring is unavailable on this host; fall through to the measured path
            // rather than failing the ask.
        }

        let want = stride.min(remaining);
        self.grow(want);
        let got = store.read_at_nowait(&mut self.window[..want], at)?;
        if got == want {
            return Ok(want);
        }

        // Missed. Everything still outstanding in the frame is fetched together.
        let rest = remaining - got;
        self.grow(got + rest);

        #[cfg(feature = "uring")]
        if self.ring_allowed(store) && self.read_through_ring(store, at, got, rest).await? {
            return Ok(got + rest);
        }

        // `spawn_blocking`: the pre-change path, the kill switch, and the fallback wherever
        // a ring is not allowed or not available.
        let store = Arc::clone(store);
        let mut owned = std::mem::take(&mut self.window);
        owned = tokio::task::spawn_blocking(move || {
            store.read_at_blocking(&mut owned[got..got + rest], at + got as u64)?;
            Ok::<Vec<u8>, anyhow::Error>(owned)
        })
        .await
        .context("join frame read")??;
        self.window = owned;
        Ok(got + rest)
    }

    fn grow(&mut self, need: usize) {
        if self.window.len() < need {
            self.window.resize(need, 0);
        }
    }

    /// May this session finish a miss through a ring?
    ///
    /// `nowait_supported` is the gate, not the shortfall: see the module header. `Pool` is
    /// the kill switch, and `Uring` has already taken its own path above.
    #[cfg(feature = "uring")]
    fn ring_allowed(&self, store: &FrameStore) -> bool {
        self.mode == ReadMode::Auto && store.nowait_supported()
    }

    /// Read `len` bytes at `at + skip` into `window[skip..skip + len]`, building the ring if
    /// this session has not needed one yet.
    ///
    /// Returns `false` — having read nothing — when io_uring is unavailable on this host, so
    /// the caller falls back instead of failing the ask. Constructing mid-frame is safe
    /// because nothing can be in flight on a ring that does not exist yet.
    #[cfg(feature = "uring")]
    async fn read_through_ring(
        &mut self,
        store: &FrameStore,
        at: u64,
        skip: usize,
        len: usize,
    ) -> Result<bool> {
        if matches!(self.ring, Ring::Untried) {
            self.ring = match UringReader::new(store.file()) {
                Ok(r) => Ring::Ready(Box::new(r)),
                Err(err) => {
                    // Not an error for the ask: an old kernel, a seccomp filter or
                    // `kernel.io_uring_disabled` all land here, and the pooled path serves
                    // correctly on every one of them.
                    warn!(%err, "io_uring unavailable; this session reads through the pool");
                    Ring::Unavailable
                }
            };
        }
        let Ring::Ready(ring) = &mut self.ring else {
            return Ok(false);
        };
        ring.read_exact_at(&mut self.window[skip..skip + len], at + skip as u64)
            .await?;
        Ok(true)
    }

    /// Whether this session has a ring. Tests assert on it; nothing else should care.
    #[cfg(all(test, feature = "uring"))]
    pub(crate) fn has_ring(&self) -> bool {
        matches!(self.ring, Ring::Ready(_))
    }
}

impl Drop for ReadCtx {
    /// Finish any read the kernel is still performing into `window`.
    ///
    /// A session task is `tokio::spawn`ed, so it is dropped at its await point when the
    /// runtime shuts down — and the ring parks on exactly one await. Dropping there with a
    /// read in flight would leave the kernel writing into a buffer about to be freed.
    ///
    /// This lives here, rather than relying on the ring's own `Drop` plus field order,
    /// because a struct's `Drop::drop` runs **before any of its fields are dropped**. That
    /// makes the guarantee independent of the order the fields happen to be declared in —
    /// which is otherwise a silent, compiler-invisible correctness dependency sitting one
    /// careless reorder away from memory corruption.
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

    /// A study bundle on disk with `frames` frames of `len` bytes, each filled with a
    /// per-frame pattern so a mis-assembled frame cannot pass by accident.
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

    /// Run `stream_codestream`'s loop against a buffer, returning what came out and **how
    /// many fills it took**. The loop is copied rather than shared: that duplication is what
    /// lets this test the read path with no sink abstraction and no QUIC connection.
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
        let mut fills = 0usize;
        while pos < span.len {
            let remaining = (span.len - pos) as usize;
            let at = span.offset + u64::from(pos);
            let ready = rt
                .block_on(ctx.fill(store, at, stride, remaining))
                .expect("fill");
            assert!(ready > 0, "a fill that returns 0 would spin forever");
            fills += 1;
            out.extend_from_slice(&ctx.window()[..ready]);
            pos += ready as u32;
        }
        (out, fills)
    }

    const STRIDE: usize = 4096;
    const LEN: u32 = (STRIDE * 5 + 17) as u32;

    /// **The ADR's claim, as an assertion.** A window that misses reads to the end of the
    /// *frame*, not the end of the window — so a frame that misses costs one round trip
    /// however many windows long it is. Windowing the escalation too costs 2–3 per 250 KB
    /// frame, and that is where the miss-path throughput went: 1 404–1 573 f/s against
    /// 4 539–4 777 (`docs/disk-access/RERUN-miss.md`).
    ///
    /// Misses are forced through the store's test levers rather than by evicting the page
    /// cache. Eviction is not a lever a test can rely on — `fadvise(DONTNEED)` will not
    /// evict a mapped page, and on some hosts it does not evict even before the mapping
    /// exists, which silently leaves a test like this on the warm path where it passes
    /// against a deliberately broken implementation.
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
                let mut ctx = ReadCtx::new(mode);
                for idx in 0..3u32 {
                    let (out, fills) = drain(&rt, &mut ctx, &store, idx, STRIDE);
                    assert_eq!(
                        out,
                        frame_pattern(idx, LEN),
                        "frame {idx} came back wrong on a {shape} under {mode:?}"
                    );
                    assert_eq!(
                        fills, 1,
                        "frame {idx} is 6 windows long and took {fills} round trips on a \
                         {shape} under {mode:?}, not 1"
                    );
                }
            }
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Assembly across the window boundary, on every branch of `fill`, at the lengths most
    /// likely to be off by one.
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
                    let mut ctx = ReadCtx::new(mode);
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

    /// An unrecognised value must not silently become a mode nobody asked for — and must
    /// not disable the kill switch either.
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
            // SAFETY-adjacent: this test owns the variable for its duration. It is the only
            // test that touches it, and the others construct `ReadMode` directly.
            std::env::set_var("WTPACS_READ_PATH", value);
            assert_eq!(ReadMode::from_env(), want, "WTPACS_READ_PATH={value:?}");
        }
        std::env::remove_var("WTPACS_READ_PATH");
        assert_eq!(ReadMode::from_env(), ReadMode::Auto, "unset");
    }

    /// **The arm's whole point.** A session that never misses never builds a ring, so on a
    /// hit-dominated workload this change is inert by design rather than by configuration.
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
        let mut ctx = ReadCtx::new(ReadMode::Auto);
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

    /// **The container trap.** Where `RWF_NOWAIT` is refused, every read reports a miss
    /// because the flag is refused and not because the bytes are cold. A ring keyed on the
    /// shortfall alone would be built on the first ask and then serve every *warm* read —
    /// the `uring` arm, measured +131 to +142% on hits. The gate is `nowait_supported`, so
    /// no ring appears here at all.
    #[test]
    #[cfg(feature = "uring")]
    fn lazy_ring_is_never_built_without_nowait() {
        let dir = scratch("nonowait");
        let path = write_bundle(&dir, 3, LEN);
        let mut store = FrameStore::open(&path).expect("open store");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Auto);
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

    /// The prefix from the inline read plus the remainder from the ring is the frame —
    /// mirroring the existing `spawn_blocking` composition test in `frame_store`, on the
    /// path that replaces it.
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
        // A real partial hit: the front of each window arrives inline, the rest must come
        // from the ring, and the seam between them is where the offset arithmetic lives.
        store.force_short_reads(STRIDE / 3);
        let store = Arc::new(store);
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Auto);
        for idx in 0..3u32 {
            let (out, fills) = drain(&rt, &mut ctx, &store, idx, STRIDE);
            assert_eq!(out, frame_pattern(idx, LEN), "frame {idx} did not compose");
            assert_eq!(
                fills, 1,
                "the ring read the rest of the frame, not the window"
            );
        }
        assert!(ctx.has_ring(), "the miss path never reached the ring");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The lab lever skips the inline probe entirely and reads every frame through the
    /// ring. It is not a production mode; this pins that it works, so a layout experiment
    /// measures the `uring` arm and not a broken one.
    #[test]
    #[cfg(feature = "uring")]
    fn the_uring_lever_serves_whole_frames_through_the_ring() {
        let dir = scratch("lever");
        let path = write_bundle(&dir, 3, LEN);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        let rt = rt();
        let mut ctx = ReadCtx::new(ReadMode::Uring);
        for idx in 0..3u32 {
            let (out, fills) = drain(&rt, &mut ctx, &store, idx, STRIDE);
            assert_eq!(out, frame_pattern(idx, LEN), "frame {idx} came back wrong");
            assert_eq!(fills, 1, "the lever reads whole frames, not windows");
        }
        assert!(ctx.has_ring(), "the lever never built a ring");
        std::fs::remove_dir_all(&dir).ok();
    }
}
