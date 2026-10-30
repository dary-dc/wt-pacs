//! Everything a session writes — frames and refusals — through one owner per transport; the
//! codestream handed to quinn whole and uncopied. `docs/adr/disk-access.md`.

use crate::transport::stream_mode::StreamMode;
use crate::transport::websocket::WsWriter;
use crate::transport::wire::{write_fod_msg, QuicStream};
use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use fod::FodMsg;
use frame_envelope::{frame_head, FRAME_HEAD_LEN};
use std::time::Duration;
use tokio::sync::oneshot;
use tokio::task::JoinSet;
use tracing::{debug, warn, Level};
use wtransport::quinn;
use wtransport::stream::SendStream;
use wtransport::Connection;

pub(crate) enum Link {
    Quic {
        media: Media,
        control: ControlStream,
        connection: QuicSession,
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

/// A session's connection: a browser's WebTransport session, or the native client's raw QUIC. `docs/WIRE.md` §The raw QUIC mapping.
pub(crate) enum QuicSession {
    WebTransport(Connection),
    Raw(quinn::Connection),
}

pub(crate) enum QuicSend {
    WebTransport(SendStream),
    Raw(quinn::SendStream),
}

pub(crate) enum Media {
    Shared(QuicSend),
    /// `asks` counts the asks served when they rank above every fill (`per-frame-asks-first`).
    PerFrame { acks: JoinSet<()>, seq: u32, asks: Option<u32> },
}

/// The opening ask is served before the client opens control, so its stream may still be coming.
pub(crate) enum ControlStream {
    Open(QuicSend),
    Coming(oneshot::Receiver<QuicSend>),
    Gone,
}

impl Link {
    pub(crate) async fn quic(
        mode: StreamMode,
        connection: QuicSession,
        control: ControlStream,
        stall_left: Option<u64>,
        cwnd_ahead: Option<u64>,
    ) -> Result<Self> {
        let media = match mode {
            StreamMode::Shared => Media::Shared(connection.open_uni().await?),
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
                    let path = connection.quic().stats().path;
                    debug!(frame = idx, cwnd = path.cwnd, rtt_us = path.rtt.as_micros() as u64, "ask written");
                }
                if let Some(ahead) = cwnd_ahead {
                    let quic = connection.quic();
                    quic.set_send_window(quic.stats().path.cwnd + *ahead);
                }
                let whole = (FRAME_HEAD_LEN + body.len()) as u64;
                match stall_left {
                    Some(left) if whole > *left => {
                        let (head, body, whole) = within(head, body, *left as usize);
                        media.send(connection, head, body, whole, ask).await?;
                        connection.quic().closed().await;
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
    async fn send(&mut self, connection: &QuicSession, head: Bytes, body: Bytes, whole: bool, ask: bool) -> Result<()> {
        match self {
            Self::Shared(uni) => write_frame(uni.quic(), head, body).await,
            Self::PerFrame { acks, seq, asks } => {
                let mut uni = connection.open_uni().await?;
                let priority = match asks {
                    Some(asks) if ask => take_ask_priority(asks),
                    _ => take_priority(seq),
                };
                let _ = uni.quic().set_priority(priority);
                write_frame(uni.quic(), head, body).await?;
                // A dropped stream is finished, so a cut one is held open instead.
                acks.spawn(async move {
                    if whole {
                        let _ = uni.quic().finish();
                        let _ = uni.quic().stopped().await;
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

impl QuicSession {
    pub(crate) fn quic(&self) -> &quinn::Connection {
        match self {
            Self::WebTransport(connection) => connection.quic_connection(),
            Self::Raw(connection) => connection,
        }
    }

    async fn open_uni(&self) -> Result<QuicSend> {
        Ok(match self {
            Self::WebTransport(connection) => {
                QuicSend::WebTransport(connection.open_uni().await.context("open uni")?.await.context("uni ready")?)
            }
            Self::Raw(connection) => QuicSend::Raw(connection.open_uni().await.context("open uni")?),
        })
    }
}

impl QuicStream<quinn::SendStream> for QuicSend {
    fn quic(&mut self) -> &mut quinn::SendStream {
        match self {
            Self::WebTransport(send) => send.quic_stream_mut(),
            Self::Raw(send) => send,
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

async fn write_frame(uni: &mut quinn::SendStream, head: Bytes, body: Bytes) -> Result<()> {
    uni.write_all_chunks(&mut [head, body])
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

    /// Each per-frame stream takes a rank below the one before it, not the same one.
    #[test]
    fn each_stream_takes_the_next_rank_down() {
        let mut seq = 0;
        let ranks: Vec<i32> = (0..3).map(|_| take_priority(&mut seq)).collect();
        assert_eq!(ranks, [0, -1, -2]);
    }

    /// With asks first, every ask ranks above every fill frame, however many of either came
    /// before, and earlier asks above later ones.
    #[test]
    fn asks_first_rank_every_ask_above_every_fill() {
        let (mut seq, mut asks) = (0, 0);
        let fill: Vec<i32> = (0..3).map(|_| take_priority(&mut seq)).collect();
        let ask: Vec<i32> = (0..3).map(|_| take_ask_priority(&mut asks)).collect();
        assert!(ask.windows(2).all(|w| w[0] > w[1]), "later asks not ranked below earlier ones: {ask:?}");
        assert!(ask.iter().all(|a| fill.iter().all(|f| a > f)), "an ask ranks at or below a fill: {ask:?} {fill:?}");
        let (mut seq, mut asks) = (0, u32::MAX);
        assert!(take_ask_priority(&mut asks) > take_priority(&mut seq), "the last ask ranks at or below the first fill");
    }

    /// A budget cuts the envelope where it ends, head first, and only a budget that covers the
    /// head and the body leaves the frame whole.
    #[test]
    fn a_budget_cuts_the_envelope_head_first() {
        let (head, body) = (Bytes::from_static(b"HEADHEAD"), Bytes::from_static(b"body"));
        let cut = |budget| {
            let (h, b, whole) = within(head.clone(), body.clone(), budget);
            (h.len(), b.len(), whole)
        };
        assert_eq!(cut(usize::MAX), (8, 4, true));
        assert_eq!(cut(12), (8, 4, true));
        assert_eq!(cut(11), (8, 3, false));
        assert_eq!(cut(5), (5, 0, false));
    }
}
