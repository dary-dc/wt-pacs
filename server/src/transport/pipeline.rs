//! Per-frame story: read → write, or refuse. Written once as a trait default; implementors
//! override steps, never the story. `docs/adr/telemetry-server-pipeline.md`.

use crate::media::frame_store::{FrameSpan, FrameStore};
use crate::media::read_path::{FillReader, ReadMode, ReadStats, TileReader, TILE_SLOTS};
use crate::transport::link::Link;
use crate::transport::planner::Next;
use anyhow::Result;
use bytes::Bytes;
use std::sync::Arc;
use tracing::info;

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use frame_envelope::INDEX_LEN;

/// Implementors override **steps**, never [`serve`](Self::serve).
pub(crate) trait FramePipeline: Send {
    fn store(&self) -> &Arc<FrameStore>;

    /// `frame` and `next` come from the planner, which has already refused anything out of range.
    async fn serve(&mut self, frame: u32, next: &Next) -> Result<()> {
        let body = self.read(frame, next).await?;
        self.write(frame, body, matches!(next, Next::Tiles(_))).await
    }

    /// The frame's bytes, by the reader `next` names, with `next`'s reads started underneath.
    async fn read(&mut self, frame: u32, next: &Next) -> Result<Bytes>;

    /// `ask` is a frame asked by name, not one a fill recites.
    async fn write(&mut self, frame: u32, body: Bytes, ask: bool) -> Result<()>;

    async fn refuse(&mut self, frame: u32, reason: String) -> Result<()>;

    /// However the session ended. `Link::finish`.
    async fn finish(&mut self);
}

pub(crate) struct ProductPipeline {
    store: Arc<FrameStore>,
    link: Link,
    /// Built on the first frame of its kind, so a session pays for neither reader it
    /// does not use. `docs/adr/disk-access.md`.
    fill: Option<FillReader>,
    tile: Option<TileReader>,
    mode: ReadMode,
    fills: u64,
    #[cfg(feature = "lab-frame-cache")]
    lab_session: u64,
}

impl ProductPipeline {
    pub(crate) fn new(store: Arc<FrameStore>, link: Link, mode: ReadMode) -> Self {
        Self {
            store,
            link,
            fill: None,
            tile: None,
            mode,
            fills: 0,
            #[cfg(feature = "lab-frame-cache")]
            lab_session: crate::media::lab_frame_cache::session(),
        }
    }
}

/// The spans the read path starts on: the planner's names, through the series' index.
fn ahead(store: &FrameStore, next: &Next) -> Vec<FrameSpan> {
    match next {
        Next::Fill { after, .. } => after.iter().map(|&f| store.frame_span(f)).collect(),
        Next::Tiles(names) => names.iter().map(|&f| store.frame_span(f)).collect(),
    }
}

impl FramePipeline for ProductPipeline {
    fn store(&self) -> &Arc<FrameStore> {
        &self.store
    }

    #[cfg(feature = "lab-frame-cache")]
    async fn read(&mut self, frame: u32, next: &Next) -> Result<Bytes> {
        use crate::media::lab_frame_cache as cache;
        if let Some(bytes) = cache::get(frame) {
            return Ok(bytes);
        }
        let len = self.store.frame_span(frame).len as usize;
        if !cache::claim_fill(frame, len, self.lab_session) {
            return self.read_store(frame, next).await;
        }
        let read = self.read_store(frame, next).await;
        match &read {
            Ok(bytes) => cache::admit(frame, bytes.clone()),
            Err(_) => cache::abandon_fill(frame),
        }
        read
    }

    #[cfg(not(feature = "lab-frame-cache"))]
    async fn read(&mut self, frame: u32, next: &Next) -> Result<Bytes> {
        self.read_store(frame, next).await
    }

    async fn write(&mut self, frame: u32, body: Bytes, ask: bool) -> Result<()> {
        self.link.send_frame(frame, body, ask).await
    }

    async fn refuse(&mut self, frame: u32, reason: String) -> Result<()> {
        self.link.refuse(frame, reason).await
    }

    async fn finish(&mut self) {
        self.link.finish().await;
    }
}

impl ProductPipeline {
    async fn read_store(&mut self, frame: u32, next: &Next) -> Result<Bytes> {
        let Self { store, fill, tile, mode: read_mode, fills, .. } = self;
        let span = store.frame_span(frame);
        let ahead = ahead(store, next);
        match next {
            Next::Fill { first, .. } => {
                *fills += u64::from(*first);
                fill.get_or_insert_with(|| FillReader::new(Arc::clone(store)))
                    .read(span, ahead.first().copied())
                    .await
            }
            Next::Tiles(_) => {
                tile.get_or_insert_with(|| TileReader::new(*read_mode, Arc::clone(store), TILE_SLOTS))
                    .read(span, &ahead)
                    .await
            }
        }
    }
}

impl Drop for ProductPipeline {
    /// In `Drop` because a session ends several ways, and a miss rate only some of them
    /// report is worse than none. `docs/adr/disk-access.md` §Reporting.
    fn drop(&mut self) {
        let fill = self.fill.as_ref().map(FillReader::stats).unwrap_or_default();
        let tile = self
            .tile
            .as_ref()
            .map(TileReader::stats)
            .unwrap_or_default();
        let (hits, misses) = (fill.hits + tile.hits, fill.misses + tile.misses);
        let Some(miss_rate) = ReadStats { hits, misses, ..Default::default() }.miss_rate() else {
            return;
        };
        info!(
            hits,
            misses,
            miss_rate,
            fill_hits = fill.hits,
            fill_misses = fill.misses,
            tile_hits = tile.hits,
            tile_misses = tile.misses,
            named = tile.peak_named.max(fill.peak_named),
            in_flight = tile.peak_in_flight.max(fill.peak_in_flight),
            ring = self.tile.as_ref().is_some_and(TileReader::ring_built),
            fills = self.fills,
            "session reads"
        );
    }
}

/// Stamps at method entry, delegates, emits. Generic so it cannot reach product fields.
#[cfg(feature = "telemetry")]
pub(crate) struct RecordedPipeline<P> {
    inner: P,
    tap: Tap,
}

#[cfg(feature = "telemetry")]
impl<P: FramePipeline> RecordedPipeline<P> {
    pub(crate) fn new(inner: P, tap: Tap) -> Self {
        Self { inner, tap }
    }
}

#[cfg(feature = "telemetry")]
impl<P: FramePipeline> FramePipeline for RecordedPipeline<P> {
    fn store(&self) -> &Arc<FrameStore> {
        self.inner.store()
    }

    async fn read(&mut self, frame: u32, next: &Next) -> Result<Bytes> {
        self.tap.begin_frame(frame);
        let read = self.inner.read(frame, next).await;
        match &read {
            Ok(_) => self.tap.boundary_read_done(),
            Err(_) => self.tap.emit_failed(),
        }
        read
    }

    async fn write(&mut self, frame: u32, body: Bytes, ask: bool) -> Result<()> {
        let envelope_len = INDEX_LEN + body.len();
        let written = self.inner.write(frame, body, ask).await;
        match &written {
            Ok(()) => self.tap.emit_sent(envelope_len),
            Err(_) => self.tap.emit_failed(),
        }
        written
    }

    async fn refuse(&mut self, frame: u32, reason: String) -> Result<()> {
        self.tap.emit_refused(frame);
        self.inner.refuse(frame, reason).await
    }

    async fn finish(&mut self) {
        self.inner.finish().await;
    }
}

#[cfg(test)]
mod tests;
