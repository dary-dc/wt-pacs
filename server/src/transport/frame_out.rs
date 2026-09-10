//! Session-scoped outbound media: length-prefixed envelopes on shared or per-frame uni
//! streams, the codestream streamed a window at a time. `docs/disk-access/adr.md`.

use crate::media::frame_store::READ_WINDOW;
use crate::transport::stream_mode::StreamMode;
use anyhow::{Context, Result};
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

    /// `body` is the whole codestream: the reader returns a frame in one call, and the
    /// write is chunked so a wide frame does not copy without yielding.
    pub(crate) async fn send_frame(&mut self, idx: u32, body: &[u8]) -> Result<()> {
        let head = frame_head(idx, body.len() as u32);
        match self {
            Self::Shared { uni, .. } => write_frame(uni, &head, body).await,
            Self::PerFrame { connection, acks } => {
                let mut uni = connection
                    .open_uni()
                    .await
                    .context("open uni")?
                    .await
                    .context("open uni ready")?;
                write_frame(&mut uni, &head, body).await?;

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

/// One write: head + first window. `docs/transport/why-these-changes.md`
fn headed_window<'a>(head: &'a [u8; 8], body: &'a [u8]) -> (Vec<u8>, &'a [u8]) {
    let n = body.len().min(READ_WINDOW);
    let mut first = Vec::with_capacity(8 + n);
    first.extend_from_slice(head);
    first.extend_from_slice(&body[..n]);
    (first, &body[n..])
}

async fn write_frame(uni: &mut SendStream, head: &[u8; 8], body: &[u8]) -> Result<()> {
    let (first, rest) = headed_window(head, body);
    uni.write_all(&first).await.context("write frame")?;
    for piece in write_chunks(rest) {
        uni.write_all(piece).await.context("write codestream")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::frame_store::FrameStore;
    use crate::media::read_path::SeqReader;
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

        // What the streaming path writes: headed first window, then the rest.
        let head = frame_head(idx, codestream.len() as u32);
        let (first, rest) = headed_window(&head, &codestream);
        let mut new_wire = first;
        new_wire.extend_from_slice(rest);

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
        let mut seq = SeqReader::new();
        let ready = rt
            .block_on(seq.read(&store, span, None))
            .expect("read")
            .to_vec();
        assert_eq!(
            ready.len(),
            span.len as usize,
            "precondition: a pooled miss returns the whole frame in one call"
        );
        let mut pieces = 0usize;
        for piece in write_chunks(&ready) {
            assert!(
                piece.len() <= READ_WINDOW,
                "write piece {} exceeds READ_WINDOW",
                piece.len()
            );
            pieces += 1;
        }
        assert!(
            pieces > 1,
            "a 250 KB pooled frame must be more than one write"
        );
        let pos = ready.len() as u32;
        assert_eq!(pos, span.len);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **The first write carries payload.** An 8-byte head write lets the multi-thread
    /// QUIC driver emit a useless first packet; the headed window is head + up to
    /// `READ_WINDOW` of body, remainder intact. `docs/transport/why-these-changes.md`
    #[test]
    fn the_first_write_is_the_head_and_the_first_window() {
        let body: Vec<u8> = (0..(READ_WINDOW as u32 * 2 + 17))
            .map(|i| (i % 251) as u8)
            .collect();
        let head = frame_head(4, body.len() as u32);
        let (first, rest) = headed_window(&head, &body);
        assert_eq!(&first[..8], &head, "first write dropped the envelope head");
        assert_eq!(
            first.len(),
            8 + READ_WINDOW,
            "first write was not head + one window"
        );
        assert_eq!(
            &first[8..],
            &body[..READ_WINDOW],
            "first window bytes moved"
        );
        assert_eq!(rest, &body[READ_WINDOW..], "the remainder is not the tail");
        assert!(first.len() > 8, "first write was the 8-byte head alone");

        let short = [7u8; 13];
        let head = frame_head(0, short.len() as u32);
        let (first, rest) = headed_window(&head, &short);
        assert_eq!(first.len(), 8 + short.len());
        assert!(rest.is_empty(), "a short frame left a remainder");
        let mut wire = first;
        wire.extend_from_slice(rest);
        assert_eq!(&wire[..8], &head);
        assert_eq!(&wire[8..], &short);
    }
}
