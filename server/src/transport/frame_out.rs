//! Wire seam: session-scoped outbound media (`FrameOut`).
//!
//! Opens shared or per-frame uni streams and writes length-prefixed envelopes.
//! The per-frame app story lives in [`super::pipeline`]; see `docs/telemetry/adr-server-pipeline.md`.

use crate::transport::stream_mode::StreamMode;
use anyhow::{Context, Result};
use frame_envelope::ENVELOPE_LEN;
use std::time::{Duration, Instant};
use tokio::task::JoinSet;
use wtransport::stream::SendStream;
use wtransport::Connection;

/// Called once when the peer has acknowledged every byte of a per-frame stream, with the time
/// since the last byte was accepted by the send buffer. `None` costs nothing and is all the
/// product ever passes; the lab pipeline supplies one. Never called in shared mode, where no
/// stream is finished per frame.
pub(crate) type AckHook = Option<Box<dyn FnOnce(Duration) + Send + 'static>>;

/// Outbound path chosen once per session.
pub(crate) enum FrameOut {
    Shared {
        uni: SendStream,
        /// Keeps the QUIC connection alive for the session-scoped uni.
        _connection: Connection,
    },
    PerFrame {
        connection: Connection,
        acks: JoinSet<()>,
    },
}

impl FrameOut {
    pub(crate) async fn open(mode: StreamMode, connection: Connection) -> Result<Self> {
        match mode {
            StreamMode::Shared => {
                let uni = connection
                    .open_uni()
                    .await
                    .context("open shared uni")?
                    .await
                    .context("shared uni ready")?;
                Ok(Self::Shared {
                    uni,
                    _connection: connection,
                })
            }
            StreamMode::PerFrame => Ok(Self::PerFrame {
                connection,
                acks: JoinSet::new(),
            }),
        }
    }

    pub(crate) async fn send_frame(
        &mut self,
        idx: u32,
        codestream: &[u8],
        on_ack: AckHook,
    ) -> Result<()> {
        let envelope_len = (ENVELOPE_LEN + codestream.len()) as u32;
        let len = envelope_len.to_be_bytes();
        let index = idx.to_be_bytes();
        match self {
            Self::Shared { uni, .. } => {
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

                // The clock is read only when someone asked to hear about the ack.
                let sent_at = on_ack.as_ref().map(|_| Instant::now());
                acks.spawn(async move {
                    let _ = uni.finish().await;
                    if let (Some(hook), Some(t)) = (on_ack, sent_at) {
                        hook(t.elapsed());
                    }
                });
            }
        }
        Ok(())
    }

    pub(crate) async fn drain_acks(&mut self) {
        if let Self::PerFrame { acks, .. } = self {
            let _ = tokio::time::timeout(Duration::from_secs(2), async {
                while acks.join_next().await.is_some() {}
            })
            .await;
        }
    }
}
