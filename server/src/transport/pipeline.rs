//! Per-frame story: prepare → locate → send, or refuse. Written once as trait defaults;
//! implementors override steps, never the story. `docs/adr/telemetry-server-pipeline.md`.

use crate::media::frame_store::{FrameSpan, FrameStore};
use crate::media::read_path::{ReadMode, SeqReader, TileReader, TILE_SLOTS};
use crate::transport::frame_out::FrameOut;
use crate::transport::planner::Next;
use crate::transport::wire::Control;
use anyhow::Result;
use fod::FodMsg;
use frame_envelope::FRAME_HEAD_LEN;
use std::sync::Arc;
use tokio::sync::oneshot;
use tracing::{info, warn};
use wtransport::stream::SendStream;

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use frame_envelope::ENVELOPE_LEN;

/// Implementors override **steps**, never [`serve`](Self::serve).
pub(crate) trait FramePipeline: Send {
    fn store(&self) -> &Arc<FrameStore>;

    /// `frame` and `next` come from the planner, which has already refused anything out of range.
    async fn serve(&mut self, frame: u32, next: &Next) -> Result<()> {
        self.prepare(frame);
        let span = self.locate(frame);
        let ahead: Vec<FrameSpan> = match next {
            Next::Fill { after, .. } => after.iter().map(|&f| self.store().frame_span(f)).collect(),
            Next::Tiles(names) => names.iter().map(|&f| self.store().frame_span(f)).collect(),
        };
        self.send(frame, span, &ahead, next).await
    }

    /// The frame begins. The product does nothing here; the lab starts its clock.
    fn prepare(&mut self, _frame: u32) {}

    fn locate(&mut self, frame: u32) -> FrameSpan {
        self.store().frame_span(frame)
    }

    /// Read the frame with the reader `next` names, then write it.
    async fn send(&mut self, frame: u32, span: FrameSpan, ahead: &[FrameSpan], next: &Next) -> Result<()>;

    async fn refuse(&mut self, frame: u32, reason: String) -> Result<()>;

    async fn drain_acks(&mut self);
}

pub(crate) struct ProductPipeline {
    store: Arc<FrameStore>,
    out: FrameOut,
    /// Built on the first frame of its kind, so a session pays for neither reader it
    /// does not use. `docs/adr/disk-access.md`.
    seq: Option<SeqReader>,
    tile: Option<TileReader>,
    mode: ReadMode,
    control: Option<Control>,
    /// The opening ask is served before the client opens control, so a refusal of it waits here.
    late_control: Option<oneshot::Receiver<SendStream>>,
    fills: u64,
    /// Lab only: envelope bytes left before the session stalls. `FrameOut::stall_within`.
    stall_left: Option<u64>,
}

impl ProductPipeline {
    pub(crate) fn new(store: Arc<FrameStore>, out: FrameOut, mode: ReadMode) -> Self {
        Self {
            store,
            out,
            seq: None,
            tile: None,
            mode,
            control: None,
            late_control: None,
            fills: 0,
            stall_left: None,
        }
    }

    pub(crate) fn with_stall_after(mut self, bytes: Option<u64>) -> Self {
        self.stall_left = bytes;
        self
    }

    pub(crate) fn with_control(mut self, control: Control) -> Self {
        self.control = Some(control);
        self
    }

    pub(crate) fn with_late_control(mut self, control: oneshot::Receiver<SendStream>) -> Self {
        self.late_control = Some(control);
        self
    }
}

impl FramePipeline for ProductPipeline {
    fn store(&self) -> &Arc<FrameStore> {
        &self.store
    }

    async fn send(&mut self, frame: u32, span: FrameSpan, ahead: &[FrameSpan], next: &Next) -> Result<()> {
        let Self {
            store,
            out,
            seq,
            tile,
            mode: read_mode,
            stall_left,
            fills,
            ..
        } = self;
        let body = match next {
            Next::Fill { first, .. } => {
                *fills += u64::from(*first);
                seq.get_or_insert_with(SeqReader::new)
                    .read(store, span, ahead.first().copied())
                    .await?
            }
            Next::Tiles(_) => {
                tile.get_or_insert_with(|| TileReader::new(*read_mode, store, TILE_SLOTS))
                    .read(store, span, ahead)
                    .await?
            }
        };
        let Some(left) = stall_left else {
            return out.send_frame(frame, body).await;
        };
        let whole = (FRAME_HEAD_LEN + body.len()) as u64;
        if whole > *left {
            return out.stall_within(frame, body, *left as usize).await;
        }
        *left -= whole;
        out.send_frame(frame, body).await
    }

    async fn refuse(&mut self, frame: u32, reason: String) -> Result<()> {
        warn!(frame, %reason, "frame refused");
        if self.control.is_none() {
            if let Some(late) = self.late_control.take() {
                self.control = late.await.ok().map(Control::Stream);
            }
        }
        let Some(control) = self.control.as_mut() else {
            return Ok(());
        };
        control
            .write(&FodMsg::FrameError {
                frame_index: frame,
                reason,
            })
            .await
    }

    async fn drain_acks(&mut self) {
        self.out.drain_acks().await;
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

    fn prepare(&mut self, frame: u32) {
        self.tap.begin_frame(frame);
        self.inner.prepare(frame);
    }

    fn locate(&mut self, frame: u32) -> FrameSpan {
        self.tap.boundary_prepare_done(); // entry: close prepare
        let span = self.inner.locate(frame);
        self.tap.note_locate(span.len as usize);
        span
    }

    async fn send(&mut self, frame: u32, span: FrameSpan, ahead: &[FrameSpan], next: &Next) -> Result<()> {
        // `send_us` covers read and write together, plus the next frame's read starting.
        self.tap.boundary_locate_done(); // entry: close locate
        let envelope_len = ENVELOPE_LEN + span.len as usize;
        match self.inner.send(frame, span, ahead, next).await {
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

    async fn refuse(&mut self, frame: u32, reason: String) -> Result<()> {
        self.tap.emit_refused(frame); // close open stage + emit
        self.inner.refuse(frame, reason).await
    }

    async fn drain_acks(&mut self) {
        self.inner.drain_acks().await;
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
        seen: Vec<(u32, Vec<FrameSpan>, Next)>,
    }

    impl FramePipeline for SeamRecorder {
        fn store(&self) -> &Arc<FrameStore> {
            &self.store
        }

        async fn send(&mut self, frame: u32, _span: FrameSpan, ahead: &[FrameSpan], next: &Next) -> Result<()> {
            self.seen.push((frame, ahead.to_vec(), next.clone()));
            Ok(())
        }

        async fn refuse(&mut self, _frame: u32, _reason: String) -> Result<()> {
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
    /// this one owns it. `docs/adr/disk-access.md`.
    #[test]
    fn serve_hands_every_named_frame_to_the_read_path_as_a_span() {
        let (path, mut rec) = recorder("seam", 4);
        let want: Vec<FrameSpan> = [1u32, 2, 3]
            .iter()
            .map(|&f| rec.store.frame_span(f))
            .collect();
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("rt");
        let tiles = Next::Tiles(vec![1, 2, 3]);
        rt.block_on(rec.serve(0, &tiles)).expect("serve");
        assert_eq!(rec.seen, vec![(0, want, tiles)], "the planner's names did not reach the read path");

        let fill = Next::Fill { after: Some(3), first: true };
        rt.block_on(rec.serve(2, &fill)).expect("serve");
        assert_eq!(rec.seen[1], (2, vec![rec.store.frame_span(3)], fill), "a fill's next frame was lost");
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

    /// A refusal in a session whose control stream never came returns once the session has
    /// closed, rather than waiting for a stream that cannot arrive.
    #[test]
    fn a_refusal_with_no_control_stream_returns_once_the_session_closes() {
        let path = std::env::temp_dir().join(format!("wtpacs-late-{}.sbnd", std::process::id()));
        one_frame_study(&path);
        let store = Arc::new(FrameStore::open(&path).expect("open store"));
        let (closed, late) = oneshot::channel();
        let mut product =
            ProductPipeline::new(store, FrameOut::Detached, ReadMode::Auto).with_late_control(late);
        drop(closed);
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt");
        rt.block_on(async {
            let refused = product.refuse(9, "out of range".into());
            tokio::time::timeout(std::time::Duration::from_secs(2), refused)
                .await
                .expect("the refusal waited on a control stream that can no longer come")
                .expect("refuse");
        });
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
            .map(|_| ProductPipeline::new(Arc::clone(&store), FrameOut::Detached, ReadMode::Auto))
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
