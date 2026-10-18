//! Everything a session writes — frames and refusals — through one owner per transport; the
//! codestream handed to quinn whole and uncopied. `docs/adr/disk-access.md`.

use crate::transport::stream_mode::StreamMode;
use crate::transport::websocket::WsWriter;
use crate::transport::wire::write_fod_msg;
use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use fod::FodMsg;
use frame_envelope::{frame_head, FRAME_HEAD_LEN};
use std::time::Duration;
use tokio::sync::oneshot;
use tokio::task::JoinSet;
use tracing::{debug, warn, Level};
use wtransport::stream::SendStream;
use wtransport::Connection;

pub(crate) enum Link {
    Quic {
        media: Media,
        control: ControlStream,
        connection: Connection,
        /// Lab only: envelope bytes left before the session stalls. `--stall-after-bytes`, under `lab-levers`.
        stall_left: Option<u64>,
        /// Lab only: the send window is set to cwnd + this before each frame. `--send-window-follows-cwnd`.
        cwnd_ahead: Option<u64>,
    },
    /// One ordered TCP stream carries frames and refusals alike.
    WebSocket(WsWriter),
    /// No connection: sending panics, so a test can build a session but not serve on it.
    #[cfg(test)]
    Detached,
}

pub(crate) enum Media {
    Shared(SendStream),
    /// `asks` counts the asks served when they rank above every fill (`per-frame-asks-first`).
    PerFrame { acks: JoinSet<()>, seq: u32, asks: Option<u32> },
}

/// The opening ask is served before the client opens control, so its stream may still be coming.
pub(crate) enum ControlStream {
    Open(SendStream),
    Coming(oneshot::Receiver<SendStream>),
    Gone,
}

impl Link {
    pub(crate) async fn quic(
        mode: StreamMode,
        connection: Connection,
        control: ControlStream,
        stall_left: Option<u64>,
        cwnd_ahead: Option<u64>,
    ) -> Result<Self> {
        let media = match mode {
            StreamMode::Shared => Media::Shared(
                connection
                    .open_uni()
                    .await
                    .context("open shared uni")?
                    .await
                    .context("shared uni ready")?,
            ),
            StreamMode::PerFrame => Media::PerFrame { acks: JoinSet::new(), seq: 0, asks: None },
            StreamMode::PerFrameAsksFirst => Media::PerFrame { acks: JoinSet::new(), seq: 0, asks: Some(0) },
        };
        Ok(Self::Quic { media, control, connection, stall_left, cwnd_ahead })
    }

    /// `body` is the whole codestream in the reader's own buffer; quinn keeps it until the
    /// peer acknowledges it and the pool gets it back. `media/frame_pool.rs`.
    pub(crate) async fn send_frame(&mut self, idx: u32, body: Bytes, ask: bool) -> Result<()> {
        let head = Bytes::copy_from_slice(&frame_head(idx, body.len() as u32));
        match self {
            Self::Quic { media, connection, stall_left, cwnd_ahead, .. } => {
                if ask && tracing::enabled!(Level::DEBUG) {
                    let path = connection.quic_connection().stats().path;
                    debug!(frame = idx, cwnd = path.cwnd, rtt_us = path.rtt.as_micros() as u64, "ask written");
                }
                if let Some(ahead) = cwnd_ahead {
                    let quic = connection.quic_connection();
                    quic.set_send_window(quic.stats().path.cwnd + *ahead);
                }
                let whole = (FRAME_HEAD_LEN + body.len()) as u64;
                match stall_left {
                    Some(left) if whole > *left => {
                        let (head, body, whole) = within(head, body, *left as usize);
                        media.send(connection, head, body, whole, ask).await?;
                        connection.closed().await;
                        Err(anyhow!("the session stalled after its byte budget"))
                    }
                    _ => {
                        if let Some(left) = stall_left {
                            *left -= whole;
                        }
                        media.send(connection, head, body, true, ask).await
                    }
                }
            }
            Self::WebSocket(ws) => ws.send_frame(head, body).await,
            #[cfg(test)]
            Self::Detached => unreachable!("a detached link has no wire to write to"),
        }
    }

    pub(crate) async fn refuse(&mut self, frame: u32, reason: String) -> Result<()> {
        warn!(frame, %reason, "frame refused");
        let msg = FodMsg::FrameError { frame_index: frame, reason };
        match self {
            Self::Quic { control, .. } => control.write(&msg).await,
            Self::WebSocket(ws) => ws.send_fod(&msg).await,
            #[cfg(test)]
            Self::Detached => Ok(()),
        }
    }

    /// However the session ended: per-frame streams get their grace, a WebSocket its close.
    pub(crate) async fn finish(&mut self) {
        match self {
            Self::Quic { media: Media::PerFrame { acks, .. }, .. } => {
                let _ = tokio::time::timeout(Duration::from_secs(2), async {
                    while acks.join_next().await.is_some() {}
                })
                .await;
            }
            Self::WebSocket(ws) => ws.close().await,
            _ => {}
        }
    }
}

impl Media {
    /// `whole` false is the lab stall's cut frame, whose stream must never finish.
    async fn send(&mut self, connection: &Connection, head: Bytes, body: Bytes, whole: bool, ask: bool) -> Result<()> {
        match self {
            Self::Shared(uni) => write_frame(uni, head, body).await,
            Self::PerFrame { acks, seq, asks } => {
                let mut uni = connection
                    .open_uni()
                    .await
                    .context("open uni")?
                    .await
                    .context("open uni ready")?;
                let priority = match asks {
                    Some(asks) if ask => take_ask_priority(asks),
                    _ => take_priority(seq),
                };
                let _ = uni.set_priority(priority);
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
                Ok(())
            }
        }
    }
}

impl ControlStream {
    /// A refusal with no control stream to carry it is dropped once none can come.
    pub(crate) async fn write(&mut self, msg: &FodMsg) -> Result<()> {
        if let Self::Coming(coming) = self {
            *self = coming.await.map_or(Self::Gone, Self::Open);
        }
        match self {
            Self::Open(send) => write_fod_msg(send, msg).await,
            _ => Ok(()),
        }
    }
}

/// The envelope's first `budget` bytes as head and body, and whether that is all of it.
fn within(head: Bytes, body: Bytes, budget: usize) -> (Bytes, Bytes, bool) {
    let whole = budget >= head.len() + body.len();
    let body = body.slice(..budget.saturating_sub(head.len()).min(body.len()));
    (head.slice(..budget.min(head.len())), body, whole)
}

/// Earlier asks outrank later ones, so quinn sends a lost frame's retransmit before newer
/// frames' data instead of behind every stream already queued. `docs/adr/stream-shape.md`.
fn ask_priority(seq: u32) -> i32 {
    i32::try_from(seq).map_or(i32::MIN, |s| -s)
}

/// The next stream's priority, one rank below the last.
fn take_priority(seq: &mut u32) -> i32 {
    let p = ask_priority(*seq);
    *seq = seq.saturating_add(1);
    p
}

/// Above every fill's rank (≤ 0), earlier asks above later ones.
fn take_ask_priority(asks: &mut u32) -> i32 {
    let p = i32::MAX - i32::try_from(*asks).unwrap_or(i32::MAX).min(i32::MAX - 1);
    *asks = asks.saturating_add(1);
    p
}

async fn write_frame(uni: &mut SendStream, head: Bytes, body: Bytes) -> Result<()> {
    uni.quic_stream_mut()
        .write_all_chunks(&mut [head, body])
        .await
        .context("write frame")
}

#[cfg(test)]
mod tests;
