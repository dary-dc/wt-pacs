//! Per-frame server story: prepare → locate → send (or refuse on control).
//!
//! Product: [`FramePipeline`]. Lab: [`RecordedFramePipeline`] wraps it.
//! Session loop calls only [`SessionPipeline::serve_one`].
//! See `docs/telemetry/adr-server-pipeline.md`.

use crate::media::frame_store::FrameStore;
use crate::transport::frame_out::FrameOut;
use crate::transport::wire::write_fod_msg;
use anyhow::{Context, Result};
use fod::FodMsg;
use std::sync::Arc;
use tracing::warn;
use wtransport::stream::SendStream;

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use crate::record::LocateOutcome;
#[cfg(feature = "telemetry")]
use std::time::Instant;

/// Product per-frame pipeline: store → wire.
pub(crate) struct FramePipeline {
    store: Arc<FrameStore>,
    out: FrameOut,
}

impl FramePipeline {
    pub(crate) fn new(store: Arc<FrameStore>, out: FrameOut) -> Self {
        Self { store, out }
    }

    #[cfg(feature = "telemetry")]
    pub(crate) fn store(&self) -> &Arc<FrameStore> {
        &self.store
    }

    /// One FoD ask → frame on media uni (or `FrameError` on control).
    pub(crate) async fn serve_one(
        &mut self,
        idx: u32,
        control: &mut SendStream,
    ) -> Result<()> {
        if let Err(e) = self.prepare(idx).await {
            return self.refuse(control, idx, e).await;
        }
        let bytes = match self.store.frame_slice(idx) {
            Ok(b) => b,
            Err(e) => return self.refuse(control, idx, e).await,
        };
        if let Err(e) = self.out.send_frame(idx, bytes).await {
            return self.refuse(control, idx, e).await;
        }
        Ok(())
    }

    pub(crate) async fn prepare(&mut self, idx: u32) -> Result<()> {
        let store = Arc::clone(&self.store);
        tokio::task::spawn_blocking(move || store.touch_frame_pages(idx))
            .await
            .context("join frame page touch")??;
        Ok(())
    }

    #[cfg(feature = "telemetry")]
    pub(crate) async fn send(&mut self, idx: u32, bytes: &[u8]) -> Result<()> {
        self.out.send_frame(idx, bytes).await
    }

    pub(crate) async fn refuse(
        &mut self,
        control: &mut SendStream,
        idx: u32,
        reason: impl std::fmt::Display + Send,
    ) -> Result<()> {
        let reason = reason.to_string();
        warn!(frame = idx, %reason, "frame refused");
        write_fod_msg(
            control,
            &FodMsg::FrameError {
                frame_index: idx,
                reason,
            },
        )
        .await
    }

    pub(crate) async fn drain_acks(&mut self) {
        self.out.drain_acks().await;
    }
}

/// Lab wrapper — stamps each stage; holds `Tap` directly (no `Recorder` layer).
#[cfg(feature = "telemetry")]
pub(crate) struct RecordedFramePipeline {
    inner: FramePipeline,
    tap: Option<Tap>,
}

#[cfg(feature = "telemetry")]
impl RecordedFramePipeline {
    pub(crate) fn new(inner: FramePipeline) -> Self {
        Self {
            inner,
            tap: Tap::for_session(),
        }
    }

    pub(crate) async fn serve_one(
        &mut self,
        idx: u32,
        control: &mut SendStream,
    ) -> Result<()> {
        if let Some(tap) = &mut self.tap {
            tap.begin_frame(idx);
        }

        if let Err(e) = self.prepare(idx).await {
            return self.refuse(control, idx, e).await;
        }

        // Clone so `bytes` borrows the local `Arc` while `inner.send` mutably borrows `out`.
        let store = Arc::clone(self.inner.store());
        let t0 = Instant::now();
        let bytes = match store.frame_slice(idx) {
            Ok(b) => b,
            Err(e) => {
                if let Some(tap) = &mut self.tap {
                    tap.record_locate(micros_since(t0), LocateOutcome::NotFound, 0);
                }
                return self.refuse(control, idx, e).await;
            }
        };
        if let Some(tap) = &mut self.tap {
            tap.record_locate(micros_since(t0), LocateOutcome::Ok, bytes.len());
        }

        let t0 = Instant::now();
        let envelope_len = frame_envelope::ENVELOPE_LEN + bytes.len();
        match self.inner.send(idx, bytes).await {
            Ok(()) => {
                if let Some(tap) = &mut self.tap {
                    tap.emit_sent(micros_since(t0), envelope_len);
                }
                Ok(())
            }
            Err(err) => {
                if let Some(tap) = &mut self.tap {
                    tap.emit_write_err(micros_since(t0));
                }
                self.refuse(control, idx, err).await
            }
        }
    }

    async fn prepare(&mut self, idx: u32) -> Result<()> {
        let t0 = Instant::now();
        let r = self.inner.prepare(idx).await;
        if let Some(tap) = &mut self.tap {
            tap.record_prepare(micros_since(t0));
        }
        r
    }

    async fn refuse(
        &mut self,
        control: &mut SendStream,
        idx: u32,
        reason: impl std::fmt::Display + Send,
    ) -> Result<()> {
        if let Some(tap) = &mut self.tap {
            tap.emit_refused();
        }
        self.inner.refuse(control, idx, reason).await
    }

    pub(crate) async fn drain_acks(&mut self) {
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

/// Session-scoped pipeline — product or lab, selected at construction.
pub(crate) enum SessionPipeline {
    Product(FramePipeline),
    #[cfg(feature = "telemetry")]
    Recorded(RecordedFramePipeline),
}

impl SessionPipeline {
    pub(crate) fn product(store: Arc<FrameStore>, out: FrameOut) -> Self {
        Self::Product(FramePipeline::new(store, out))
    }

    #[cfg(feature = "telemetry")]
    pub(crate) fn recorded(store: Arc<FrameStore>, out: FrameOut) -> Self {
        Self::Recorded(RecordedFramePipeline::new(FramePipeline::new(store, out)))
    }

    pub(crate) async fn serve_one(
        &mut self,
        idx: u32,
        control: &mut SendStream,
    ) -> Result<()> {
        match self {
            Self::Product(p) => p.serve_one(idx, control).await,
            #[cfg(feature = "telemetry")]
            Self::Recorded(r) => r.serve_one(idx, control).await,
        }
    }

    pub(crate) async fn drain_acks(&mut self) {
        match self {
            Self::Product(p) => p.drain_acks().await,
            #[cfg(feature = "telemetry")]
            Self::Recorded(r) => r.drain_acks().await,
        }
    }
}
