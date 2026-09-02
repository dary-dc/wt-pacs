//! One frame's life, as one method per step.
//!
//! [`FramePipeline::serve_one`] is the story and is written **once**, as a default method.
//! Implementors provide only the steps. The lab wrapper therefore implements steps and
//! never restates the story. See `docs/telemetry/adr-server-pipeline.md`.

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

/// The per-frame story and the steps it is made of.
pub(crate) trait FramePipeline: Send {
    /// The story: prepare the pages, find the bytes, send them — or tell the client why not.
    ///
    /// Written once. Implementors override **steps**, never this.
    async fn serve_one(
        &mut self,
        store: &Arc<FrameStore>,
        idx: u32,
        control: &mut SendStream,
    ) -> Result<()> {
        if let Err(err) = self.prepare(store, idx).await {
            return self.refuse(control, idx, err).await;
        }
        let bytes = match self.locate(store, idx) {
            Ok(bytes) => bytes,
            Err(err) => return self.refuse(control, idx, err).await,
        };
        self.send(idx, bytes).await.map(|_sent| ())
    }

    /// Fault the frame's pages in, off the executor. See `docs/disk-access/adr.md`.
    async fn prepare(&mut self, store: &Arc<FrameStore>, idx: u32) -> Result<()>;

    /// Find the frame's bytes in the mapped study.
    ///
    /// The slice borrows `store`, not `self`, so [`send`](Self::send) can still take
    /// `&mut self` afterwards — which is what lets a wrapper delegate instead of inline.
    fn locate<'s>(&mut self, store: &'s FrameStore, idx: u32) -> Result<&'s [u8]>;

    /// Put the frame on the media path. Returns the bytes written.
    async fn send(&mut self, idx: u32, bytes: &[u8]) -> Result<usize>;

    /// Tell the client this frame is not coming.
    async fn refuse(&mut self, control: &mut SendStream, idx: u32, err: Error) -> Result<()>;

    /// Session shutdown: let per-frame streams finish acknowledging.
    async fn drain_acks(&mut self);
}

/// Product pipeline. Every method does real work; nothing here knows about measurement.
pub(crate) struct LivePipeline {
    out: FrameOut,
}

impl LivePipeline {
    pub(crate) fn new(out: FrameOut) -> Self {
        Self { out }
    }
}

impl FramePipeline for LivePipeline {
    async fn prepare(&mut self, store: &Arc<FrameStore>, idx: u32) -> Result<()> {
        let store = Arc::clone(store);
        tokio::task::spawn_blocking(move || store.touch_frame_pages(idx))
            .await
            .context("join frame page touch")?
    }

    fn locate<'s>(&mut self, store: &'s FrameStore, idx: u32) -> Result<&'s [u8]> {
        store.frame_slice(idx)
    }

    async fn send(&mut self, idx: u32, bytes: &[u8]) -> Result<usize> {
        self.out.send_frame(idx, bytes).await?;
        Ok(ENVELOPE_LEN + bytes.len())
    }

    async fn refuse(&mut self, control: &mut SendStream, idx: u32, err: Error) -> Result<()> {
        let reason = err.to_string();
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

/// Lab wrapper: stamp, delegate, stamp. Generic over the inner pipeline, so it *cannot*
/// reach into the product type's fields — isolation is a compile error, not a promise.
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
fn micros_since(start: Instant) -> u32 {
    start.elapsed().as_micros().min(u32::MAX as u128) as u32
}

#[cfg(feature = "telemetry")]
impl<P: FramePipeline> FramePipeline for RecordedPipeline<P> {
    // serve_one: the default. The story is not restated here.

    async fn prepare(&mut self, store: &Arc<FrameStore>, idx: u32) -> Result<()> {
        if let Some(tap) = &mut self.tap {
            tap.begin_frame(idx);
        }
        let t0 = Instant::now();
        let result = self.inner.prepare(store, idx).await;
        if let Some(tap) = &mut self.tap {
            tap.record_prepare(micros_since(t0));
        }
        result
    }

    fn locate<'s>(&mut self, store: &'s FrameStore, idx: u32) -> Result<&'s [u8]> {
        let t0 = Instant::now();
        let result = self.inner.locate(store, idx);
        if let Some(tap) = &mut self.tap {
            match &result {
                Ok(bytes) => tap.record_locate(micros_since(t0), LocateOutcome::Ok, bytes.len()),
                Err(_) => tap.record_locate(micros_since(t0), LocateOutcome::NotFound, 0),
            }
        }
        result
    }

    async fn send(&mut self, idx: u32, bytes: &[u8]) -> Result<usize> {
        let t0 = Instant::now();
        let result = self.inner.send(idx, bytes).await;
        if let Some(tap) = &mut self.tap {
            match &result {
                Ok(sent) => tap.emit_sent(micros_since(t0), *sent),
                Err(_) => tap.emit_write_err(micros_since(t0)),
            }
        }
        result
    }

    async fn refuse(&mut self, control: &mut SendStream, idx: u32, err: Error) -> Result<()> {
        if let Some(tap) = &mut self.tap {
            tap.emit_refused();
        }
        self.inner.refuse(control, idx, err).await
    }

    async fn drain_acks(&mut self) {
        self.inner.drain_acks().await;
    }
}
