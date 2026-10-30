//! Everything a session writes — frames and refusals — through one owner per transport; the
//! codestream handed to quinn whole and uncopied. `docs/adr/disk-access.md`.

#[cfg(feature = "lab-levers")]
use crate::transport::lab_levers::SessionLevers;
use crate::transport::server::Sessions;
use crate::transport::stream_mode::StreamMode;
use crate::transport::websocket::WsWriter;
use crate::transport::wire::write_fod_msg;
use anyhow::{Context, Result};
use bytes::Bytes;
use fod::FodMsg;
use frame_envelope::frame_head;
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
        #[cfg(feature = "lab-levers")]
        lab: SessionLevers,
    },
    /// One ordered TCP stream carries frames and refusals alike.
    WebSocket(WsWriter),
    /// No connection: sending panics, so a test can build a session but not serve on it.
    #[cfg(test)]
    Detached,
}

pub(crate) enum Media {
    Shared(SendStream),
    PerFrame(FrameStreams),
}

/// One stream per frame, each ranked below the last.
pub(crate) struct FrameStreams {
    acks: JoinSet<()>,
    seq: u32,
    /// The asks served when they rank above every fill: `per-frame-asks-first`.
    #[cfg(feature = "lab-levers")]
    asks: Option<u32>,
}

/// The opening ask is served before the client opens control, so its stream may still be coming.
pub(crate) enum ControlStream {
    Open(SendStream),
    Coming(oneshot::Receiver<SendStream>),
    Gone,
}

impl Link {
    pub(super) async fn quic(sessions: &Sessions, connection: Connection, control: ControlStream) -> Result<Self> {
        let media = match sessions.mode {
            StreamMode::Shared => Media::Shared(
                connection
                    .open_uni()
                    .await
                    .context("open shared uni")?
                    .await
                    .context("shared uni ready")?,
            ),
            StreamMode::PerFrame => Media::PerFrame(FrameStreams::default()),
            #[cfg(feature = "lab-levers")]
            StreamMode::PerFrameAsksFirst => Media::PerFrame(FrameStreams { asks: Some(0), ..FrameStreams::default() }),
        };
        Ok(Self::Quic {
            media,
            control,
            connection,
            #[cfg(feature = "lab-levers")]
            lab: sessions.lab,
        })
    }

    /// `body` is the whole codestream in the reader's own buffer; quinn keeps it until the
    /// peer acknowledges it and the pool gets it back. `media/frame_pool.rs`.
    pub(crate) async fn send_frame(&mut self, idx: u32, body: Bytes, ask: bool) -> Result<()> {
        let head = Bytes::copy_from_slice(&frame_head(idx, body.len() as u32));
        match self {
            Self::Quic { media, connection, #[cfg(feature = "lab-levers")] lab, .. } => {
                if ask && tracing::enabled!(Level::DEBUG) {
                    let path = connection.quic_connection().stats().path;
                    debug!(frame = idx, cwnd = path.cwnd, rtt_us = path.rtt.as_micros() as u64, "ask written");
                }
                #[cfg(feature = "lab-levers")]
                if let Some(budget) = lab.before_frame(connection, (head.len() + body.len()) as u64) {
                    return media.stall(connection, head, body, budget, ask).await;
                }
                media.send(connection, head, body, ask).await
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
            Self::Quic { media: Media::PerFrame(streams), .. } => {
                let _ = tokio::time::timeout(Duration::from_secs(2), async {
                    while streams.acks.join_next().await.is_some() {}
                })
                .await;
            }
            Self::WebSocket(ws) => ws.close().await,
            _ => {}
        }
    }
}

impl Media {
    async fn send(&mut self, connection: &Connection, head: Bytes, body: Bytes, ask: bool) -> Result<()> {
        match self {
            Self::Shared(uni) => write_frame(uni, head, body).await,
            Self::PerFrame(streams) => {
                let mut uni = streams.open(connection, ask).await?;
                write_frame(&mut uni, head, body).await?;
                streams.acks.spawn(async move {
                    let _ = uni.finish().await;
                });
                while streams.acks.try_join_next().is_some() {}
                Ok(())
            }
        }
    }
}

impl FrameStreams {
    async fn open(&mut self, connection: &Connection, ask: bool) -> Result<SendStream> {
        let uni = connection
            .open_uni()
            .await
            .context("open uni")?
            .await
            .context("open uni ready")?;
        let _ = uni.set_priority(self.rank(ask));
        Ok(uni)
    }

    fn rank(&mut self, #[cfg_attr(not(feature = "lab-levers"), allow(unused_variables))] ask: bool) -> i32 {
        #[cfg(feature = "lab-levers")]
        if let Some(asks) = self.asks.as_mut().filter(|_| ask) {
            return take_ask_priority(asks);
        }
        take_priority(&mut self.seq)
    }
}

impl Default for FrameStreams {
    fn default() -> Self {
        Self {
            acks: JoinSet::new(),
            seq: 0,
            #[cfg(feature = "lab-levers")]
            asks: None,
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

/// The next stream's priority, one rank below the last.
fn take_priority(seq: &mut u32) -> i32 {
    let p = ask_priority(*seq);
    *seq = seq.saturating_add(1);
    p
}

async fn write_frame(uni: &mut SendStream, head: Bytes, body: Bytes) -> Result<()> {
    uni.quic_stream_mut()
        .write_all_chunks(&mut [head, body])
        .await
        .context("write frame")
}

#[cfg(feature = "lab-levers")]
impl Media {
    /// The lab stall: the envelope's first `budget` bytes on a stream never finished, then
    /// nothing until the peer closes. `--stall-after-bytes`.
    async fn stall(&mut self, connection: &Connection, head: Bytes, body: Bytes, budget: usize, ask: bool) -> Result<()> {
        let (head, body, _) = within(head, body, budget);
        match self {
            Self::Shared(uni) => write_frame(uni, head, body).await?,
            Self::PerFrame(streams) => {
                let mut uni = streams.open(connection, ask).await?;
                write_frame(&mut uni, head, body).await?;
                // A dropped stream is finished, so the cut one is held open instead.
                streams.acks.spawn(async move {
                    std::future::pending::<()>().await;
                    drop(uni);
                });
            }
        }
        connection.closed().await;
        anyhow::bail!("the session stalled after its byte budget")
    }
}

#[cfg(feature = "lab-levers")]
/// The envelope's first `budget` bytes as head and body, and whether that is all of it.
fn within(head: Bytes, body: Bytes, budget: usize) -> (Bytes, Bytes, bool) {
    let whole = budget >= head.len() + body.len();
    let body = body.slice(..budget.saturating_sub(head.len()).min(body.len()));
    (head.slice(..budget.min(head.len())), body, whole)
}

#[cfg(feature = "lab-levers")]
/// Above every fill's rank (≤ 0), earlier asks above later ones.
fn take_ask_priority(asks: &mut u32) -> i32 {
    let p = i32::MAX - i32::try_from(*asks).unwrap_or(i32::MAX).min(i32::MAX - 1);
    *asks = asks.saturating_add(1);
    p
}

#[cfg(test)]
mod tests;
