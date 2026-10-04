//! Per-frame story: read → write, or refuse. Written once as a trait default; implementors
//! override steps, never the story. `docs/adr/telemetry-server-pipeline.md`.

use crate::media::frame_store::{FrameSpan, FrameStore};
use crate::media::read_path::{ReadMode, SeqReader, TileReader, TILE_SLOTS};
use crate::transport::link::Link;
use crate::transport::planner::Next;
use anyhow::Result;
use bytes::Bytes;
use std::sync::Arc;
use tracing::info;

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use frame_envelope::ENVELOPE_LEN;

/// Implementors override **steps**, never [`serve`](Self::serve).
pub(crate) trait FramePipeline: Send {
    fn store(&self) -> &Arc<FrameStore>;

    /// `frame` and `next` come from the planner, which has already refused anything out of range.
    async fn serve(&mut self, frame: u32, next: &Next) -> Result<()> {
        let body = self.read(frame, next).await?;
        self.write(frame, body).await
    }

    /// The frame's bytes, by the reader `next` names, with `next`'s reads started underneath.
    async fn read(&mut self, frame: u32, next: &Next) -> Result<Bytes>;

    async fn write(&mut self, frame: u32, body: Bytes) -> Result<()>;

    async fn refuse(&mut self, frame: u32, reason: String) -> Result<()>;

    /// However the session ended. `Link::finish`.
    async fn finish(&mut self);
}

pub(crate) struct ProductPipeline {
    store: Arc<FrameStore>,
    link: Link,
    /// Built on the first frame of its kind, so a session pays for neither reader it
    /// does not use. `docs/adr/disk-access.md`.
    seq: Option<SeqReader>,
    tile: Option<TileReader>,
    mode: ReadMode,
    fills: u64,
}

impl ProductPipeline {
    pub(crate) fn new(store: Arc<FrameStore>, link: Link, mode: ReadMode) -> Self {
        Self {
            store,
            link,
            seq: None,
            tile: None,
            mode,
            fills: 0,
        }
    }
}

/// The spans the read path starts on: the planner's names, through the study's index.
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

    async fn read(&mut self, frame: u32, next: &Next) -> Result<Bytes> {
        let Self { store, seq, tile, mode: read_mode, fills, .. } = self;
        let span = store.frame_span(frame);
        let ahead = ahead(store, next);
        match next {
            Next::Fill { first, .. } => {
                *fills += u64::from(*first);
                seq.get_or_insert_with(|| SeqReader::new(Arc::clone(store)))
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

    async fn write(&mut self, frame: u32, body: Bytes) -> Result<()> {
        self.link.send_frame(frame, body).await
    }

    async fn refuse(&mut self, frame: u32, reason: String) -> Result<()> {
        self.link.refuse(frame, reason).await
    }

    async fn finish(&mut self) {
        self.link.finish().await;
    }
}

impl Drop for ProductPipeline {
    /// In `Drop` because a session ends several ways, and a miss rate only some of them
    /// report is worse than none. `docs/adr/disk-access.md` §Reporting.
    fn drop(&mut self) {
        let seq = self.seq.as_ref().map(SeqReader::stats).unwrap_or_default();
        let tile = self
            .tile
            .as_ref()
            .map(TileReader::stats)
            .unwrap_or_default();
        let (hits, misses) = (seq.hits + tile.hits, seq.misses + tile.misses);
        if hits + misses == 0 {
            return;
        }
        info!(
            hits,
            misses,
            miss_rate = misses as f64 / (hits + misses) as f64,
            fill_hits = seq.hits,
            fill_misses = seq.misses,
            tile_hits = tile.hits,
            tile_misses = tile.misses,
            named = tile.peak_named.max(seq.peak_named),
            in_flight = tile.peak_in_flight.max(seq.peak_in_flight),
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
            Err(_) => self.tap.emit_write_err(),
        }
        read
    }

    async fn write(&mut self, frame: u32, body: Bytes) -> Result<()> {
        let envelope_len = ENVELOPE_LEN + body.len();
        let written = self.inner.write(frame, body).await;
        match &written {
            Ok(()) => self.tap.emit_sent(envelope_len),
            Err(_) => self.tap.emit_write_err(),
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
mod tests {
    use super::*;
    use std::io::Write;

    fn one_frame_study(path: &std::path::Path) {
        let meta = br#"{"frameCount":1}"#;
        let mut f = std::fs::File::create(path).expect("create bundle");
        f.write_all(b"SBND").unwrap();
        f.write_all(&1u32.to_le_bytes()).unwrap();
        f.write_all(&(meta.len() as u32).to_le_bytes()).unwrap();
        f.write_all(&1u32.to_le_bytes()).unwrap();
        f.write_all(&((16 + 12 + meta.len()) as u64).to_le_bytes())
            .unwrap();
        f.write_all(&4u32.to_le_bytes()).unwrap();
        f.write_all(meta).unwrap();
        f.write_all(b"abcd").unwrap();
        f.sync_all().unwrap();
    }

    /// A study of `frames` frames, each a different length, so a span cannot match by luck.
    fn study(path: &std::path::Path, frames: u32) {
        let bodies: Vec<Vec<u8>> = (0..frames).map(|i| vec![i as u8; 4 + i as usize]).collect();
        let refs: Vec<&[u8]> = bodies.iter().map(|b| b.as_slice()).collect();
        study_bundle::write_bundle(
            path,
            format!("{{\"frameCount\":{frames}}}").as_bytes(),
            &refs,
        )
        .expect("write study");
    }

    /// Serves nothing from disk: `read` hands back an empty frame, and `write` takes
    /// `write_delay`, so a test can tell the stages apart.
    struct StubPipeline {
        store: Arc<FrameStore>,
        write_delay: std::time::Duration,
    }

    impl FramePipeline for StubPipeline {
        fn store(&self) -> &Arc<FrameStore> {
            &self.store
        }

        async fn read(&mut self, _frame: u32, _next: &Next) -> Result<Bytes> {
            Ok(Bytes::new())
        }

        async fn write(&mut self, _frame: u32, _body: Bytes) -> Result<()> {
            if !self.write_delay.is_zero() {
                tokio::time::sleep(self.write_delay).await;
            }
            Ok(())
        }

        async fn refuse(&mut self, _frame: u32, _reason: String) -> Result<()> {
            Ok(())
        }

        async fn finish(&mut self) {}
    }

    fn recorder(tag: &str, frames: u32) -> (std::path::PathBuf, StubPipeline) {
        let path = std::env::temp_dir().join(format!("wtpacs-{tag}-{}.sbnd", std::process::id()));
        study(&path, frames);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        (path, StubPipeline { store, write_delay: std::time::Duration::ZERO })
    }

    /// **The seam.** The planner's frame indexes become the spans the read path starts on, a
    /// fill's one frame ahead included. Nothing on the wire and no other test can see that
    /// line, so this one owns it. `docs/adr/disk-access.md`.
    #[test]
    fn every_named_frame_reaches_the_read_path_as_its_span() {
        let (path, rec) = recorder("seam", 4);
        let store = &rec.store;
        let want: Vec<FrameSpan> = [1u32, 2, 3].iter().map(|&f| store.frame_span(f)).collect();
        assert_eq!(ahead(store, &Next::Tiles(vec![1, 2, 3])), want, "the planner's names did not reach the read path");
        let fill = Next::Fill { after: Some(3), first: true };
        assert_eq!(ahead(store, &fill), vec![store.frame_span(3)], "a fill's next frame was lost");
        assert_eq!(ahead(store, &Next::Fill { after: None, first: false }), vec![]);
        let _ = std::fs::remove_file(&path);
    }

    /// A frame slow on the wire shows as `write_us`, not `read_us`: the split a slow frame's
    /// row exists to make. `docs/adr/telemetry-server-pipeline.md`.
    #[cfg(feature = "telemetry")]
    #[test]
    fn a_slow_write_lands_in_write_us_not_read_us() {
        use crate::record::tap::{Live, Record};
        let (path, mut rec) = recorder("slow-write", 2);
        rec.write_delay = std::time::Duration::from_millis(20);
        let (tx, rows) = std::sync::mpsc::sync_channel(64);
        let mut recorded = RecordedPipeline::new(rec, Tap::new(1, Some(tx), &Live::default()));
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("rt");
        rt.block_on(recorded.serve(0, &Next::Tiles(vec![]))).expect("serve");
        drop(recorded);
        let row = rows
            .try_iter()
            .flatten()
            .find_map(|r| match r {
                Record::Frame(f) => Some(f),
                Record::Session(_) => None,
            })
            .expect("a frame row");
        let (read, write) = (row.read_us.expect("read"), row.write_us.expect("write"));
        assert!(write >= 20_000, "the slow write is missing from write_us: {row:?}");
        assert!(read < 20_000, "the slow write landed in read_us: {row:?}");
        let _ = std::fs::remove_file(&path);
    }

    /// **A refusal is its own row.** The planner refuses a `stream_frames` range and a frame
    /// outside the study before any frame opens; each row carries the refused frame, not the
    /// last one served, and every row opened is closed. `docs/adr/telemetry-server-pipeline.md`.
    #[cfg(feature = "telemetry")]
    #[test]
    fn a_refused_range_records_a_row_of_its_own() {
        use crate::record::tap::{Live, Record};
        use crate::transport::planner::{Ask, ASKS_AHEAD};
        let (path, rec) = recorder("refused-row", 4);
        let (tx, rows) = std::sync::mpsc::sync_channel(64);
        let mut recorded = RecordedPipeline::new(rec, Tap::new(1, Some(tx), &Live::default()));
        let (asks_tx, mut asks) = tokio::sync::mpsc::channel(ASKS_AHEAD);
        asks_tx.try_send(Ask::Frame(1)).expect("queue ask");
        asks_tx.try_send(Ask::Fill { from: Some(6), to: Some(9) }).expect("queue fill");
        asks_tx.try_send(Ask::Frame(99)).expect("queue ask");
        drop(asks_tx);
        let rt = tokio::runtime::Builder::new_current_thread().build().expect("rt");
        rt.block_on(crate::transport::server::drive(&mut recorded, &mut asks)).expect("drive");
        drop(recorded);

        let records: Vec<Record> = rows.try_iter().flatten().collect();
        let frames: Vec<(u32, u8)> = records
            .iter()
            .filter_map(|r| match r {
                Record::Frame(f) => Some((f.frame_index, f.write_outcome)),
                Record::Session(_) => None,
            })
            .collect();
        assert_eq!(frames, vec![(1, 0), (6, 2), (99, 2)], "a refusal's row is not its own");
        let Some(Record::Session(session)) = records.last() else { panic!("no session row") };
        assert_eq!(
            (session.rows_opened, session.rows_closed),
            (3, 3),
            "rows opened and rows closed disagree"
        );
        let _ = std::fs::remove_file(&path);
    }

    /// **One index per study, never per session** — nothing in the type system prevents a
    /// session opening its own store, so this pins the shape it actually gets.
    /// `docs/adr/disk-access.md` §Invariants.
    #[test]
    fn sessions_share_one_store_rather_than_opening_their_own() {
        let path = std::env::temp_dir().join(format!("wtpacs-share-{}.sbnd", std::process::id()));
        one_frame_study(&path);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));

        let sessions = 8;
        let pipelines: Vec<ProductPipeline> = (0..sessions)
            .map(|_| ProductPipeline::new(Arc::clone(&store), Link::Detached, ReadMode::Auto))
            .collect();

        for (n, pipeline) in pipelines.iter().enumerate() {
            assert!(
                Arc::ptr_eq(pipeline.store(), &store),
                "session {n} is reading through a store of its own"
            );
        }
        assert_eq!(
            Arc::strong_count(&store),
            sessions + 1,
            "one clone per session and the original, and nothing else"
        );
        let _ = std::fs::remove_file(&path);
    }
}
