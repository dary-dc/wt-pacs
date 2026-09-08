//! Per-frame story: prepare → locate → send (or refuse).
//!
//! [`FramePipeline::serve_one`] is the story, written once. Implementors override steps.
//! `locate` returns a [`FrameSpan`] — where the frame is, not its bytes.
//! `docs/disk-access/adr.md`, `docs/telemetry/adr-server-pipeline.md`.

use crate::media::frame_store::{FrameSpan, FrameStore};
use crate::media::read_path::{ReadCtx, ReadMode};
use crate::transport::frame_out::FrameOut;
use crate::transport::wire::write_fod_msg;
use anyhow::{Error, Result};
use fod::FodMsg;
use std::sync::Arc;
use tracing::warn;
use wtransport::stream::SendStream;

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use crate::record::LocateOutcome;
#[cfg(feature = "telemetry")]
use frame_envelope::ENVELOPE_LEN;

/// Implementors override **steps**, never [`serve_one`](Self::serve_one).
pub(crate) trait FramePipeline: Send {
    /// Study handle used by the default story (cloned once per frame for locate).
    fn store(&self) -> &Arc<FrameStore>;

    /// prepare → locate → send, or refuse on control.
    async fn serve_one(&mut self, frame: u32, control: &mut SendStream) -> Result<()> {
        if let Err(err) = self.prepare(frame).await {
            return self.refuse(control, frame, err).await;
        }

        // Cloned once per frame: `send` reads through it, off this borrow of `self`.
        let store = Arc::clone(self.store());
        let span = match self.locate(&store, frame) {
            Ok(span) => span,
            Err(err) => return self.refuse(control, frame, err).await,
        };

        // Send failure: wire/session broken — do not refuse on control.
        self.send(frame, &store, span).await?;
        Ok(())
    }

    /// `RequestFrames`: every frame, in order, before the next control read. Serial:
    /// frame *n+1* is not read until *n* is on the wire.
    /// `docs/adr-frame-framing-and-loop-shape.md` §Serving depth.
    async fn serve_batch(&mut self, frames: &[u32], control: &mut SendStream) -> Result<()> {
        let size = frames.len() as u32;
        for (position, &frame) in frames.iter().enumerate() {
            self.note_batch(position as u32, size);
            self.serve_one(frame, control).await?;
        }
        Ok(())
    }

    /// Where the next `serve_one` sits in a batch. Product ignores it; the lab stamps it.
    fn note_batch(&mut self, _position: u32, _size: u32) {}

    /// No-op in the product. Kept so the telemetry chain can show it at ~0.
    async fn prepare(&mut self, _frame: u32) -> Result<()> {
        Ok(())
    }

    /// Where the frame is. No I/O — out of range is refused before a stream opens.
    fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<FrameSpan>;

    /// Read the frame and write it on the media path, interleaved a window at a time.
    async fn send(&mut self, frame: u32, store: &Arc<FrameStore>, span: FrameSpan) -> Result<()>;

    async fn refuse(&mut self, control: &mut SendStream, frame: u32, err: Error) -> Result<()>;

    async fn drain_acks(&mut self);
}

/// Product pipeline — application work only.
pub(crate) struct ProductPipeline {
    store: Arc<FrameStore>,
    out: FrameOut,
    read: ReadCtx,
}

impl ProductPipeline {
    pub(crate) fn new(store: Arc<FrameStore>, out: FrameOut) -> Self {
        let read = ReadCtx::new(ReadMode::from_env(), &store);
        Self { store, out, read }
    }
}

impl FramePipeline for ProductPipeline {
    fn store(&self) -> &Arc<FrameStore> {
        &self.store
    }

    fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<FrameSpan> {
        store.frame_span(frame)
    }

    async fn send(&mut self, frame: u32, store: &Arc<FrameStore>, span: FrameSpan) -> Result<()> {
        self.out
            .send_frame(frame, store, span, &mut self.read)
            .await
    }

    async fn refuse(&mut self, control: &mut SendStream, frame: u32, err: Error) -> Result<()> {
        let reason = err.to_string();
        warn!(frame, %reason, "frame refused");
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
}

/// Lab wrapper: stamp at method entry (contiguous chain), delegate, metadata/emit.
/// Constructed only when telemetry env is on — `tap` is always present.
/// Generic so it cannot reach product fields.
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
    // serve_one / serve_batch: default — not overridden

    fn store(&self) -> &Arc<FrameStore> {
        self.inner.store()
    }

    fn note_batch(&mut self, position: u32, size: u32) {
        self.tap.note_batch(position, size);
        self.inner.note_batch(position, size);
    }

    async fn prepare(&mut self, frame: u32) -> Result<()> {
        self.tap.begin_frame(frame); // serve_start = mark = now
        self.inner.prepare(frame).await
        // Prepare Err → serve_one calls refuse; emit_refused closes prepare.
    }

    fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<FrameSpan> {
        self.tap.boundary_prepare_done(); // entry: close prepare
        let result = self.inner.locate(store, frame);
        if let Ok(span) = &result {
            self.tap.note_locate(LocateOutcome::Ok, span.len as usize);
        }
        // Locate Err → refuse; emit_refused closes locate + notes NotFound.
        result
    }

    async fn send(&mut self, frame: u32, store: &Arc<FrameStore>, span: FrameSpan) -> Result<()> {
        self.tap.boundary_locate_done(); // entry: close locate
                                         // `send_us` is read **and** write: the streaming loop interleaves them, so disk
                                         // time and wire time are not separable here by construction.
        let envelope_len = ENVELOPE_LEN + span.len as usize;
        match self.inner.send(frame, store, span).await {
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

    async fn refuse(&mut self, control: &mut SendStream, frame: u32, err: Error) -> Result<()> {
        self.tap.emit_refused(); // close open stage + emit
        self.inner.refuse(control, frame, err).await
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

    /// Pins that a session gets a handle on the shared store, not its own.
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
