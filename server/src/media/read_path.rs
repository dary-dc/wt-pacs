//! Two readers, chosen by what the session is doing: a fill on the blocking pool, a tile on a
//! ring. `docs/adr/disk-access.md` §1.

use crate::media::frame_pool;
use crate::media::frame_store::{FrameSpan, FrameStore};
use anyhow::{Context, Result};
use bytes::Bytes;
use std::{iter, mem};
use std::sync::Arc;
use tokio::task::JoinHandle;

#[cfg(feature = "uring")]
use crate::media::uring_reader::UringReader;
#[cfg(feature = "uring")]
use std::sync::Once;
#[cfg(feature = "uring")]
use tracing::warn;

/// Frames a tile session holds at once, and its ring depth. `docs/adr/disk-access.md`.
pub const TILE_SLOTS: usize = 4;
/// Bytes past the named frame a fill asks the kernel to have ready. `docs/adr/disk-access.md`.
pub const FILL_WINDOW: u64 = 4 << 20;

/// Which escalation a tile session takes, from `WTPACS_READ_PATH`, read once at server start.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ReadMode {
    #[default]
    Auto,
    Pool,
}

impl ReadMode {
    /// Unset is `Auto`.
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value {
            None | Some("auto") => Ok(Self::Auto),
            Some("pool") => Ok(Self::Pool),
            Some(other) => Err(format!("WTPACS_READ_PATH is not auto|pool: `{other}`")),
        }
    }
}

/// Counted per frame. `docs/adr/disk-access.md` §Reporting.
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

    fn count(&mut self, missed: bool) {
        if missed {
            self.misses += 1;
        } else {
            self.hits += 1;
        }
    }
}

/// A reader holds no buffer between frames, so a read begins in one from the pool.
fn fit(buf: &mut Vec<u8>, need: usize) {
    if buf.is_empty() {
        *buf = frame_pool::take();
    }
    if buf.len() < need {
        buf.resize(need, 0);
    }
}

/// Probe the page cache for the whole frame; hand any shortfall to the blocking pool.
fn start_pooled(store: &Arc<FrameStore>, span: FrameSpan, mut buf: Vec<u8>) -> Result<Fetch> {
    let len = span.len as usize;
    fit(&mut buf, len);
    let hit = store.read_at_nowait(&mut buf[..len], span.offset)?;
    if hit == len {
        return Ok(Fetch::Ready(buf));
    }
    Ok(Fetch::Pooled(read_rest_on_pool(store, span, buf, hit)))
}

fn read_rest_on_pool(
    store: &Arc<FrameStore>,
    span: FrameSpan,
    mut buf: Vec<u8>,
    from: usize,
) -> JoinHandle<Result<Vec<u8>>> {
    #[cfg(test)]
    store.account_pool_start();
    let store = Arc::clone(store);
    tokio::task::spawn_blocking(move || {
        store.read_at_blocking(&mut buf[from..span.len as usize], span.offset + from as u64)?;
        Ok(buf)
    })
}

/// A frame's read: landed inline, or still with the pool.
enum Fetch {
    Ready(Vec<u8>),
    Pooled(JoinHandle<Result<Vec<u8>>>),
}

impl Fetch {
    /// The buffer once its bytes are in, and whether the pool had to fetch them.
    async fn land(self) -> Result<(Vec<u8>, bool)> {
        match self {
            Self::Ready(buf) => Ok((buf, false)),
            Self::Pooled(join) => Ok((join.await.context("join frame read")??, true)),
        }
    }
}

/// The fill's next frame, if one is named.
enum Ahead {
    Idle,
    Named(FrameSpan, Fetch),
}

/// **The fill reader.** Two buffers, because the next frame is known rather than guessed,
/// and no ring: why, `docs/adr/disk-access.md` §Fill at scale.
pub struct FillReader {
    store: Arc<FrameStore>,
    cur: Vec<u8>,
    ahead: Ahead,
    /// End of what the kernel has been asked for; a walk extends it, a seek restarts it.
    advised_to: u64,
    stats: ReadStats,
}

impl FillReader {
    pub fn new(store: Arc<FrameStore>) -> Self {
        Self {
            store,
            cur: Vec::new(),
            ahead: Ahead::Idle,
            advised_to: 0,
            stats: ReadStats::default(),
        }
    }

    /// The whole of `span`, handed off to the wire. `next` is the frame the planner will ask
    /// for after it, and its read is running by the time this returns.
    pub async fn read(&mut self, span: FrameSpan, next: Option<FrameSpan>) -> Result<Bytes> {
        let (held, spare) = self.settle().await?;
        let spare = match held {
            Some((s, missed)) if s == span => {
                self.stats.count(missed);
                mem::replace(&mut self.cur, spare)
            }
            _ => {
                let buf = mem::take(&mut self.cur);
                let (buf, missed) = start_pooled(&self.store, span, buf)?.land().await?;
                self.stats.count(missed);
                self.cur = buf;
                spare
            }
        };
        self.ahead = match next {
            Some(next) => {
                let fetch = start_pooled(&self.store, next, spare)?;
                self.advise(next);
                Ahead::Named(next, fetch)
            }
            None => {
                frame_pool::put_back(spare);
                Ahead::Idle
            }
        };
        self.stats.peak_named = self.stats.peak_named.max(1 + u16::from(next.is_some()));
        self.stats.peak_in_flight = self
            .stats
            .peak_in_flight
            .max(u16::from(matches!(self.ahead, Ahead::Named(_, Fetch::Pooled(_)))));
        Ok(frame_pool::hand_off(mem::take(&mut self.cur), span.len as usize))
    }

    /// Awaits whatever the last call started, so its buffer can be reused whether or not
    /// this frame is the one it holds.
    async fn settle(&mut self) -> Result<(Option<(FrameSpan, bool)>, Vec<u8>)> {
        match mem::replace(&mut self.ahead, Ahead::Idle) {
            Ahead::Idle => Ok((None, Vec::new())),
            Ahead::Named(span, fetch) => {
                let (buf, missed) = fetch.land().await?;
                Ok((Some((span, missed)), buf))
            }
        }
    }

    /// Extended a quarter window at a time, so the syscall is per megabyte of walk and not
    /// per frame; a seek past the window restarts it.
    fn advise(&mut self, next: FrameSpan) {
        let end = next.offset + u64::from(next.len);
        let want = end + FILL_WINDOW;
        if (end..=want).contains(&self.advised_to) {
            if want - self.advised_to < FILL_WINDOW / 4 {
                return;
            }
            self.store.advise_ahead(self.advised_to, want - self.advised_to);
        } else {
            self.store.advise_ahead(end, FILL_WINDOW);
        }
        self.advised_to = want;
    }

    pub fn stats(&self) -> ReadStats {
        self.stats
    }
}

/// One ring built and dropped, so the banner says whether a tile miss will get one.
#[cfg(feature = "uring")]
pub fn ring_probe(store: &FrameStore) -> String {
    match UringReader::new(store.file(), TILE_SLOTS as u32) {
        Ok(_) => "available".into(),
        Err(err) => format!("refused ({err:#})"),
    }
}

#[cfg(not(feature = "uring"))]
pub fn ring_probe(_: &FrameStore) -> String {
    "not built".into()
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
                    static WARNED: Once = Once::new();
                    WARNED.call_once(|| {
                        warn!(%err, "io_uring refused; tile misses go to the pool (warned once)")
                    });
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
#[derive(Default)]
struct Slot {
    key: Option<FrameSpan>,
    buf: Vec<u8>,
    /// Bytes landed by the probe and the ring; a pool read does not count them.
    filled: usize,
    miss: bool,
    read: Option<InFlight>,
}

enum InFlight {
    #[cfg(feature = "uring")]
    Ring,
    Pool(JoinHandle<Result<Vec<u8>>>),
}

#[cfg(feature = "uring")]
impl Slot {
    /// Puts the held frame's unread tail on the ring as slot `w`, or ends the read if none is left.
    fn submit_tail(&mut self, ring: &mut UringReader, w: usize) -> Result<()> {
        let span = self.key.expect("a slot reads only the frame it holds");
        let len = span.len as usize;
        if self.filled == len {
            self.read = None;
            return Ok(());
        }
        let at = span.offset + self.filled as u64;
        // SAFETY: `buf` is neither grown, read nor dropped while `read` is `Some`, which is set
        // first, as a failed submit may leave the entry queued, and cleared above only once the
        // whole tail has landed; `Drop` drains the ring first.
        self.read = Some(InFlight::Ring);
        unsafe { ring.submit(w, &mut self.buf[self.filled..len], at) }
    }
}

/// **The tile reader.** A scattered ask is a miss by nature, so its queue is the ring's
/// submissions rather than one blocked thread per outstanding read.
pub struct TileReader {
    store: Arc<FrameStore>,
    #[cfg(feature = "uring")]
    ring: Ring,
    slots: Vec<Slot>,
    last: usize,
    stats: ReadStats,
}

impl TileReader {
    /// Without `RWF_NOWAIT` a ring keyed on the shortfall would serve every *warm* read
    /// too — `docs/adr/disk-access.md` §The trap.
    #[cfg_attr(not(feature = "uring"), allow(unused_variables))]
    pub fn new(mode: ReadMode, store: Arc<FrameStore>, slots: usize) -> Self {
        #[cfg(feature = "uring")]
        let wants_ring = match mode {
            ReadMode::Auto => store.nowait_supported(),
            ReadMode::Pool => false,
        };
        Self {
            store,
            #[cfg(feature = "uring")]
            ring: if wants_ring { Ring::Wanted } else { Ring::Off },
            slots: iter::repeat_with(Slot::default).take(slots.max(1)).collect(),
            last: 0,
            stats: ReadStats::default(),
        }
    }

    /// The whole of `span`, handed off to the wire; reads of `upcoming` that fit are started
    /// underneath. Current first, then upcoming, then wait — the measured order.
    pub async fn read(&mut self, span: FrameSpan, upcoming: &[FrameSpan]) -> Result<Bytes> {
        let named = 1 + upcoming.len().min(self.slots.len() - 1);
        self.stats.peak_named = self.stats.peak_named.max(named as u16);
        for &want in iter::once(&span).chain(upcoming).take(named) {
            if self.holding(want).is_none() {
                let w = self.free_slot(span, upcoming);
                self.wait(w).await?;
                self.begin(w, want)?;
            }
        }
        let started = self.slots.iter().filter(|s| s.read.is_some()).count() as u16;
        self.stats.peak_in_flight = self.stats.peak_in_flight.max(started);
        // Missing only when its ring read failed in a batch reaped by another slot's wait.
        let w = self.holding(span).with_context(|| format!("ring read of {span:?} failed"))?;
        self.wait(w).await?;
        self.last = w;
        let slot = &mut self.slots[w];
        self.stats.count(slot.miss);
        slot.key = None;
        Ok(frame_pool::hand_off(mem::take(&mut slot.buf), span.len as usize))
    }

    fn holding(&self, span: FrameSpan) -> Option<usize> {
        self.slots.iter().position(|s| s.key == Some(span))
    }

    /// Prefers a slot with no read landing in it, so an abandoned read never delays a wanted one.
    fn free_slot(&self, span: FrameSpan, upcoming: &[FrameSpan]) -> usize {
        let reach = self.slots.len() - 1;
        let unnamed = |s: &Slot| match s.key {
            None => true,
            Some(k) => k != span && !upcoming.iter().take(reach).any(|&u| u == k),
        };
        self.slots
            .iter()
            .position(|s| unnamed(s) && s.read.is_none())
            .or_else(|| self.slots.iter().position(unnamed))
            .expect("at most one slot per named frame")
    }

    /// Probe the whole frame without waiting; on a shortfall ask for what is missing.
    fn begin(&mut self, w: usize, span: FrameSpan) -> Result<()> {
        let len = span.len as usize;
        let slot = &mut self.slots[w];
        slot.key = None;
        fit(&mut slot.buf, len);
        let hit = self.store.read_at_nowait(&mut slot.buf[..len], span.offset)?;
        slot.key = Some(span);
        slot.filled = hit;
        slot.miss = hit != len;
        if slot.miss {
            self.escalate(w, span)?;
        }
        Ok(())
    }

    /// The ring if this session has one, the pool otherwise. Neither is waited on here.
    fn escalate(&mut self, w: usize, span: FrameSpan) -> Result<()> {
        #[cfg(feature = "uring")]
        if let Some(ring) = self.ring.build_on_first_miss(&self.store, self.slots.len()) {
            return self.slots[w].submit_tail(ring, w);
        }
        let slot = &mut self.slots[w];
        let buf = mem::take(&mut slot.buf);
        slot.read = Some(InFlight::Pool(read_rest_on_pool(&self.store, span, buf, slot.filled)));
        Ok(())
    }

    async fn wait(&mut self, w: usize) -> Result<()> {
        match &mut self.slots[w].read {
            None => Ok(()),
            Some(InFlight::Pool(join)) => {
                let landed = join.await.context("join frame read").and_then(|read| read);
                let slot = &mut self.slots[w];
                slot.read = None;
                match landed {
                    Ok(buf) => {
                        slot.buf = buf;
                        Ok(())
                    }
                    Err(err) => {
                        slot.key = None;
                        Err(err)
                    }
                }
            }
            #[cfg(feature = "uring")]
            Some(InFlight::Ring) => {
                let Self {
                    ring: Ring::Built(ring),
                    slots,
                    ..
                } = self
                else {
                    unreachable!("a ring read outlived its ring")
                };
                while slots[w].read.is_some() {
                    // The whole batch lands before an error returns, or a slot's completion is lost.
                    let mut failed = Ok(());
                    for (s, landed) in ring.reap() {
                        match landed {
                            Ok(n) => {
                                slots[s].filled += n;
                                failed = failed.and(slots[s].submit_tail(ring, s));
                            }
                            Err(err) => {
                                slots[s].key = None;
                                slots[s].read = None;
                                if s == w {
                                    failed = failed.and(Err(err));
                                }
                            }
                        }
                    }
                    failed?;
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
}

impl Drop for TileReader {
    /// Waits for the kernel before the slots are freed. Here rather than in the ring's own
    /// `Drop` because `Drop::drop` runs before any field is, so field order cannot break it.
    fn drop(&mut self) {
        #[cfg(feature = "uring")]
        if let Ring::Built(ring) = &mut self.ring {
            if !ring.drain_in_flight() {
                warn!("io_uring failed with reads in flight; their buffers are leaked, not freed");
                #[cfg(test)]
                LEAKED_ON_DROP.set(LEAKED_ON_DROP.get() + 1);
                // SAFETY: the kernel may still write into any slot's buffer, so none is freed.
                for slot in &mut self.slots {
                    mem::forget(mem::take(&mut slot.buf));
                }
            }
        }
    }
}

#[cfg(all(test, feature = "uring"))]
thread_local! {
    /// Tile readers dropped with their slots leaked.
    static LEAKED_ON_DROP: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
impl TileReader {
    pub(crate) fn holds(&self, span: FrameSpan) -> bool {
        self.holding(span).is_some()
    }

    pub(crate) fn pending_slots(&self) -> usize {
        self.slots.iter().filter(|s| s.read.is_some()).count()
    }

    pub(crate) fn serving_slot(&self) -> usize {
        self.last
    }
}

#[cfg(test)]
mod tests;
