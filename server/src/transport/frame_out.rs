//! Session-scoped outbound media: length-prefixed envelopes on one shared uni or one per frame; the codestream handed to quinn whole and uncopied. `docs/adr/disk-access.md`.

use crate::transport::stream_mode::StreamMode;
use crate::transport::websocket::WsSink;
use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use frame_envelope::frame_head;
use std::time::Duration;
use tokio::task::JoinSet;
use wtransport::stream::SendStream;
use wtransport::Connection;

pub(crate) enum FrameOut {
    Shared {
        uni: SendStream,
        /// Keeps the QUIC connection alive for the session-scoped uni.
        _connection: Connection,
    },
    PerFrame {
        connection: Connection,
        acks: JoinSet<()>,
        seq: u32,
    },
    /// One ordered TCP stream, which the session's refusals share.
    WebSocket(WsSink),
    /// No connection: sending panics, so a test can build a session but not serve on it.
    #[cfg(test)]
    Detached,
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
                seq: 0,
            }),
        }
    }

    /// `body` is the whole codestream in the reader's own buffer; quinn keeps it until the
    /// peer acknowledges it and the pool gets it back. `media/frame_pool.rs`.
    pub(crate) async fn send_frame(&mut self, idx: u32, body: Bytes) -> Result<()> {
        self.send_prefix(idx, body, usize::MAX).await
    }

    /// Lab only: the frame's first `budget` envelope bytes, then nothing — no FIN — until the peer
    /// leaves. WebKit bug 319818's flow control. `docs/ARCHITECTURE.md` §Recycling before the stall.
    pub(crate) async fn stall_within(&mut self, idx: u32, body: Bytes, budget: usize) -> Result<()> {
        self.send_prefix(idx, body, budget).await?;
        match self {
            Self::Shared { _connection: c, .. } | Self::PerFrame { connection: c, .. } => {
                c.closed().await;
            }
            _ => std::future::pending().await,
        }
        Err(anyhow!("the session stalled after its byte budget"))
    }

    async fn send_prefix(&mut self, idx: u32, body: Bytes, budget: usize) -> Result<()> {
        let head = Bytes::copy_from_slice(&frame_head(idx, body.len() as u32));
        let whole = budget >= head.len() + body.len();
        let body = body.slice(..budget.saturating_sub(head.len()).min(body.len()));
        let head = head.slice(..budget.min(head.len()));
        match self {
            Self::Shared { uni, .. } => write_frame(uni, head, body).await?,
            Self::WebSocket(ws) => ws.send_frame(head, body).await?,
            Self::PerFrame { connection, acks, seq } => {
                let mut uni = connection
                    .open_uni()
                    .await
                    .context("open uni")?
                    .await
                    .context("open uni ready")?;
                let _ = uni.set_priority(ask_priority(*seq));
                *seq = seq.saturating_add(1);
                write_frame(&mut uni, head, body).await?;
                // A dropped stream is finished, so a cut one is held open instead.
                acks.spawn(async move {
                    if whole {
                        let _ = uni.finish().await;
                    } else {
                        std::future::pending::<()>().await;
                    }
                });
                while acks.try_join_next().is_some() {}
            }
            #[cfg(test)]
            Self::Detached => unreachable!("a detached sink has no wire to write to"),
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

/// Earlier asks outrank later ones, so quinn sends a lost frame's retransmit before newer
/// frames' data instead of behind every stream already queued. `docs/adr/stream-shape.md`.
fn ask_priority(seq: u32) -> i32 {
    i32::try_from(seq).map_or(i32::MIN, |s| -s)
}

async fn write_frame(uni: &mut SendStream, head: Bytes, body: Bytes) -> Result<()> {
    uni.quic_stream_mut()
        .write_all_chunks(&mut [head, body])
        .await
        .context("write frame")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ask order is stream priority: every later frame ranks strictly below every earlier one,
    /// and the sequence never wraps back above an earlier frame.
    #[test]
    fn later_asks_rank_strictly_below_earlier_ones() {
        let mut last = ask_priority(0);
        for seq in [1u32, 2, 1000, i32::MAX as u32, u32::MAX] {
            let p = ask_priority(seq);
            assert!(p < last, "ask {seq} ranks at {p}, not below {last}");
            last = p;
        }
    }
}
