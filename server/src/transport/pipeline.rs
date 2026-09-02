//! Per-frame server pipeline: product `LivePipeline` vs lab `RecordedPipeline` wrapper.
//!
//! Every observable step is a method; the session loop calls only [`FramePipeline::serve_one`].
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

/// Per-frame story: prepare → locate+send, or refuse on control.
pub(crate) trait FramePipeline: Send {
    /// Default orchestration — written once; wrappers stamp leaf methods only.
    async fn serve_one(
        &mut self,
        idx: u32,
        control: &mut SendStream,
    ) -> Result<()> {
        self.on_ask(idx);
        if let Err(e) = self.prepare(idx).await {
            return self.refuse(control, idx, e).await;
        }
        match self.serve_located(idx).await {
            Ok(()) => Ok(()),
            Err(e) => self.refuse(control, idx, e).await,
        }
    }

    fn on_ask(&mut self, idx: u32);
    async fn prepare(&mut self, idx: u32) -> Result<()>;
    /// Slice from mmap (`Arc` clone avoids store/out borrow conflict) then send on media uni.
    async fn serve_located(&mut self, idx: u32) -> Result<()>;
    async fn refuse(
        &mut self,
        control: &mut SendStream,
        idx: u32,
        reason: impl std::fmt::Display + Send,
    ) -> Result<()>;
    async fn drain_acks(&mut self);
}

/// Product pipeline — every method performs real work (no hollow hooks).
pub(crate) struct LivePipeline {
    pub(crate) store: Arc<FrameStore>,
    pub(crate) out: FrameOut,
}

impl LivePipeline {
    pub(crate) fn new(store: Arc<FrameStore>, out: FrameOut) -> Self {
        Self { store, out }
    }

    async fn prefault(store: Arc<FrameStore>, idx: u32) -> Result<()> {
        tokio::task::spawn_blocking(move || store.touch_frame_pages(idx))
            .await
            .context("join frame page touch")??;
        Ok(())
    }
}

impl FramePipeline for LivePipeline {
    fn on_ask(&mut self, _idx: u32) {}

    async fn prepare(&mut self, idx: u32) -> Result<()> {
        Self::prefault(Arc::clone(&self.store), idx).await
    }

    async fn serve_located(&mut self, idx: u32) -> Result<()> {
        let store = Arc::clone(&self.store);
        let bytes = store.frame_slice(idx)?;
        self.out.send_frame(idx, bytes).await
    }

    async fn refuse(
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

    async fn drain_acks(&mut self) {
        self.out.drain_acks().await;
    }
}

/// Lab wrapper — stamps each leaf; holds `Tap` directly (no `Recorder` layer).
#[cfg(feature = "telemetry")]
pub(crate) struct RecordedPipeline {
    inner: LivePipeline,
    tap: Option<Tap>,
}

#[cfg(feature = "telemetry")]
impl RecordedPipeline {
    pub(crate) fn new(inner: LivePipeline) -> Self {
        Self {
            inner,
            tap: Tap::for_session(),
        }
    }
}

#[cfg(feature = "telemetry")]
fn micros_since(start: Instant) -> u32 {
    start
        .elapsed()
        .as_micros()
        .min(u32::MAX as u128) as u32
}

#[cfg(feature = "telemetry")]
impl FramePipeline for RecordedPipeline {
    fn on_ask(&mut self, idx: u32) {
        if let Some(tap) = &mut self.tap {
            tap.begin_frame(idx);
        }
        self.inner.on_ask(idx);
    }

    async fn prepare(&mut self, idx: u32) -> Result<()> {
        let t0 = Instant::now();
        let r = self.inner.prepare(idx).await;
        if let Some(tap) = &mut self.tap {
            tap.record_prepare(micros_since(t0));
        }
        r
    }

    async fn serve_located(&mut self, idx: u32) -> Result<()> {
        let store = Arc::clone(&self.inner.store);
        let t0 = Instant::now();
        let bytes = match store.frame_slice(idx) {
            Ok(b) => b,
            Err(e) => {
                if let Some(tap) = &mut self.tap {
                    tap.record_locate(micros_since(t0), LocateOutcome::NotFound, 0);
                }
                return Err(e);
            }
        };
        if let Some(tap) = &mut self.tap {
            tap.record_locate(micros_since(t0), LocateOutcome::Ok, bytes.len());
        }

        let t0 = Instant::now();
        let envelope_len = frame_envelope::ENVELOPE_LEN + bytes.len();
        match self.inner.out.send_frame(idx, bytes).await {
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
                Err(err)
            }
        }
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

    async fn drain_acks(&mut self) {
        self.inner.drain_acks().await;
    }
}
