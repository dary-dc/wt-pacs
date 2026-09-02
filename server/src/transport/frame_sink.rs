//! Outbound media path: `FrameOut` (shared uni vs per-frame + ack drain).

use crate::transport::stream_mode::StreamMode;
use anyhow::{Context, Result};
use frame_envelope::ENVELOPE_LEN;
use std::time::Duration;
use tokio::task::JoinSet;
use wtransport::stream::SendStream;
use wtransport::Connection;

/// Outbound path chosen once per session.
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
    pub(crate) async fn open(mode: StreamMode, connection: Connection) -> Result<Self> {
        match mode {
            StreamMode::Shared => {
                let uni = connection
                    .open_uni()
                    .await
                    .context("open shared uni")?
                    .await
                    .context("shared uni ready")?;
                Ok(Self::Shared { uni })
            }
            StreamMode::PerFrame => Ok(Self::PerFrame {
                connection,
                acks: JoinSet::new(),
            }),
        }
    }

    pub(crate) async fn send_frame(&mut self, idx: u32, codestream: &[u8]) -> Result<()> {
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

                acks.spawn(async move {
                    let _ = uni.finish().await;
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
