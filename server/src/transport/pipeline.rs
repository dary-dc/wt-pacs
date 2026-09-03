//! Per-frame story: prepare → locate → send (or refuse).
//!
//! [`FramePipeline::serve_one`] is written once (trait default).
//! Implementors override steps only. Lab wraps steps; it does not restate the story.
//!
//! `serve_one` clones the study [`Arc`] so located bytes borrow that clone, not `self`,
//! which lets `send(&mut self, bytes)` compile for wrappers.
//! See `docs/telemetry/adr-server-pipeline.md`.

use crate::media::frame_store::FrameStore;
use crate::transport::frame_out::FrameOut;
use crate::transport::wire::write_fod_msg;
use anyhow::{Context, Error, Result};
use fod::FodMsg;
use frame_envelope::ENVELOPE_LEN;
use std::sync::Arc;
use tracing::warn;
use wtransport::stream::SendStream;

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use crate::record::LocateOutcome;
#[cfg(feature = "telemetry")]
use std::time::Instant;

/// Implementors override **steps**, never [`serve_one`](Self::serve_one).
pub(crate) trait FramePipeline: Send {
    /// Study handle used by the default story (cloned once per frame for locate).
    fn store(&self) -> &Arc<FrameStore>;

    /// prepare → locate → send, or refuse on control.
    async fn serve_one(
        &mut self,
        frame: u32,
        control: &mut SendStream,
    ) -> Result<()> {
        if let Err(err) = self.prepare(frame).await {
            return self.refuse(control, frame, err).await;
        }

        // Clone so `bytes` borrow this Arc, not `self`.
        let store = Arc::clone(self.store());
        let bytes = match self.locate(&store, frame) {
            Ok(bytes) => bytes,
            Err(err) => return self.refuse(control, frame, err).await,
        };

        // Send failure: wire/session broken — do not refuse on control.
        self.send(frame, bytes).await?;
        Ok(())
    }

    async fn prepare(&mut self, frame: u32) -> Result<()>;

    /// Return the frame bytes (real slice, not a validate-only check).
    ///
    /// `bytes` borrow `store`, which must outlive `send` (see default `serve_one`).
    fn locate<'a>(&mut self, store: &'a FrameStore, frame: u32) -> Result<&'a [u8]>;

    /// Write bytes; returns envelope + payload length (for lab stamps).
    async fn send(&mut self, frame: u32, bytes: &[u8]) -> Result<usize>;

    async fn refuse(
        &mut self,
        control: &mut SendStream,
        frame: u32,
        err: Error,
    ) -> Result<()>;

    async fn drain_acks(&mut self);
}

/// Product pipeline — application work only.
pub(crate) struct ProductPipeline {
    store: Arc<FrameStore>,
    out: FrameOut,
}

impl ProductPipeline {
    pub(crate) fn new(store: Arc<FrameStore>, out: FrameOut) -> Self {
        Self { store, out }
    }
}

impl FramePipeline for ProductPipeline {
    fn store(&self) -> &Arc<FrameStore> {
        &self.store
    }

    async fn prepare(&mut self, frame: u32) -> Result<()> {
        let store = Arc::clone(&self.store);
        tokio::task::spawn_blocking(move || store.touch_frame_pages(frame))
            .await
            .context("join frame page touch")?
    }

    fn locate<'a>(&mut self, store: &'a FrameStore, frame: u32) -> Result<&'a [u8]> {
        store.frame_slice(frame)
    }

    async fn send(&mut self, frame: u32, bytes: &[u8]) -> Result<usize> {
        self.out.send_frame(frame, bytes).await?;
        Ok(ENVELOPE_LEN + bytes.len())
    }

    async fn refuse(
        &mut self,
        control: &mut SendStream,
        frame: u32,
        err: Error,
    ) -> Result<()> {
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

/// Lab wrapper: stamp, delegate, stamp. Generic so it cannot reach product fields.
#[cfg(feature = "telemetry")]
pub(crate) struct RecordedPipeline<P> {
    inner: P,
    tap: Option<Tap>,
}

#[cfg(feature = "telemetry")]
impl<P: FramePipeline> RecordedPipeline<P> {
    pub(crate) fn new(inner: P) -> Self {
        Self {
            inner,
            tap: Tap::for_session(),
        }
    }
}

#[cfg(feature = "telemetry")]
impl<P: FramePipeline> FramePipeline for RecordedPipeline<P> {
    // serve_one: default — not overridden

    fn store(&self) -> &Arc<FrameStore> {
        self.inner.store()
    }

    async fn prepare(&mut self, frame: u32) -> Result<()> {
        if let Some(tap) = &mut self.tap {
            tap.begin_frame(frame);
        }
        let t0 = Instant::now();
        let result = self.inner.prepare(frame).await;
        if let Some(tap) = &mut self.tap {
            tap.record_prepare(micros_since(t0));
        }
        result
    }

    fn locate<'a>(&mut self, store: &'a FrameStore, frame: u32) -> Result<&'a [u8]> {
        let t0 = Instant::now();
        let result = self.inner.locate(store, frame);
        if let Some(tap) = &mut self.tap {
            match &result {
                Ok(bytes) => {
                    tap.record_locate(micros_since(t0), LocateOutcome::Ok, bytes.len())
                }
                Err(_) => {
                    tap.record_locate(micros_since(t0), LocateOutcome::NotFound, 0)
                }
            }
        }
        result
    }

    async fn send(&mut self, frame: u32, bytes: &[u8]) -> Result<usize> {
        let t0 = Instant::now();
        let result = self.inner.send(frame, bytes).await;
        if let Some(tap) = &mut self.tap {
            match &result {
                Ok(sent) => tap.emit_sent(micros_since(t0), *sent),
                Err(_) => tap.emit_write_err(micros_since(t0)),
            }
        }
        result
    }

    async fn refuse(
        &mut self,
        control: &mut SendStream,
        frame: u32,
        err: Error,
    ) -> Result<()> {
        if let Some(tap) = &mut self.tap {
            tap.emit_refused();
        }
        self.inner.refuse(control, frame, err).await
    }

    async fn drain_acks(&mut self) {
        self.inner.drain_acks().await;
    }
}

#[cfg(feature = "telemetry")]
fn micros_since(start: Instant) -> u32 {
    start
        .elapsed()
        .as_micros()
        .min(u32::MAX as u128) as u32
}
