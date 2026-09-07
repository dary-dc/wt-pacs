//! Per-frame story: prepare → locate → send (or refuse).
//!
//! [`FramePipeline::serve_one`] is written once (trait default).
//! Implementors override steps only. Lab wraps steps; it does not restate the story.
//!
//! `locate` returns a [`FrameSpan`] — where the frame is, not what it holds. The read
//! path streams a frame a window at a time and never materialises it, so there is no slice
//! to borrow and `send` does the reading. See `docs/disk-access/adr.md`.
//! See `docs/telemetry/adr-server-pipeline.md`.

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

    /// Work before the frame is located. **The product has none**: the disk-access ADR
    /// of 2026-09-04 removed the pool hop that pre-faulted the frame's pages, and bytes are
    /// now read inside `send`. Kept as a step because the telemetry chain measures it, and
    /// a trace showing it at ~0 is the evidence that the hop is gone.
    async fn prepare(&mut self, _frame: u32) -> Result<()> {
        Ok(())
    }

    /// Where the frame is — offset and length. No I/O, so an out-of-range ask is refused
    /// before any stream is opened.
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
    /// The session's read state: one reusable window, plus the ring if this session has
    /// ever missed. See `crate::media::read_path`.
    read: ReadCtx,
}

impl ProductPipeline {
    pub(crate) fn new(store: Arc<FrameStore>, out: FrameOut) -> Self {
        Self {
            store,
            out,
            read: ReadCtx::new(ReadMode::from_env()),
        }
    }
}

impl FramePipeline for ProductPipeline {
    fn store(&self) -> &Arc<FrameStore> {
        &self.store
    }

    // prepare: trait default — the product has no pre-read step.

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
