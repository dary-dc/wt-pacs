//! Wire seam: session-scoped outbound media (`FrameOut`).
//!
//! Opens shared or per-frame uni streams and writes length-prefixed envelopes.
//! The write path is chunked (`Bytes` + `write_all_chunks`). The per-frame app
//! story lives in [`super::pipeline`].

use crate::transport::assemble::chunked_chunks;
use crate::transport::stream_mode::StreamMode;
use anyhow::{Context, Result};
use bytes::Bytes;
use std::time::Duration;
use tokio::task::JoinSet;
use wtransport::stream::SendStream;
use wtransport::Connection;

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

    pub(crate) async fn send_frame(&mut self, idx: u32, body: Bytes) -> Result<()> {
        let mut chunks = chunked_chunks(idx, body);
        match self {
            Self::Shared { uni, .. } => {
                uni.quic_stream_mut()
                    .write_all_chunks(&mut chunks)
                    .await
                    .context("write shared frame chunks")?;
            }
            Self::PerFrame { connection, acks } => {
                let mut uni = open_frame_uni(connection).await?;
                uni.quic_stream_mut()
                    .write_all_chunks(&mut chunks)
                    .await
                    .context("write frame chunks")?;
                spawn_ack(acks, uni);
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

async fn open_frame_uni(connection: &Connection) -> Result<SendStream> {
    connection
        .open_uni()
        .await
        .context("open uni")?
        .await
        .context("open uni ready")
}

/// Move `finish()` off the serve loop, then reap cells that have already completed (§7).
fn spawn_ack(acks: &mut JoinSet<()>, mut uni: SendStream) {
    acks.spawn(async move {
        let _ = uni.finish().await;
    });
    while acks.try_join_next().is_some() {}
}
