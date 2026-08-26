//! Stream mode and frame delivery — one place owns how frames reach the client.

use crate::record::DeliverOutcome;
use anyhow::{Context, Result};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::task::JoinSet;
use wtransport::stream::SendStream;
use wtransport::Connection;

/// Maximum envelope payload (64 MiB), matching the harness guard.
pub const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

/// How frames reach the client. Chosen once per session; nothing downstream branches on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum StreamMode {
    /// One uni stream for the whole session. Frames strictly in ask order.
    Shared,
    /// One uni stream per frame. Independent delivery; allows `set_priority` and `reset`.
    PerFrame,
}

impl StreamMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "shared",
            Self::PerFrame => "per-frame",
        }
    }
}

/// Stamp captured when the peer acknowledges a per-frame stream.
pub trait PeerAckStamp: Copy + Send + 'static {
    fn at_peer_ack() -> Self;
}

impl PeerAckStamp for () {
    fn at_peer_ack() -> Self {}
}

#[cfg(feature = "telemetry")]
impl PeerAckStamp for std::time::Instant {
    fn at_peer_ack() -> Self {
        std::time::Instant::now()
    }
}

/// `S` is `R::Stamp` from the recording seam. It crosses into the delivery task and
/// comes back on the ack channel, so **no clock is read in the session loop** (record seam I2).
pub enum FrameSink<S: PeerAckStamp> {
    Shared(SendStream),
    PerFrame {
        conn: Connection,
        tasks: JoinSet<()>,
        ack_tx: UnboundedSender<Ack<S>>,
        ack_rx: UnboundedReceiver<Ack<S>>,
    },
}

pub struct Ack<S> {
    pub frame_index: u32,
    pub since: S,
    pub outcome: DeliverOutcome,
}

impl<S: PeerAckStamp> FrameSink<S> {
    pub async fn open(connection: &Connection, mode: StreamMode) -> Result<Self> {
        match mode {
            StreamMode::Shared => {
                let uni = connection
                    .open_uni()
                    .await
                    .context("open shared uni")?
                    .await
                    .context("shared uni ready")?;
                Ok(Self::Shared(uni))
            }
            StreamMode::PerFrame => {
                let (ack_tx, ack_rx) = mpsc::unbounded_channel();
                Ok(Self::PerFrame {
                    conn: connection.clone(),
                    tasks: JoinSet::new(),
                    ack_tx,
                    ack_rx,
                })
            }
        }
    }

    pub fn try_recv_ack(&mut self) -> Option<Ack<S>> {
        match self {
            Self::PerFrame { ack_rx, .. } => ack_rx.try_recv().ok(),
            Self::Shared(_) => None,
        }
    }

    pub async fn send(&mut self, idx: u32, payload: &[u8]) -> Result<()> {
        let framed = length_prefixed(payload);
        match self {
            Self::Shared(uni) => {
                uni.write_all(&framed).await.context("write shared frame")?;
            }
            Self::PerFrame { conn, tasks, ack_tx, .. } => {
                let mut uni = conn
                    .open_uni()
                    .await
                    .context("open uni")?
                    .await
                    .context("open uni ready")?;
                uni.write_all(&framed)
                    .await
                    .context("write per-frame envelope")?;

                // Option C: `finish().await` off the session loop, not deleted.
                let acks = ack_tx.clone();
                tasks.spawn(async move {
                    let outcome = match uni.finish().await {
                        Ok(()) => DeliverOutcome::Acked,
                        Err(_) => DeliverOutcome::Failed,
                    };
                    let _ = acks.send(Ack {
                        frame_index: idx,
                        since: S::at_peer_ack(),
                        outcome,
                    });
                });
            }
        }
        Ok(())
    }

    pub async fn drain(&mut self) {
        if let Self::PerFrame { tasks, .. } = self {
            while tasks.join_next().await.is_some() {}
        }
    }
}

impl<S: PeerAckStamp> Drop for FrameSink<S> {
    fn drop(&mut self) {
        if let Self::PerFrame { tasks, .. } = self {
            tasks.abort_all();
        }
    }
}

/// `[4B BE len][payload]`
pub fn length_prefixed(payload: &[u8]) -> Vec<u8> {
    let len = payload.len().min(u32::MAX as usize) as u32;
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(payload);
    out
}

/// Returns `(payload, consumed_bytes)` when a full frame is present.
pub fn parse_length_prefixed(buf: &[u8]) -> Option<(&[u8], usize)> {
    if buf.len() < 4 {
        return None;
    }
    let len = u32::from_be_bytes(buf[..4].try_into().ok()?) as usize;
    if len == 0 || len > MAX_FRAME_LEN {
        return None;
    }
    let total = 4 + len;
    if buf.len() < total {
        return None;
    }
    Some((&buf[4..total], total))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn length_prefixed_round_trip() {
        let payload = b"hello envelope";
        let framed = length_prefixed(payload);
        let (got, n) = parse_length_prefixed(&framed).unwrap();
        assert_eq!(got, payload);
        assert_eq!(n, framed.len());
    }

    #[test]
    fn length_prefixed_zero_rejected() {
        assert!(parse_length_prefixed(&0u32.to_be_bytes()).is_none());
    }

    #[test]
    fn length_prefixed_truncated_prefix() {
        assert!(parse_length_prefixed(&[0, 0, 0]).is_none());
    }

    #[test]
    fn length_prefixed_truncated_body() {
        let mut framed = length_prefixed(b"x");
        framed.pop();
        assert!(parse_length_prefixed(&framed).is_none());
    }

    #[test]
    fn length_prefixed_over_max_rejected() {
        let len = (MAX_FRAME_LEN as u32 + 1).to_be_bytes();
        assert!(parse_length_prefixed(&len).is_none());
    }
}
