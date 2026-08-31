//! Send-path seam: product `LiveSink` vs lab `RecordedSink` decorator (telemetry Option B).
//!
//! Outbound mode is a type (`FrameOut`) chosen once per session — not an `Option<SendStream>`
//! re-checked on every frame. `ask(idx)` stays explicit on `FrameSink` (batch asks).

use anyhow::{Context, Result};
use frame_envelope::ENVELOPE_LEN;
use std::future::Future;
use std::time::Duration;
use tokio::task::JoinSet;
use wtransport::stream::SendStream;
use wtransport::Connection;

#[cfg(feature = "telemetry")]
use crate::record::{LocateOutcome, Recorder, WriteOutcome};

/// Outbound frame path the session loop talks to.
pub(crate) trait FrameSink: Send {
    fn ask(&mut self, idx: u32);

    /// Run locate; lab sink stamps around `f`.
    fn time_locate<'a>(
        &mut self,
        f: impl FnOnce() -> Result<&'a [u8]>,
    ) -> Result<&'a [u8]>;

    fn on_refused(&mut self);

    fn send_frame<'a>(
        &'a mut self,
        idx: u32,
        bytes: &'a [u8],
    ) -> impl Future<Output = Result<()>> + Send + 'a;

    fn drain_acks(&mut self) -> impl Future<Output = ()> + Send;
}

/// Mode decided once at session start. Shared never owns `acks`; PerFrame never owns a session uni.
pub(crate) enum FrameOut {
    Shared {
        uni: SendStream,
    },
    PerFrame {
        connection: Connection,
        acks: JoinSet<()>,
    },
}

impl FrameOut {
    pub(crate) fn shared(uni: SendStream) -> Self {
        Self::Shared { uni }
    }

    pub(crate) fn per_frame(connection: Connection) -> Self {
        Self::PerFrame {
            connection,
            acks: JoinSet::new(),
        }
    }

    pub(crate) fn is_shared(&self) -> bool {
        matches!(self, Self::Shared { .. })
    }

    async fn send_frame(&mut self, idx: u32, codestream: &[u8]) -> Result<()> {
        let envelope_len = (ENVELOPE_LEN + codestream.len()) as u32;
        let len = envelope_len.to_be_bytes();
        let index = idx.to_be_bytes();
        match self {
            Self::Shared { uni } => {
                uni.write_all(&len).await.context("write shared len")?;
                uni.write_all(&index).await.context("write shared index")?;
                uni.write_all(codestream)
                    .await
                    .context("write shared codestream")?;
            }
            Self::PerFrame { connection, acks } => {
                let mut uni = connection
                    .open_uni()
                    .await
                    .context("open uni")?
                    .await
                    .context("open uni ready")?;
                uni.write_all(&len).await.context("write len")?;
                uni.write_all(&index).await.context("write index")?;
                uni.write_all(codestream)
                    .await
                    .context("write codestream")?;

                // `finish()` is MOVED off this loop, not deleted: wtransport's `finish()` awaits
                // the peer's acknowledgement (~272 ms measured), which caps throughput at
                // Tf/(Tf+RTT) when awaited inline. See docs/adr-frame-framing-and-loop-shape.md.
                acks.spawn(async move {
                    let _ = uni.finish().await;
                });
            }
        }
        Ok(())
    }

    async fn drain_acks(&mut self) {
        if let Self::PerFrame { acks, .. } = self {
            let _ = tokio::time::timeout(Duration::from_secs(2), async {
                while acks.join_next().await.is_some() {}
            })
            .await;
        }
    }
}

/// Product sink — zero telemetry tokens in method bodies.
pub(crate) struct LiveSink {
    out: FrameOut,
}

impl LiveSink {
    pub(crate) fn new(out: FrameOut) -> Self {
        Self { out }
    }
}

impl FrameSink for LiveSink {
    fn ask(&mut self, _idx: u32) {}

    fn time_locate<'a>(
        &mut self,
        f: impl FnOnce() -> Result<&'a [u8]>,
    ) -> Result<&'a [u8]> {
        f()
    }

    fn on_refused(&mut self) {}

    async fn send_frame(&mut self, idx: u32, bytes: &[u8]) -> Result<()> {
        self.out.send_frame(idx, bytes).await
    }

    async fn drain_acks(&mut self) {
        self.out.drain_acks().await;
    }
}

/// Lab decorator — stamp, delegate, stamp. Compiled only with `telemetry`.
#[cfg(feature = "telemetry")]
pub(crate) struct RecordedSink<S: FrameSink> {
    pub inner: S,
    pub rec: Recorder,
}

#[cfg(feature = "telemetry")]
impl<S: FrameSink> FrameSink for RecordedSink<S> {
    fn ask(&mut self, idx: u32) {
        self.rec.ask(idx);
        self.inner.ask(idx);
    }

    fn time_locate<'a>(
        &mut self,
        f: impl FnOnce() -> Result<&'a [u8]>,
    ) -> Result<&'a [u8]> {
        let t0 = self.rec.stamp();
        match f() {
            Ok(bytes) => {
                self.rec
                    .located(t0, LocateOutcome::Ok, bytes.len());
                Ok(bytes)
            }
            Err(err) => {
                self.rec.located(t0, LocateOutcome::NotFound, 0);
                Err(err)
            }
        }
    }

    fn on_refused(&mut self) {
        let t0 = self.rec.stamp();
        self.rec.wrote(t0, WriteOutcome::Refused, 0);
        self.inner.on_refused();
    }

    async fn send_frame(&mut self, idx: u32, bytes: &[u8]) -> Result<()> {
        let t0 = self.rec.stamp();
        let envelope_len = ENVELOPE_LEN + bytes.len();
        match self.inner.send_frame(idx, bytes).await {
            Ok(()) => {
                self.rec
                    .wrote(t0, WriteOutcome::Sent, envelope_len);
                Ok(())
            }
            Err(err) => {
                self.rec.wrote(t0, WriteOutcome::WriteErr, 0);
                Err(err)
            }
        }
    }

    async fn drain_acks(&mut self) {
        self.inner.drain_acks().await;
    }
}

#[cfg(all(test, feature = "telemetry"))]
mod tests {
    use super::*;
    use crate::record::{LocateOutcome, WriteOutcome};

    struct FakeSink {
        sent: Vec<(u32, usize)>,
    }

    impl FrameSink for FakeSink {
        fn ask(&mut self, _idx: u32) {}
        fn time_locate<'a>(
            &mut self,
            f: impl FnOnce() -> Result<&'a [u8]>,
        ) -> Result<&'a [u8]> {
            f()
        }
        fn on_refused(&mut self) {}
        async fn send_frame(&mut self, idx: u32, bytes: &[u8]) -> Result<()> {
            self.sent.push((idx, bytes.len()));
            Ok(())
        }
        async fn drain_acks(&mut self) {}
    }

    #[tokio::test]
    async fn recorded_sink_delegates_send() {
        let inner = FakeSink { sent: vec![] };
        let mut sink = RecordedSink {
            inner,
            rec: Recorder::for_session(),
        };
        sink.ask(7);
        let body = b"codestream";
        let got = sink.time_locate(|| Ok(body.as_slice())).unwrap();
        assert_eq!(got, body);
        sink.send_frame(7, got).await.unwrap();
        assert_eq!(sink.inner.sent, vec![(7, body.len())]);
        let _ = (LocateOutcome::Ok, WriteOutcome::Sent);
    }
}
