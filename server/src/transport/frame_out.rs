//! Wire seam: session-scoped outbound media. Opens shared or per-frame uni streams and
//! writes length-prefixed envelopes, streaming the codestream behind its header a window at
//! a time rather than assembling a whole-frame buffer. `docs/disk-access/adr.md`.

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

    /// Envelope header, then the codestream read straight onto the wire. `ctx` is owned by
    /// the caller, so a session allocates one read window for its life, not one per frame.
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

/// The 8 bytes ahead of a frame's codestream: length prefix, then frame index. Clients parse
/// this, so a test pins it byte-for-byte to what `frame_envelope::wrap` produced.
fn frame_head(idx: u32, codestream_len: u32) -> [u8; 8] {
    let envelope_len = (ENVELOPE_LEN as u32).saturating_add(codestream_len);
    let mut head = [0u8; 8];
    head[..4].copy_from_slice(&envelope_len.to_be_bytes());
    head[4..].copy_from_slice(&idx.to_be_bytes());
    head
}

/// Read the codestream onto the wire, a window at a time.
async fn stream_codestream(
    uni: &mut SendStream,
    store: &Arc<FrameStore>,
    span: FrameSpan,
    ctx: &mut ReadCtx,
) -> Result<()> {
    let stride = store.read_window(span.len);
    let mut pos = 0u32;
    while pos < span.len {
        let at = span.offset + u64::from(pos);
        let ready = ctx
            .read(store, at, stride, (span.len - pos) as usize)
            .await?;
        pos += ready.len() as u32;

        // A miss returns more than one window; the writes stay window-sized, because the
        // window bounds how long the executor copies without yielding.
        for piece in ready.chunks(stride) {
            uni.write_all(piece).await.context("write codestream")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::frame_store::READ_WINDOW;
    use frame_envelope::{unwrap, wrap};

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
}
