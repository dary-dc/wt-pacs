//! Two readers, chosen by what the session is doing.
//!
//! A fill knows the frame after this one and starts it underneath; a tile ask does not, and
//! is a miss by nature. That difference picks the escalation — the blocking pool for a fill,
//! whose misses are rare, and a ring for tiles, whose queue would otherwise be OS threads.
//! `docs/disk-access/adr.md`.

use crate::media::frame_store::{FrameSpan, FrameStore};
use anyhow::{Context, Result};
use std::mem;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tracing::warn;

#[cfg(feature = "uring")]
use crate::media::uring_reader::UringReader;

/// Frames a tile session holds at once, and its ring depth. `docs/disk-access/adr.md`.
pub const TILE_SLOTS: usize = 4;

/// Which escalation a tile session takes, from `WTPACS_READ_PATH`.
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

/// Counted per frame. `docs/disk-access/IMPLEMENTATION.md` §Reporting.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReadStats {
    pub hits: u64,
    pub misses: u64,
    pub peak_named: u16,
    /// Most reads outstanding at once — what the device saw.
    pub peak_in_flight: u16,
}

impl ReadStats {
    pub fn miss_rate(&self) -> Option<f64> {
        let total = self.hits + self.misses;
        (total > 0).then(|| self.misses as f64 / total as f64)
    }
}

fn fit(buf: &mut Vec<u8>, need: usize) {
    if buf.len() < need {
        buf.resize(need, 0);
    }
}

/// Probe the page cache for the whole frame; hand any shortfall to the blocking pool.
fn start_pooled(store: &Arc<FrameStore>, span: FrameSpan, mut buf: Vec<u8>) -> Result<Ahead> {
    let len = span.len as usize;
    fit(&mut buf, len);
    let hit = store.read_at_nowait(&mut buf[..len], span.offset)?;
    if hit == len {
        return Ok(Ahead::Ready { span, buf });
    }
    #[cfg(test)]
    let start = store.account_pool_start();
    let store = Arc::clone(store);
    let at = span.offset + hit as u64;
    Ok(Ahead::InFlight {
        span,
        join: tokio::task::spawn_blocking(move || {
            #[cfg(test)]
            store.wait_pool_start(start);
            store.read_at_blocking(&mut buf[hit..len], at)?;
            Ok(buf)
        }),
    })
}

/// A frame's read: parked, landed inline, or still with the pool.
enum Ahead {
    Idle(Vec<u8>),
    Ready {
        span: FrameSpan,
        buf: Vec<u8>,
    },
    InFlight {
        span: FrameSpan,
        join: JoinHandle<Result<Vec<u8>>>,
    },
}

/// **The fill reader.** Two buffers, because the next frame is known rather than guessed,
/// and no ring: a sequential walk is read-ahead's best case and misses about one read in
/// sixty. `docs/disk-access/EVIDENCE.md` §Fill at scale.
pub struct SeqReader {
    cur: Vec<u8>,
    ahead: Ahead,
    stats: ReadStats,
}

impl Default for SeqReader {
    fn default() -> Self {
        Self::new()
    }
}

impl SeqReader {
    pub fn new() -> Self {
        Self {
            cur: Vec::new(),
            ahead: Ahead::Idle(Vec::new()),
            stats: ReadStats::default(),
        }
    }

    /// The whole of `span`. `next` is the frame the planner will ask for after it, and its
    /// read is running by the time this returns.
    pub async fn read(
        &mut self,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        next: Option<FrameSpan>,
    ) -> Result<&[u8]> {
        let (held, spare) = self.settle().await?;
        let (spare, missed) = match held {
            Some((s, was_miss)) if s == span => {
                self.count(was_miss);
                (mem::replace(&mut self.cur, spare), was_miss)
            }
            _ => {
                let buf = mem::take(&mut self.cur);
                let (buf, was_miss) = match start_pooled(store, span, buf)? {
                    Ahead::Ready { buf, .. } => (buf, false),
                    Ahead::InFlight { join, .. } => (join.await.context("join frame read")??, true),
                    Ahead::Idle(buf) => (buf, false),
                };
                self.count(was_miss);
                self.cur = buf;
                (spare, was_miss)
            }
        };
        self.ahead = match next {
            Some(next) => start_pooled(store, next, spare)?,
            None => Ahead::Idle(spare),
        };
        if missed || matches!(self.ahead, Ahead::InFlight { .. }) {
            if let Some(n) = next {
                store.advise_readahead(n.offset + u64::from(n.len), u64::from(n.len));
            }
        }
        self.stats.peak_named = self.stats.peak_named.max(1 + u16::from(next.is_some()));
        self.stats.peak_in_flight = self
            .stats
            .peak_in_flight
            .max(u16::from(matches!(self.ahead, Ahead::InFlight { .. })));
        Ok(&self.cur[..span.len as usize])
    }

    /// Awaits whatever the last call started, so its buffer can be reused whether or not
    /// this frame is the one it holds.
    async fn settle(&mut self) -> Result<(Option<(FrameSpan, bool)>, Vec<u8>)> {
        Ok(
            match mem::replace(&mut self.ahead, Ahead::Idle(Vec::new())) {
                Ahead::Idle(buf) => (None, buf),
                Ahead::Ready { span, buf } => (Some((span, false)), buf),
                Ahead::InFlight { span, join } => {
                    (Some((span, true)), join.await.context("join read-ahead")??)
                }
            },
        )
    }

    fn count(&mut self, missed: bool) {
        if missed {
            self.stats.misses += 1;
        } else {
            self.stats.hits += 1;
        }
    }

    pub fn stats(&self) -> ReadStats {
        self.stats
    }
}

/// The session's ring, built on its first miss and never rebuilt.
#[cfg(feature = "uring")]
enum Ring {
    /// Never wanted, or refused once — both mean the pool.
    Off,
    Wanted,
    Built(Box<UringReader>),
}

#[cfg(feature = "uring")]
impl Ring {
    /// Built on the first miss: safe because nothing is in flight on a ring that is absent.
    fn build_on_first_miss(
        &mut self,
        store: &FrameStore,
        slots: usize,
    ) -> Option<&mut UringReader> {
        if matches!(self, Self::Wanted) {
            *self = match UringReader::new(store.file(), slots as u32) {
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

/// A buffer, the frame it holds, and the one read at most still landing in it.
struct Slot {
    key: Option<FrameSpan>,
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

/// **The tile reader.** A scattered ask is a miss by nature, so its queue is the ring's
/// submissions rather than one blocked thread per outstanding read.
pub struct TileReader {
    /// Try the page cache before escalating. False only under [`ReadMode::Uring`].
    probe: bool,
    #[cfg(feature = "uring")]
    ring: Ring,
    slots: Vec<Slot>,
    last: usize,
    stats: ReadStats,
    #[cfg(test)]
    inflight_waits: usize,
}

impl TileReader {
    /// Without `RWF_NOWAIT` a ring keyed on the shortfall would serve every *warm* read
    /// too — `docs/disk-access/IMPLEMENTATION.md` §The trap.
    #[cfg_attr(not(feature = "uring"), allow(unused_variables))]
    pub fn new(mode: ReadMode, store: &FrameStore, slots: usize) -> Self {
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
            slots: (0..slots.max(1))
                .map(|_| Slot {
                    key: None,
                    buf: Vec::new(),
                    at: 0,
                    len: 0,
                    filled: 0,
                    miss: false,
                    read: None,
                })
                .collect(),
            last: 0,
            stats: ReadStats::default(),
            #[cfg(test)]
            inflight_waits: 0,
        }
    }

    /// Current first. Upcoming only on a slot that is free now; else `readahead`.
    /// `docs/disk-access/adr.md`.
    pub async fn read(
        &mut self,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        upcoming: &[FrameSpan],
    ) -> Result<&[u8]> {
        let named = 1 + upcoming.len().min(self.slots.len() - 1);
        self.stats.peak_named = self.stats.peak_named.max(named as u16);
        for i in 0..named {
            let want = if i == 0 { span } else { upcoming[i - 1] };
            if self.holding(want).is_some() {
                continue;
            }
            if i == 0 {
                let w = self.free_slot(span, upcoming);
                self.wait(w).await?;
                self.begin(store, w, want)?;
            } else if let Some(w) = self.ready_slot(span, upcoming) {
                self.begin(store, w, want)?;
            } else {
                store.advise_readahead(want.offset, u64::from(want.len));
            }
        }
        let started = self.slots.iter().filter(|s| s.read.is_some()).count() as u16;
        self.stats.peak_in_flight = self.stats.peak_in_flight.max(started);
        let w = self.holding(span).expect("started above");
        self.wait(w).await?;
        self.last = w;
        if self.slots[w].miss {
            self.stats.misses += 1;
        } else {
            self.stats.hits += 1;
        }
        Ok(&self.slots[w].buf[..self.slots[w].len])
    }

    fn holding(&self, span: FrameSpan) -> Option<usize> {
        self.slots.iter().position(|s| s.key == Some(span))
    }

    fn evictable(slot: &Slot, span: FrameSpan, upcoming: &[FrameSpan], reach: usize) -> bool {
        match slot.key {
            None => true,
            Some(k) => k != span && !upcoming.iter().take(reach).any(|&u| u == k),
        }
    }

    fn ready_slot(&self, span: FrameSpan, upcoming: &[FrameSpan]) -> Option<usize> {
        let reach = self.slots.len() - 1;
        self.slots
            .iter()
            .position(|s| s.read.is_none() && Self::evictable(s, span, upcoming, reach))
    }

    fn free_slot(&self, span: FrameSpan, upcoming: &[FrameSpan]) -> usize {
        let reach = self.slots.len() - 1;
        self.ready_slot(span, upcoming)
            .or_else(|| {
                self.slots
                    .iter()
                    .position(|s| Self::evictable(s, span, upcoming, reach))
            })
            .expect("at most one slot per named frame")
    }

    /// Probe the whole frame without waiting; on a shortfall ask for what is missing.
    fn begin(&mut self, store: &Arc<FrameStore>, w: usize, span: FrameSpan) -> Result<()> {
        let len = span.len as usize;
        fit(&mut self.slots[w].buf, len);
        let hit = if self.probe {
            store.read_at_nowait(&mut self.slots[w].buf[..len], span.offset)?
        } else {
            0
        };
        let slot = &mut self.slots[w];
        slot.key = Some(span);
        slot.at = span.offset;
        slot.len = len;
        slot.filled = hit;
        slot.miss = hit != len;
        if !slot.miss {
            return Ok(());
        }
        let pending = self.escalate(store, w)?;
        self.slots[w].read = Some(pending);
        Ok(())
    }

    /// The ring if this session has one, the pool otherwise. Neither is waited on here.
    fn escalate(&mut self, store: &Arc<FrameStore>, w: usize) -> Result<InFlight> {
        #[cfg(feature = "uring")]
        {
            let slots = self.slots.len();
            let Self { ring, slots: s, .. } = self;
            if let Some(reader) = ring.build_on_first_miss(store, slots) {
                let slot = &mut s[w];
                // SAFETY: `slot.buf` is neither grown, read nor dropped while `slot.read` is
                // `Some`; `wait` clears it, and `Drop` drains the ring before the slots go.
                unsafe {
                    reader.submit(
                        w,
                        &mut slot.buf[slot.filled..slot.len],
                        slot.at + slot.filled as u64,
                    )
                }?;
                return Ok(InFlight::Ring);
            }
        }
        #[cfg(test)]
        let start = store.account_pool_start();
        let store = Arc::clone(store);
        let slot = &mut self.slots[w];
        let (from, len, at) = (slot.filled, slot.len, slot.at);
        let mut buf = mem::take(&mut slot.buf);
        Ok(InFlight::Pool(tokio::task::spawn_blocking(move || {
            #[cfg(test)]
            store.wait_pool_start(start);
            store.read_at_blocking(&mut buf[from..len], at + from as u64)?;
            Ok(buf)
        })))
    }

    async fn wait(&mut self, w: usize) -> Result<()> {
        #[cfg(test)]
        if self.slots[w].read.is_some() {
            self.inflight_waits += 1;
        }
        match self.slots[w].read.take() {
            None => Ok(()),
            Some(InFlight::Pool(join)) => {
                self.slots[w].buf = join.await.context("join frame read")??;
                self.slots[w].filled = self.slots[w].len;
                Ok(())
            }
            #[cfg(feature = "uring")]
            Some(InFlight::Ring) => {
                self.slots[w].read = Some(InFlight::Ring);
                let Self {
                    ring: Ring::Built(ring),
                    slots,
                    ..
                } = self
                else {
                    unreachable!("a ring read outlived its ring")
                };
                while slots[w].read.is_some() {
                    for (slot, landed) in ring.reap()? {
                        let s = &mut slots[slot];
                        s.filled += landed;
                        if s.filled == s.len {
                            s.read = None;
                        } else {
                            // SAFETY: as in `escalate`; the same slot, its unread tail.
                            unsafe {
                                ring.submit(
                                    slot,
                                    &mut s.buf[s.filled..s.len],
                                    s.at + s.filled as u64,
                                )
                            }?;
                        }
                    }
                    if slots[w].read.is_some() {
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

    /// The path actually taken, which is not always the one configured.
    pub fn ring_built(&self) -> bool {
        #[cfg(feature = "uring")]
        return matches!(self.ring, Ring::Built(_));
        #[cfg(not(feature = "uring"))]
        return false;
    }

    #[cfg(test)]
    pub(crate) fn holds(&self, span: FrameSpan) -> bool {
        self.holding(span).is_some()
    }

    #[cfg(test)]
    pub(crate) fn pending_slots(&self) -> usize {
        self.slots.iter().filter(|s| s.read.is_some()).count()
    }

    #[cfg(test)]
    pub(crate) fn serving_slot(&self) -> usize {
        self.last
    }

    #[cfg(test)]
    pub(crate) fn take_inflight_waits(&mut self) -> usize {
        std::mem::take(&mut self.inflight_waits)
    }
}

impl Drop for TileReader {
    /// Waits for the kernel before the slots are freed. Here rather than in the ring's own
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

    fn spans(store: &Arc<FrameStore>, idx: &[u32]) -> Vec<FrameSpan> {
        idx.iter()
            .map(|&i| store.frame_span(i).expect("span"))
            .collect()
    }

    /// Six windows long, so a frame that misses can be told from a window that does.
    const LEN: u32 = (READ_WINDOW * 5 + 17) as u32;
    const SHORT: usize = READ_WINDOW / 3;

    /// **The ADR's claim, as an assertion**: a miss reads to the end of the *frame*, so a
    /// missing frame costs one round trip however wide it is. Capping the probe at
    /// `READ_WINDOW` cost +55–82 % at two windows and up; `docs/disk-access/EVIDENCE.md`.
    #[test]
    fn a_missing_frame_costs_one_round_trip_however_wide_it_is() {
        let dir = scratch("oneshot");
        let path = write_bundle(&dir, 2, 250_000);
        let mut store = FrameStore::open(&path).expect("open");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let span = store.frame_span(0).expect("span");

        for (name, got) in [
            ("fill", {
                store.reset_pool_starts();
                let mut seq = SeqReader::new();
                let out = rt
                    .block_on(seq.read(&store, span, None))
                    .expect("read")
                    .to_vec();
                (out, store.pool_starts())
            }),
            ("tile", {
                store.reset_pool_starts();
                let mut tile = TileReader::new(ReadMode::Pool, &store, TILE_SLOTS);
                let out = rt
                    .block_on(tile.read(&store, span, &[]))
                    .expect("read")
                    .to_vec();
                (out, store.pool_starts())
            }),
        ] {
            assert_eq!(got.0, frame_pattern(0, 250_000), "{name} came back wrong");
            assert_eq!(got.1, 1, "{name} started {} blocking reads, not 1", got.1);
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Every frame, whole, on both readers and whichever escalation the host allows.
    #[test]
    fn both_readers_reassemble_every_frame() {
        let dir = scratch("compose-all");
        let path = write_bundle(&dir, 4, LEN);
        let rt = rt();
        for pooled in [false, true] {
            let mut store = FrameStore::open(&path).expect("open store");
            if pooled {
                store.force_pool_reads();
            }
            let store = Arc::new(store);
            let mut seq = SeqReader::new();
            let mut tile = TileReader::new(ReadMode::Auto, &store, TILE_SLOTS);
            for idx in 0..4u32 {
                let span = store.frame_span(idx).expect("span");
                let next = (idx + 1 < 4).then(|| store.frame_span(idx + 1).expect("next"));
                let fill = rt.block_on(seq.read(&store, span, next)).expect("fill");
                assert_eq!(fill, frame_pattern(idx, LEN), "fill {idx}, pooled={pooled}");
                let one = rt.block_on(tile.read(&store, span, &[])).expect("tile");
                assert_eq!(one, frame_pattern(idx, LEN), "tile {idx}, pooled={pooled}");
            }
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **The fill reader's whole point.** Naming the next frame starts its read now, so the
    /// call that asks for it does not start one.
    #[test]
    fn a_named_fill_frame_is_read_before_it_is_asked_for() {
        let dir = scratch("readahead");
        let path = write_bundle(&dir, 2, LEN);
        let mut store = FrameStore::open(&path).expect("open store");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let [first, second] = spans(&store, &[0, 1])[..] else {
            unreachable!("two frames")
        };

        let mut seq = SeqReader::new();
        rt.block_on(seq.read(&store, first, Some(second)))
            .expect("first");
        store.reset_pool_starts();
        let out = rt.block_on(seq.read(&store, second, None)).expect("second");
        assert_eq!(
            out,
            frame_pattern(1, LEN),
            "the read-ahead served wrong bytes"
        );
        assert_eq!(
            store.pool_starts(),
            0,
            "the named frame was read again instead of being served from the read-ahead"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A fill holds **one** read at a time whatever it names, which is what bounds its
    /// blocking threads at scale. `docs/disk-access/EVIDENCE.md` §Fill at scale.
    #[test]
    fn a_fill_never_holds_more_than_one_read_at_once() {
        let dir = scratch("onedeep");
        let path = write_bundle(&dir, 8, LEN);
        let mut store = FrameStore::open(&path).expect("open store");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let mut seq = SeqReader::new();
        for idx in 0..8u32 {
            let span = store.frame_span(idx).expect("span");
            let next = (idx + 1 < 8).then(|| store.frame_span(idx + 1).expect("next"));
            rt.block_on(seq.read(&store, span, next)).expect("read");
        }
        assert_eq!(
            seq.stats().peak_in_flight,
            1,
            "a fill queued more than one read; its threads no longer scale with sessions"
        );
        assert_eq!(seq.stats().misses, 8, "precondition: every frame missed");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A read-ahead the session then abandons still owns its buffer until it lands, so it
    /// has to be waited for before that buffer is handed to another frame.
    #[test]
    fn an_abandoned_read_ahead_is_awaited_before_its_buffer_is_reused() {
        let dir = scratch("abandon");
        let path = write_bundle(&dir, 3, LEN);
        let mut store = FrameStore::open(&path).expect("open store");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let [first, second, third] = spans(&store, &[0, 1, 2])[..] else {
            unreachable!("three frames")
        };

        let mut seq = SeqReader::new();
        rt.block_on(seq.read(&store, first, Some(second)))
            .expect("first");
        // Frame 1 was named and is in flight; the session asks for 2 instead.
        let out = rt.block_on(seq.read(&store, third, None)).expect("third");
        assert_eq!(
            out,
            frame_pattern(2, LEN),
            "the abandoned read landed in the buffer serving another frame"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **The tile reader's whole point.** Naming `slots - 1` upcoming frames puts that many
    /// reads on the device before the current one finishes — `peak_in_flight` is counted
    /// after they start and before the current frame is awaited.
    #[test]
    fn naming_upcoming_tiles_starts_their_reads_before_the_current_one_finishes() {
        let dir = scratch("tiledepth");
        let path = write_bundle(&dir, TILE_SLOTS as u32, LEN);
        let mut store = FrameStore::open(&path).expect("open store");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let all = spans(&store, &(0..TILE_SLOTS as u32).collect::<Vec<_>>());
        let (span, upcoming) = all.split_first().expect("one frame at least");

        let mut tile = TileReader::new(ReadMode::Pool, &store, TILE_SLOTS);
        let out = rt
            .block_on(tile.read(&store, *span, upcoming))
            .expect("read");
        assert_eq!(
            out,
            frame_pattern(0, LEN),
            "the served frame came back wrong"
        );
        assert_eq!(
            tile.stats().peak_in_flight as usize,
            TILE_SLOTS,
            "the upcoming frames' reads had not started when the current one was awaited"
        );
        assert_eq!(
            tile.pending_slots(),
            TILE_SLOTS - 1,
            "the named reads were awaited too"
        );
        assert_eq!(
            tile.serving_slot(),
            0,
            "the first slot serves the asked frame"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A miss asks the kernel for one frame past the named one, via `readahead`. Not
    /// `POSIX_FADV_WILLNEED`, not 4 MiB — `docs/disk-access/adr.md`.
    #[test]
    fn a_fill_miss_readaheads_one_frame_past_the_named_one() {
        let dir = scratch("fill-ra");
        let path = write_bundle(&dir, 6, LEN);
        let mut store = FrameStore::open(&path).expect("open");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let all = spans(&store, &[0, 1, 2, 3, 4, 5]);
        let mut seq = SeqReader::new();
        rt.block_on(seq.read(&store, all[0], Some(all[1])))
            .expect("first");
        let first = store.take_advised();
        assert_eq!(
            first,
            vec![(
                all[1].offset + u64::from(all[1].len),
                u64::from(all[1].len)
            )],
            "the first miss did not readahead exactly one frame past the named one: {first:?}"
        );
        rt.block_on(seq.read(&store, all[1], Some(all[2])))
            .expect("second");
        assert_eq!(
            store.take_advised(),
            vec![(
                all[2].offset + u64::from(all[2].len),
                u64::from(all[2].len)
            )],
            "a continuing miss walk stopped advising"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Hits issue no hint. `claude/serene-rubin-wakfg7` taxed a resident fill with
    /// always-on `WILLNEED` (+7.5 % serve_us in their browser round).
    #[test]
    fn a_warm_fill_issues_no_readahead() {
        let dir = scratch("fill-warm-ra");
        let path = write_bundle(&dir, 4, LEN);
        let store = FrameStore::open(&path).expect("open");
        if !store.nowait_supported() {
            eprintln!("skipped: this filesystem refuses RWF_NOWAIT");
            std::fs::remove_dir_all(&dir).ok();
            return;
        }
        for i in 0..4u32 {
            let span = store.frame_span(i).expect("span");
            let mut buf = vec![0u8; span.len as usize];
            store
                .read_at_blocking(&mut buf, span.offset)
                .expect("warm");
        }
        let store = Arc::new(store);
        store.take_advised();
        let rt = rt();
        let mut seq = SeqReader::new();
        for idx in 0..4u32 {
            let span = store.frame_span(idx).expect("span");
            let next = (idx + 1 < 4).then(|| store.frame_span(idx + 1).expect("next"));
            rt.block_on(seq.read(&store, span, next)).expect("read");
        }
        assert_eq!(seq.stats().misses, 0, "precondition: the walk hit");
        assert!(
            store.take_advised().is_empty(),
            "a hit walk issued readahead"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **Demand is not behind stale prefetch.** After a full-depth start, a jump
    /// returns without awaiting leftover in-flight slots. The store gate parks those
    /// leftovers — eviction is not a lever. `docs/disk-access/adr.md`.
    #[test]
    fn a_tile_jump_does_not_wait_for_stale_prefetch() {
        let dir = scratch("tile-jump");
        let n = (TILE_SLOTS * 2) as u32;
        let path = write_bundle(&dir, n, LEN);
        let mut store = FrameStore::open(&path).expect("open");
        store.force_pool_reads();
        let stale = std::time::Duration::from_secs(2);
        store.delay_pool_start(1, stale);
        store.delay_pool_start(2, stale);
        store.delay_pool_start(3, stale);
        let store = Arc::new(store);
        let rt = rt();
        let all = spans(&store, &(0..n).collect::<Vec<_>>());
        let mut tile = TileReader::new(ReadMode::Pool, &store, TILE_SLOTS);
        rt.block_on(tile.read(&store, all[0], &all[1..TILE_SLOTS]))
            .expect("first");
        assert_eq!(
            tile.take_inflight_waits(),
            1,
            "the first ask should wait only for its own miss"
        );
        rt.block_on(tile.read(&store, all[TILE_SLOTS], &all[TILE_SLOTS + 1..]))
            .expect("jump");
        assert_eq!(
            tile.take_inflight_waits(),
            1,
            "the jumped frame waited for stale prefetch"
        );
        let advised = store.take_advised();
        let skipped = all[TILE_SLOTS + 1];
        assert!(
            advised
                .iter()
                .any(|&(off, len)| off == skipped.offset && len == u64::from(skipped.len)),
            "skipped upcoming were not readahead: {advised:?}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Slots are a constructor argument, so the depth a tile session runs at is a number the
    /// campaign can sweep rather than a constant. `docs/disk-access/adr.md` §1.
    #[test]
    fn a_tile_reader_holds_as_many_frames_as_it_was_given_slots() {
        let dir = scratch("slots");
        let path = write_bundle(&dir, 9, LEN);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        let rt = rt();
        for slots in [2usize, 8] {
            let mut tile = TileReader::new(ReadMode::Pool, &store, slots);
            let all = spans(&store, &(0..9u32).collect::<Vec<_>>());
            let (span, upcoming) = all.split_first().expect("frames");
            rt.block_on(tile.read(&store, *span, upcoming))
                .expect("read");
            assert_eq!(
                tile.stats().peak_named as usize,
                slots,
                "a {slots}-slot reader named a different number of frames"
            );
            for held in all.iter().take(slots) {
                assert!(tile.holds(*held), "a named frame is not held");
            }
            assert!(
                !tile.holds(all[slots]),
                "held more frames than it has slots"
            );
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_mode_parses_the_three_it_documents() {
        for (value, want) in [
            ("pool", ReadMode::Pool),
            ("uring", ReadMode::Uring),
            ("auto", ReadMode::Auto),
            ("nonsense", ReadMode::Auto),
        ] {
            unsafe { std::env::set_var("WTPACS_READ_PATH", value) };
            assert_eq!(ReadMode::from_env(), want, "WTPACS_READ_PATH={value}");
        }
        unsafe { std::env::remove_var("WTPACS_READ_PATH") };
        assert_eq!(ReadMode::from_env(), ReadMode::Auto, "unset is auto");
    }

    #[test]
    fn read_stats_report_the_session_miss_rate() {
        let dir = scratch("stats");
        let path = write_bundle(&dir, 3, LEN);
        let rt = rt();
        let mut store = FrameStore::open(&path).expect("open store");
        store.force_pool_reads();
        let store = Arc::new(store);

        let mut tile = TileReader::new(ReadMode::Pool, &store, TILE_SLOTS);
        assert_eq!(
            tile.stats().miss_rate(),
            None,
            "nothing read, nothing to say"
        );
        for idx in 0..3u32 {
            let span = store.frame_span(idx).expect("span");
            rt.block_on(tile.read(&store, span, &[])).expect("read");
        }
        let stats = tile.stats();
        assert_eq!(
            (stats.hits, stats.misses, stats.miss_rate()),
            (0, 3, Some(1.0)),
            "every read escalated, and one read covered each frame"
        );

        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        if store.nowait_supported() {
            let mut seq = SeqReader::new();
            for idx in 0..3u32 {
                let span = store.frame_span(idx).expect("span");
                rt.block_on(seq.read(&store, span, None)).expect("read");
            }
            assert_eq!(seq.stats().miss_rate(), Some(0.0), "a warm fill escalated");
            assert_eq!(seq.stats().hits, 3);
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
        let mut tile = TileReader::new(ReadMode::Auto, &store, TILE_SLOTS);
        for idx in 0..3u32 {
            let span = store.frame_span(idx).expect("span");
            let out = rt.block_on(tile.read(&store, span, &[])).expect("read");
            assert_eq!(out, frame_pattern(idx, LEN));
        }
        assert!(
            !tile.ring_built(),
            "a session that only ever hit the page cache built a ring anyway"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **The container trap**: where `RWF_NOWAIT` is refused every read reports a miss, so
    /// a ring keyed on the shortfall alone would then serve every *warm* read.
    #[test]
    #[cfg(feature = "uring")]
    fn lazy_ring_is_never_built_without_nowait() {
        let dir = scratch("nonowait");
        let path = write_bundle(&dir, 3, LEN);
        let mut store = FrameStore::open(&path).expect("open store");
        store.force_pool_reads();
        let store = Arc::new(store);
        let rt = rt();
        let mut tile = TileReader::new(ReadMode::Auto, &store, TILE_SLOTS);
        for idx in 0..3u32 {
            let span = store.frame_span(idx).expect("span");
            let out = rt.block_on(tile.read(&store, span, &[])).expect("read");
            assert_eq!(out, frame_pattern(idx, LEN), "the pooled path still serves");
        }
        assert!(
            !tile.ring_built(),
            "a ring was built on a filesystem that refuses RWF_NOWAIT — every warm read \
             would now go through it"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The prefix from the inline read plus the remainder from the ring is the frame.
    #[test]
    #[cfg(feature = "uring")]
    fn nowait_and_ring_compose_into_the_whole_frame() {
        let dir = scratch("ringcompose");
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
        let mut tile = TileReader::new(ReadMode::Auto, &store, TILE_SLOTS);
        for idx in 0..3u32 {
            let span = store.frame_span(idx).expect("span");
            let out = rt.block_on(tile.read(&store, span, &[])).expect("read");
            assert_eq!(out, frame_pattern(idx, LEN), "frame {idx} did not compose");
        }
        assert!(tile.ring_built(), "the miss path never reached the ring");
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
        let mut tile = TileReader::new(ReadMode::Uring, &store, TILE_SLOTS);
        for idx in 0..3u32 {
            let span = store.frame_span(idx).expect("span");
            let out = rt.block_on(tile.read(&store, span, &[])).expect("read");
            assert_eq!(out, frame_pattern(idx, LEN), "frame {idx} came back wrong");
        }
        assert!(tile.ring_built(), "the lever never built a ring");
        std::fs::remove_dir_all(&dir).ok();
    }
}
