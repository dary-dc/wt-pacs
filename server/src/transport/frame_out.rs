//! Wire seam: session-scoped outbound media (`FrameOut`).
//!
//! Opens shared or per-frame uni streams and writes length-prefixed envelopes. The
//! codestream is **streamed** behind its header a window at a time — never assembled into
//! a whole-frame buffer — so the only per-session allocation is one read window.
//! See `docs/disk-access/adr.md`.
//!
//! The per-frame app story lives in [`super::pipeline`]; see `docs/telemetry/adr-server-pipeline.md`.

use crate::media::frame_store::{FrameSpan, FrameStore};
use crate::media::read_path::ReadCtx;
use crate::transport::stream_mode::StreamMode;
use anyhow::{Context, Result};
use frame_envelope::ENVELOPE_LEN;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinSet;
use wtransport::stream::SendStream;
use wtransport::Connection;

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

    /// Envelope header, then the codestream read straight onto the wire.
    ///
    /// `ctx` is the session's read state — one reusable window, and the ring if this
    /// session has ever missed. The caller owns it so a session allocates one read window
    /// for its whole life, not one per frame.
    pub(crate) async fn send_frame(
        &mut self,
        idx: u32,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        ctx: &mut ReadCtx,
    ) -> Result<()> {
        let head = frame_head(idx, span.len);
        match self {
            Self::Shared { uni, .. } => {
                uni.write_all(&head).await.context("write shared head")?;
                stream_codestream(uni, store, span, ctx).await?;
            }
            Self::PerFrame { connection, acks } => {
                let mut uni = connection
                    .open_uni()
                    .await
                    .context("open uni")?
                    .await
                    .context("open uni ready")?;
                uni.write_all(&head).await.context("write head")?;
                stream_codestream(&mut uni, store, span, ctx).await?;

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

/// The 8 bytes ahead of a frame's codestream: length prefix, then frame index.
///
/// Byte-for-byte what `frame_envelope::wrap` produced before the codestream was streamed
/// instead of assembled — clients parse this, so it is pinned by a test.
fn frame_head(idx: u32, codestream_len: u32) -> [u8; 8] {
    let envelope_len = (ENVELOPE_LEN as u32).saturating_add(codestream_len);
    let mut head = [0u8; 8];
    head[..4].copy_from_slice(&envelope_len.to_be_bytes());
    head[4..].copy_from_slice(&idx.to_be_bytes());
    head
}

/// Copy the codestream to the wire, refilling the session's window as it drains.
///
/// `store.read_window` decides the stride, so a filesystem that refuses `RWF_NOWAIT` gets
/// whole-frame reads rather than a round trip per window.
async fn stream_codestream(
    uni: &mut SendStream,
    store: &Arc<FrameStore>,
    span: FrameSpan,
    ctx: &mut ReadCtx,
) -> Result<()> {
    let stride = store.read_window(span.len);
    let mut pos = 0u32;
    while pos < span.len {
        let remaining = (span.len - pos) as usize;
        let at = span.offset + u64::from(pos);
        let ready = ctx.fill(store, at, stride, remaining).await?;

        // Still `stride` bytes per `write_all`: bounding the executor's uninterrupted copy
        // is what the window is for, and a bigger *read* does not have to mean a bigger
        // copy.
        //
        // `write_all` copies into the connection's send buffer, so the window is free to
        // be refilled as soon as this returns — and the bytes quinn later puts on the wire
        // are process-private, not page-cache pages that reclaim could take back.
        let mut sent = 0usize;
        while sent < ready {
            let piece = stride.min(ready - sent);
            uni.write_all(&ctx.window()[sent..sent + piece])
                .await
                .context("write codestream")?;
            sent += piece;
        }
        pos += ready as u32;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::frame_store::READ_WINDOW;
    use frame_envelope::{unwrap, wrap};

    /// Streaming replaced `wrap()`, so the bytes on the wire have to be proven identical
    /// to what the envelope builder used to produce — clients parse this, not the code.
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
}
