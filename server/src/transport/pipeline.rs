//! Per-frame story: prepare → locate → send, or refuse. Written once as trait defaults;
//! implementors override steps, never the story. `docs/telemetry/adr-server-pipeline.md`.

use crate::media::frame_store::{FrameSpan, FrameStore};
use crate::media::read_path::{ReadMode, SeqReader, TileReader, TILE_SLOTS};
use crate::transport::frame_out::FrameOut;
use crate::transport::planner::Mode;
use crate::transport::wire::write_fod_msg;
use anyhow::{Error, Result};
use fod::FodMsg;
use std::sync::Arc;
use tracing::{debug, info};
use wtransport::stream::SendStream;

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use crate::record::LocateOutcome;
#[cfg(feature = "telemetry")]
use frame_envelope::ENVELOPE_LEN;

/// Implementors override **steps**, never [`serve`](Self::serve).
pub(crate) trait FramePipeline: Send {
    fn store(&self) -> &Arc<FrameStore>;

    /// `upcoming` are the frames this session will be asked for after `frame`, where known.
    async fn serve(&mut self, frame: u32, upcoming: &[u32], mode: Mode) -> Result<()> {
        self.prepare(frame);

        let store = Arc::clone(self.store());
        let span = match self.locate(&store, frame) {
            Ok(span) => span,
            Err(err) => return self.refuse(frame, err).await,
        };
        let ahead: Vec<FrameSpan> = upcoming
            .iter()
            .filter_map(|&frame| store.frame_span(frame).ok())
            .collect();

        self.send(frame, &store, span, &ahead, mode).await?;
        Ok(())
    }

    /// The frame begins. The product does nothing here; the lab starts its clock.
    fn prepare(&mut self, _frame: u32) {}

    /// No I/O, so an out-of-range ask is refused before a stream opens.
    fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<FrameSpan>;

    /// Read the frame with the reader `mode` names, then write it.
    async fn send(
        &mut self,
        frame: u32,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        ahead: &[FrameSpan],
        mode: Mode,
    ) -> Result<()>;

    async fn refuse(&mut self, frame: u32, err: Error) -> Result<()>;

    async fn drain_acks(&mut self);

    fn note_fill(&mut self) {}
}

pub(crate) struct ProductPipeline {
    store: Arc<FrameStore>,
    out: FrameOut,
    /// Built on the first frame of its kind, so a session pays for neither reader it
    /// does not use. `docs/disk-access/adr.md`.
    seq: Option<SeqReader>,
    tile: Option<TileReader>,
    mode: ReadMode,
    control: Option<SendStream>,
    fills: u64,
}

impl ProductPipeline {
    pub(crate) fn new(store: Arc<FrameStore>, out: FrameOut) -> Self {
        Self {
            store,
            out,
            seq: None,
            tile: None,
            mode: ReadMode::from_env(),
            control: None,
            fills: 0,
        }
    }

    pub(crate) fn with_control(mut self, control: SendStream) -> Self {
        self.control = Some(control);
        self
    }
}

impl FramePipeline for ProductPipeline {
    fn store(&self) -> &Arc<FrameStore> {
        &self.store
    }

    fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<FrameSpan> {
        store.frame_span(frame)
    }

    async fn send(
        &mut self,
        frame: u32,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        ahead: &[FrameSpan],
        mode: Mode,
    ) -> Result<()> {
        let Self {
            out,
            seq,
            tile,
            mode: read_mode,
            ..
        } = self;
        let body = match mode {
            Mode::Fill => {
                seq.get_or_insert_with(SeqReader::new)
                    .read(store, span, ahead.first().copied())
                    .await?
            }
            Mode::OnDemand => {
                tile.get_or_insert_with(|| TileReader::new(*read_mode, store, TILE_SLOTS))
                    .read(store, span, ahead)
                    .await?
            }
        };
        out.send_frame(frame, body).await
    }

    async fn refuse(&mut self, frame: u32, err: Error) -> Result<()> {
        let reason = err.to_string();
        debug!(frame, %reason, "frame refused");
        let Some(control) = self.control.as_mut() else {
            return Ok(());
        };
        write_fod_msg(
            control,
            &FodMsg::FrameError {
                frame_index: frame,
                reason,
            },
        )
        .await
    }

    async fn drain_acks(&mut self) {
        self.out.drain_acks().await;
    }

    fn note_fill(&mut self) {
        self.fills += 1;
    }
}

impl Drop for ProductPipeline {
    /// In `Drop` because a session ends several ways, and a miss rate only some of them
    /// report is worse than none. `docs/disk-access/IMPLEMENTATION.md` §Reporting.
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

    fn prepare(&mut self, frame: u32) {
        self.tap.begin_frame(frame);
        self.inner.prepare(frame);
    }

    fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<FrameSpan> {
        self.tap.boundary_prepare_done(); // entry: close prepare
        let result = self.inner.locate(store, frame);
        if let Ok(span) = &result {
            self.tap.note_locate(LocateOutcome::Ok, span.len as usize);
        }
        result
    }

    async fn send(
        &mut self,
        frame: u32,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        ahead: &[FrameSpan],
        mode: Mode,
    ) -> Result<()> {
        // `send_us` covers read and write together, plus the next frame's read starting.
        self.tap.boundary_locate_done(); // entry: close locate
        let envelope_len = ENVELOPE_LEN + span.len as usize;
        match self.inner.send(frame, store, span, ahead, mode).await {
            Ok(()) => {
                self.tap.emit_sent(envelope_len);
                Ok(())
            }
            Err(e) => {
                self.tap.emit_write_err();
                Err(e)
            }
        }
    }

    async fn refuse(&mut self, frame: u32, err: Error) -> Result<()> {
        self.tap.emit_refused(); // close open stage + emit
        self.inner.refuse(frame, err).await
    }

    async fn drain_acks(&mut self) {
        self.inner.drain_acks().await;
    }

    fn note_fill(&mut self) {
        self.inner.note_fill();
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

    /// Records what reaches the read path. `locate` is the product's; only the sink is the
    /// test's, because the sink is the observation point.
    struct SeamRecorder {
        store: Arc<FrameStore>,
        seen: Vec<(u32, Vec<FrameSpan>, Mode)>,
    }

    impl FramePipeline for SeamRecorder {
        fn store(&self) -> &Arc<FrameStore> {
            &self.store
        }

        fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<FrameSpan> {
            store.frame_span(frame)
        }

        async fn send(
            &mut self,
            frame: u32,
            _store: &Arc<FrameStore>,
            _span: FrameSpan,
            ahead: &[FrameSpan],
            mode: Mode,
        ) -> Result<()> {
            self.seen.push((frame, ahead.to_vec(), mode));
            Ok(())
        }

        async fn refuse(&mut self, _frame: u32, _err: Error) -> Result<()> {
            Ok(())
        }

        async fn drain_acks(&mut self) {}
    }

    fn recorder(tag: &str, frames: u32) -> (std::path::PathBuf, SeamRecorder) {
        let path = std::env::temp_dir().join(format!("wtpacs-{tag}-{}.sbnd", std::process::id()));
        study(&path, frames);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        (
            path,
            SeamRecorder {
                store,
                seen: Vec::new(),
            },
        )
    }

    /// **The seam.** `serve`'s default body turns the planner's frame indexes into the spans
    /// the read path starts on. Nothing on the wire and no other test can see that line, so
    /// this one owns it. `docs/disk-access/IMPLEMENTATION.md`.
    #[test]
    fn serve_hands_every_named_frame_to_the_read_path_as_a_span() {
        let (path, mut rec) = recorder("seam", 4);
        let want: Vec<FrameSpan> = [1u32, 2, 3]
            .iter()
            .map(|&f| rec.store.frame_span(f).unwrap())
            .collect();
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("rt");
        rt.block_on(rec.serve(0, &[1, 2, 3], Mode::OnDemand))
            .expect("serve");
        assert_eq!(
            rec.seen,
            vec![(0, want, Mode::OnDemand)],
            "the planner's names did not reach the read path"
        );
        let _ = std::fs::remove_file(&path);
    }

    /// An upcoming frame outside the study is dropped from `ahead`, never an error for the
    /// frame being served. §13.3.
    #[test]
    fn an_upcoming_frame_out_of_range_is_dropped_not_refused() {
        let (path, mut rec) = recorder("seam-oob", 2);
        let want = vec![rec.store.frame_span(1).unwrap()];
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("rt");
        rt.block_on(rec.serve(0, &[1, 99], Mode::OnDemand))
            .expect("serve");
        assert_eq!(
            rec.seen,
            vec![(0, want, Mode::OnDemand)],
            "a bad name broke the good one"
        );
        let _ = std::fs::remove_file(&path);
    }

    /// **One index per study, never per session** — nothing in the type system prevents a
    /// session opening its own store, so this pins the shape it actually gets.
    /// `docs/disk-access/adr.md` §Invariants.
    #[test]
    fn sessions_share_one_store_rather_than_opening_their_own() {
        let path = std::env::temp_dir().join(format!("wtpacs-share-{}.sbnd", std::process::id()));
        one_frame_study(&path);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));

        let sessions = 8;
        let pipelines: Vec<ProductPipeline> = (0..sessions)
            .map(|_| ProductPipeline::new(Arc::clone(&store), FrameOut::Detached))
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
