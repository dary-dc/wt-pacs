//! Session-scoped outbound media: length-prefixed envelopes on shared or per-frame uni
//! streams, the codestream streamed a window at a time. `docs/disk-access/adr.md`.

use crate::media::frame_store::{FrameSpan, FrameStore, READ_WINDOW};
use crate::media::read_path::ReadCtx;
use crate::transport::stream_mode::StreamMode;
use anyhow::{Context, Result};
use frame_envelope::ENVELOPE_LEN;
use std::sync::Arc;
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
            }),
        }
    }

    /// `ctx` is the caller's, so a session allocates its windows once; `ahead`, where the
    /// caller knows it, lets those frames' reads start early.
    pub(crate) async fn send_frame(
        &mut self,
        idx: u32,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        ahead: &[FrameSpan],
        ctx: &mut ReadCtx,
    ) -> Result<()> {
        let head = frame_head(idx, span.len);
        match self {
            Self::Shared { uni, .. } => {
                uni.write_all(&head).await.context("write shared head")?;
                stream_codestream(uni, store, span, ahead, ctx).await?;
            }
            Self::PerFrame { connection, acks } => {
                let mut uni = connection
                    .open_uni()
                    .await
                    .context("open uni")?
                    .await
                    .context("open uni ready")?;
                uni.write_all(&head).await.context("write head")?;
                stream_codestream(&mut uni, store, span, ahead, ctx).await?;

                acks.spawn(async move {
                    let _ = uni.finish().await;
                });
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

/// Length prefix, then frame index. Clients parse it, so a test pins it byte-for-byte.
fn frame_head(idx: u32, codestream_len: u32) -> [u8; 8] {
    let envelope_len = (ENVELOPE_LEN as u32).saturating_add(codestream_len);
    let mut head = [0u8; 8];
    head[..4].copy_from_slice(&envelope_len.to_be_bytes());
    head[4..].copy_from_slice(&idx.to_be_bytes());
    head
}

fn write_chunks(ready: &[u8]) -> impl Iterator<Item = &[u8]> {
    ready.chunks(READ_WINDOW)
}

async fn stream_codestream(
    uni: &mut SendStream,
    store: &Arc<FrameStore>,
    span: FrameSpan,
    ahead: &[FrameSpan],
    ctx: &mut ReadCtx,
) -> Result<()> {
    let mut pos = 0u32;
    while pos < span.len {
        let ready = ctx.read(store, span, pos, ahead.iter().copied()).await?;
        pos += ready.len() as u32;
        // A miss returns the rest of the frame; the write chunk is not that size.
        for piece in write_chunks(ready) {
            uni.write_all(piece).await.context("write codestream")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::frame_store::FrameStore;
    use crate::media::read_path::{ReadCtx, ReadMode};
    use frame_envelope::{unwrap, wrap};
    use std::sync::Arc;

    /// Streaming replaced `wrap()`, and clients parse the bytes, not the code.
    #[test]
    fn streamed_bytes_match_the_envelope_they_replaced() {
        let codestream: Vec<u8> = (0..5000u32).map(|i| (i % 251) as u8).collect();
        let idx = 7u32;

        let old = wrap(idx, &codestream);
        let mut old_wire = (old.len() as u32).to_be_bytes().to_vec();
        old_wire.extend_from_slice(&old);

        // What the streaming path writes: the head, then the codestream in windows.
        let mut new_wire = frame_head(idx, codestream.len() as u32).to_vec();
        for window in codestream.chunks(READ_WINDOW) {
            new_wire.extend_from_slice(window);
        }

        assert_eq!(new_wire, old_wire, "wire bytes changed");
        let (parsed_idx, body) = unwrap(&new_wire[4..]).expect("client can still parse");
        assert_eq!(parsed_idx, idx);
        assert_eq!(body, &codestream[..]);
    }

    /// A frame larger than one window still frames as a single payload.
    #[test]
    fn head_counts_the_whole_codestream_not_one_window() {
        let len = (READ_WINDOW * 3 + 17) as u32;
        let head = frame_head(1, len);
        assert_eq!(
            u32::from_be_bytes(head[..4].try_into().unwrap()),
            ENVELOPE_LEN as u32 + len
        );
        assert_eq!(u32::from_be_bytes(head[4..].try_into().unwrap()), 1);
    }

    /// A pooled miss returns the whole frame; writes must still be window-sized, or the
    /// executor copies 250 KB without yielding.
    #[test]
    fn a_pooled_frame_is_written_in_read_windows_not_in_one_copy() {
        let dir = std::env::temp_dir().join(format!("wtpacs-write-chunk-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let path = dir.join("frame.sbnd");
        let len = 250_000u32;
        let body: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
        study_bundle::write_bundle(&path, br#"{"frameCount":1}"#, &[body.as_slice()])
            .expect("write study");

        let mut store = FrameStore::open(&path).expect("open");
        store.force_pool_reads();
        let store = Arc::new(store);
        let span = store.frame_span(0).expect("span");

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt");
        let mut ctx = ReadCtx::new(ReadMode::Pool, &store);
        let mut pos = 0u32;
        let mut pieces = 0usize;
        while pos < span.len {
            let ready = rt
                .block_on(ctx.read(&store, span, pos, None))
                .expect("read");
            assert!(!ready.is_empty());
            pos += ready.len() as u32;
            assert!(
                ready.len() > READ_WINDOW,
                "precondition: a pooled miss returns more than one write chunk"
            );
            for piece in write_chunks(ready) {
                assert!(
                    piece.len() <= READ_WINDOW,
                    "write piece {} exceeds READ_WINDOW",
                    piece.len()
                );
                pieces += 1;
            }
        }
        assert!(
            pieces > 1,
            "a 250 KB pooled frame must be more than one write"
        );
        assert_eq!(pos, span.len);
        std::fs::remove_dir_all(&dir).ok();
    }
}
