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
use tracing::warn;
use wtransport::stream::SendStream;
use wtransport::Connection;

pub(crate) enum Link {
    Quic {
        media: Media,
        control: ControlStream,
        connection: Connection,
        /// Lab only: envelope bytes left before the session stalls. `--stall-after-bytes`.
        stall_left: Option<u64>,
    },
    /// One ordered TCP stream carries frames and refusals alike.
    WebSocket(WsWriter),
    /// No connection: sending panics, so a test can build a session but not serve on it.
    #[cfg(test)]
    Detached,
}

pub(crate) enum Media {
    Shared(SendStream),
    PerFrame { acks: JoinSet<()>, seq: u32 },
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
            StreamMode::PerFrame => Media::PerFrame { acks: JoinSet::new(), seq: 0 },
        };
        Ok(Self::Quic { media, control, connection, stall_left })
    }

    /// `body` is the whole codestream in the reader's own buffer; quinn keeps it until the
    /// peer acknowledges it and the pool gets it back. `media/frame_pool.rs`.
    pub(crate) async fn send_frame(&mut self, idx: u32, body: Bytes) -> Result<()> {
        let head = Bytes::copy_from_slice(&frame_head(idx, body.len() as u32));
        match self {
            Self::Quic { media, connection, stall_left, .. } => {
                let whole = (FRAME_HEAD_LEN + body.len()) as u64;
                match stall_left {
                    Some(left) if whole > *left => {
                        let budget = *left as usize;
                        let body = body.slice(..budget.saturating_sub(head.len()).min(body.len()));
                        let head = head.slice(..budget.min(head.len()));
                        media.send(connection, head, body, false).await?;
                        connection.closed().await;
                        Err(anyhow!("the session stalled after its byte budget"))
                    }
                    _ => {
                        if let Some(left) = stall_left {
                            *left -= whole;
                        }
                        media.send(connection, head, body, true).await
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
    async fn send(&mut self, connection: &Connection, head: Bytes, body: Bytes, whole: bool) -> Result<()> {
        match self {
            Self::Shared(uni) => write_frame(uni, head, body).await,
            Self::PerFrame { acks, seq } => {
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

    /// A refusal in a session whose control stream never came returns once the session has
    /// closed, rather than waiting for a stream that cannot arrive.
    #[test]
    fn a_refusal_with_no_control_stream_returns_once_the_session_closes() {
        let (closed, coming) = oneshot::channel();
        let mut control = ControlStream::Coming(coming);
        drop(closed);
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("rt");
        rt.block_on(async {
            let msg = FodMsg::FrameError { frame_index: 9, reason: "out of range".into() };
            tokio::time::timeout(Duration::from_secs(2), control.write(&msg))
                .await
                .expect("the refusal waited on a control stream that can no longer come")
                .expect("refuse");
        });
        assert!(matches!(control, ControlStream::Gone), "a control stream that cannot come is still awaited");
    }

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
