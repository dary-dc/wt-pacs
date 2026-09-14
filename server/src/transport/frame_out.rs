//! Session-scoped outbound media: length-prefixed envelopes on shared or per-frame uni
//! streams, the codestream handed to quinn whole and uncopied. `docs/disk-access/adr.md`.

use crate::transport::stream_mode::StreamMode;
use anyhow::{Context, Result};
use bytes::Bytes;
use frame_envelope::ENVELOPE_LEN;
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
        /// Frames sent so far; each stream's priority descends with it. `docs/transport/NEXT.md` §3.
        seq: u32,
    },
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
        let head = Bytes::copy_from_slice(&frame_head(idx, body.len() as u32));
        match self {
            Self::Shared { uni, .. } => write_frame(uni, head, body).await,
            Self::PerFrame {
                connection,
                acks,
                seq,
            } => {
                let mut uni = connection
                    .open_uni()
                    .await
                    .context("open uni")?
                    .await
                    .context("open uni ready")?;
                uni.set_priority(ask_priority(*seq));
                *seq = seq.saturating_add(1);
                write_frame(&mut uni, head, body).await?;
                acks.spawn(async move {
                    let _ = uni.finish().await;
                });
                while acks.try_join_next().is_some() {}
                Ok(())
            }
            #[cfg(test)]
            Self::Detached => unreachable!("a detached sink has no wire to write to"),
        }
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
/// frames' data instead of behind every stream already queued. `docs/transport/NEXT.md` §3.
fn ask_priority(seq: u32) -> i32 {
    i32::try_from(seq).map_or(i32::MIN, |s| -s)
}

/// Length prefix, then frame index. Clients parse it, so a test pins it byte-for-byte.
fn frame_head(idx: u32, codestream_len: u32) -> [u8; 8] {
    let envelope_len = (ENVELOPE_LEN as u32).saturating_add(codestream_len);
    let mut head = [0u8; 8];
    head[..4].copy_from_slice(&envelope_len.to_be_bytes());
    head[4..].copy_from_slice(&idx.to_be_bytes());
    head
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
    use frame_envelope::{unwrap, wrap};

    /// Streaming replaced `wrap()`, and clients parse the bytes, not the code.
    #[test]
    fn streamed_bytes_match_the_envelope_they_replaced() {
        let codestream: Vec<u8> = (0..5000u32).map(|i| (i % 251) as u8).collect();
        let idx = 7u32;

        let old = wrap(idx, &codestream);
        let mut old_wire = (old.len() as u32).to_be_bytes().to_vec();
        old_wire.extend_from_slice(&old);

        // What the wire carries: the head chunk, then the codestream chunk.
        let mut new_wire = frame_head(idx, codestream.len() as u32).to_vec();
        new_wire.extend_from_slice(&codestream);

        assert_eq!(new_wire, old_wire, "wire bytes changed");
        let (parsed_idx, body) = unwrap(&new_wire[4..]).expect("client can still parse");
        assert_eq!(parsed_idx, idx);
        assert_eq!(body, &codestream[..]);
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

    /// A frame larger than one window still frames as a single payload.
    #[test]
    fn head_counts_the_whole_codestream_not_one_window() {
        let len = (crate::media::frame_store::READ_WINDOW * 3 + 17) as u32;
        let head = frame_head(1, len);
        assert_eq!(
            u32::from_be_bytes(head[..4].try_into().unwrap()),
            ENVELOPE_LEN as u32 + len
        );
        assert_eq!(u32::from_be_bytes(head[4..].try_into().unwrap()), 1);
    }
}
