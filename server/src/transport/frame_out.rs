//! Wire seam: session-scoped outbound media (`FrameOut`).
//!
//! Opens shared or per-frame uni streams and writes length-prefixed envelopes.
//! Send paths share the assemblers in [`super::assemble`]; the per-frame app story
//! lives in [`super::pipeline`].

use crate::transport::assemble::chunked_chunks;
use crate::transport::stream_mode::StreamMode;
use crate::transport::tuning::SendPath;
use anyhow::{Context, Result};
use bytes::Bytes;
use std::time::Duration;
use tokio::task::JoinSet;
use wtransport::stream::SendStream;
use wtransport::Connection;

#[cfg(feature = "lab")]
use crate::transport::assemble::{assemble_copy, split_parts};
#[cfg(feature = "lab")]
use std::time::Instant;

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
        body: Bytes,
        send_path: SendPath,
        ask_priority: bool,
        ask_seq: &mut i32,
    ) -> Result<()> {
        match send_path {
            #[cfg(feature = "lab")]
            SendPath::Copy => self.write_copy(idx, &body, ask_priority, ask_seq).await,
            #[cfg(feature = "lab")]
            SendPath::Split => self.write_split(idx, &body, ask_priority, ask_seq).await,
            SendPath::Chunked => self.write_chunked(idx, body, ask_priority, ask_seq).await,
        }
    }

    #[cfg(feature = "lab")]
    async fn write_copy(
        &mut self,
        idx: u32,
        body: &[u8],
        ask_priority: bool,
        ask_seq: &mut i32,
    ) -> Result<()> {
        // Two writes, not one buffer: making `[len][payload]` contiguous copies the frame a
        // third time. Reverted once already — keep it.
        let wire = assemble_copy(idx, body);
        let (len, payload) = wire.split_at(4);
        let timing = serve_timing(idx);
        match self {
            Self::Shared { uni, .. } => {
                let t_first = Instant::now();
                uni.write_all(len).await.context("write shared len")?;
                uni.write_all(payload).await.context("write shared frame")?;
                note_serve_timing(timing, "shared", t_first);
            }
            Self::PerFrame { connection, acks } => {
                let mut uni = open_frame_uni(connection, ask_priority, ask_seq).await?;
                let t_first = Instant::now();
                uni.write_all(len).await.context("write len")?;
                uni.write_all(payload).await.context("write envelope")?;
                note_serve_timing(timing, "per-frame", t_first);
                spawn_ack(acks, uni);
            }
        }
        Ok(())
    }

    #[cfg(feature = "lab")]
    async fn write_split(
        &mut self,
        idx: u32,
        body: &[u8],
        ask_priority: bool,
        ask_seq: &mut i32,
    ) -> Result<()> {
        let (len, index, body) = split_parts(idx, body);
        let timing = serve_timing(idx);
        match self {
            Self::Shared { uni, .. } => {
                let t_first = Instant::now();
                uni.write_all(&len).await.context("write shared len")?;
                uni.write_all(&index).await.context("write shared index")?;
                uni.write_all(body)
                    .await
                    .context("write shared codestream")?;
                note_serve_timing(timing, "shared", t_first);
            }
            Self::PerFrame { connection, acks } => {
                let mut uni = open_frame_uni(connection, ask_priority, ask_seq).await?;
                let t_first = Instant::now();
                uni.write_all(&len).await.context("write len")?;
                uni.write_all(&index).await.context("write index")?;
                uni.write_all(body).await.context("write codestream")?;
                note_serve_timing(timing, "per-frame", t_first);
                spawn_ack(acks, uni);
            }
        }
        Ok(())
    }

    async fn write_chunked(
        &mut self,
        idx: u32,
        body: Bytes,
        ask_priority: bool,
        ask_seq: &mut i32,
    ) -> Result<()> {
        let mut chunks = chunked_chunks(idx, body);
        match self {
            Self::Shared { uni, .. } => {
                #[cfg(feature = "lab")]
                let timing = serve_timing(idx);
                #[cfg(feature = "lab")]
                let t_first = Instant::now();
                uni.quic_stream_mut()
                    .write_all_chunks(&mut chunks)
                    .await
                    .context("write shared frame chunks")?;
                #[cfg(feature = "lab")]
                note_serve_timing(timing, "shared", t_first);
            }
            Self::PerFrame { connection, acks } => {
                let mut uni = open_frame_uni(connection, ask_priority, ask_seq).await?;
                #[cfg(feature = "lab")]
                let timing = serve_timing(idx);
                #[cfg(feature = "lab")]
                let t_first = Instant::now();
                uni.quic_stream_mut()
                    .write_all_chunks(&mut chunks)
                    .await
                    .context("write frame chunks")?;
                #[cfg(feature = "lab")]
                note_serve_timing(timing, "per-frame", t_first);
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

/// Open a per-frame uni. Shared by every send path so a priority applied on only one
/// of them would not silently make the arms incomparable.
async fn open_frame_uni(
    connection: &Connection,
    ask_priority: bool,
    ask_seq: &mut i32,
) -> Result<SendStream> {
    let uni = connection
        .open_uni()
        .await
        .context("open uni")?
        .await
        .context("open uni ready")?;
    // Higher priority transmits first (wtransport/quinn). Earliest ask wins.
    if ask_priority {
        uni.set_priority(i32::MAX.saturating_sub(*ask_seq));
        *ask_seq = ask_seq.saturating_add(1);
    }
    Ok(uni)
}

/// Move `finish()` off the serve loop, then reap cells that have already completed (§7).
fn spawn_ack(acks: &mut JoinSet<()>, mut uni: SendStream) {
    acks.spawn(async move {
        let _ = uni.finish().await;
    });
    while acks.try_join_next().is_some() {}
}

/// `serve_timing` line for offline join with the client's ask ordinals.
/// `WT_SERVE_TIMING`, read once. Reading it per frame takes the process environment lock.
#[cfg(feature = "lab")]
fn serve_timing_enabled() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("WT_SERVE_TIMING").is_some())
}

#[cfg(feature = "lab")]
fn serve_timing(idx: u32) -> Option<(u32, Instant)> {
    serve_timing_enabled().then(|| (idx, Instant::now()))
}

#[cfg(feature = "lab")]
fn note_serve_timing(timing: Option<(u32, Instant)>, mode: &str, t_first: Instant) {
    if let Some((idx, t_ask)) = timing {
        let ask_to_first_ms = t_first.duration_since(t_ask).as_secs_f64() * 1000.0;
        let ask_to_last_ms = t_ask.elapsed().as_secs_f64() * 1000.0;
        eprintln!(
            "serve_timing frame={idx} mode={mode} ask_to_first_ms={ask_to_first_ms:.3} ask_to_last_ms={ask_to_last_ms:.3}"
        );
    }
}
