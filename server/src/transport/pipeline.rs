//! Per-frame story: prepare → locate → send (or refuse).
//!
//! [`FramePipeline::serve_one`] is written once (trait default).
//! Implementors override steps only. Lab wraps steps; it does not restate the story.
//!
//! `locate` returns [`Bytes`] — a refcounted view of the study mapping — so `send` can
//! take the chunked path without a full-frame copy. See `docs/telemetry/adr-server-pipeline.md`.

use crate::media::frame_store::FrameStore;
use crate::transport::frame_out::FrameOut;
use crate::transport::wire::write_fod_msg;
use anyhow::{Context, Error, Result};
use bytes::Bytes;
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

        let store = Arc::clone(self.store());
        let bytes = match self.locate(&store, frame) {
            Ok(bytes) => bytes,
            Err(err) => return self.refuse(control, frame, err).await,
        };

        // Send failure: wire/session broken — do not refuse on control.
        self.send(frame, bytes).await?;
        Ok(())
    }

    /// `RequestFrames`: every frame before the next control read, in order. Written once here;
    /// `note_batch` tells the step implementor where in the batch the next `serve_one` sits.
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

    async fn prepare(&mut self, frame: u32) -> Result<()>;

    /// Frame payload as a refcounted view of the mapping — no allocation, no copy.
    fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<Bytes>;

    /// Write the frame bytes on the media path.
    async fn send(&mut self, frame: u32, bytes: Bytes) -> Result<()>;

    async fn refuse(&mut self, control: &mut SendStream, frame: u32, err: Error) -> Result<()>;

    async fn drain_acks(&mut self);
}

/// Product pipeline — application work only.
pub(crate) struct ProductPipeline {
    store: Arc<FrameStore>,
    out: FrameOut,
    prefault: bool,
}

impl ProductPipeline {
    pub(crate) fn new(store: Arc<FrameStore>, out: FrameOut, prefault: bool) -> Self {
        Self {
            store,
            out,
            prefault,
        }
    }
}

impl FramePipeline for ProductPipeline {
    fn store(&self) -> &Arc<FrameStore> {
        &self.store
    }

    async fn prepare(&mut self, frame: u32) -> Result<()> {
        if !self.prefault {
            return Ok(());
        }
        let store = Arc::clone(&self.store);
        tokio::task::spawn_blocking(move || store.touch_frame_pages(frame))
            .await
            .context("join frame page touch")?
    }

    fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<Bytes> {
        store.frame_bytes(frame)
    }

    async fn send(&mut self, frame: u32, bytes: Bytes) -> Result<()> {
        self.out.send_frame(frame, bytes).await
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

    fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<Bytes> {
        self.tap.boundary_prepare_done(); // entry: close prepare
        let result = self.inner.locate(store, frame);
        if let Ok(bytes) = &result {
            self.tap.note_locate(LocateOutcome::Ok, bytes.len());
        }
        // Locate Err → refuse; emit_refused closes locate + notes NotFound.
        result
    }

    async fn send(&mut self, frame: u32, bytes: Bytes) -> Result<()> {
        self.tap.boundary_locate_done(); // entry: close locate
        let envelope_len = ENVELOPE_LEN + bytes.len();
        match self.inner.send(frame, bytes).await {
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
