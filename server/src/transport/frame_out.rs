//! Wire seam: session-scoped outbound media (`FrameOut`).
//!
//! Opens shared or per-frame uni streams and writes length-prefixed envelopes. The
//! codestream is **streamed** behind its header a window at a time — never assembled into
//! a whole-frame buffer — so the only per-session allocation is one read window.
//! See `docs/disk-access/adr.md`.
//!
//! The per-frame app story lives in [`super::pipeline`]; see `docs/telemetry/adr-server-pipeline.md`.

use crate::media::frame_store::{FrameSpan, FrameStore};
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
    /// `window` is the session's single reusable buffer — the caller owns it so a session
    /// allocates one read window for its whole life, not one per frame.
    pub(crate) async fn send_frame(
        &mut self,
        idx: u32,
        store: &Arc<FrameStore>,
        span: FrameSpan,
        window: &mut Vec<u8>,
    ) -> Result<()> {
        let head = frame_head(idx, span.len);
        match self {
            Self::Shared { uni, .. } => {
                uni.write_all(&head).await.context("write shared head")?;
                stream_codestream(uni, store, span, window).await?;
            }
            Self::PerFrame { connection, acks } => {
                let mut uni = connection
                    .open_uni()
                    .await
                    .context("open uni")?
                    .await
                    .context("open uni ready")?;
                uni.write_all(&head).await.context("write head")?;
                stream_codestream(&mut uni, store, span, window).await?;

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

/// Fill the front of `buf` from the frame, and say how much is ready.
///
/// The window is taken from the page cache with `read_at_nowait`, which returns short
/// instead of waiting on disk — so no ask can park this executor thread on I/O the way a
/// major fault on an mmap'd slice does.
///
/// **A miss reads the rest of the frame, not the rest of the window.** The window bounds
/// how long the executor copies without yielding, and that argument applies only to the
/// inline `RWF_NOWAIT` read, which happens on a *hit*. The blocking read runs on the pool,
/// where a large read costs no more than a small one and a small one costs a whole extra
/// round trip.
///
/// Measured on a fixture large enough that a miss is a real device read
/// (`docs/disk-access/RERUN-miss.md`): windowing the pool read too costs 2–3 round trips
/// per frame instead of 1, which is **2.1x the throughput at one session and 3.0–3.2x at
/// 8, 16 and 32** once most asks miss — the windowed shape stops scaling at ~1 600 f/s
/// while this one reaches the device. Warm it is unchanged, and its worst co-tenant gap is
/// the lowest of any arm measured (148 µs, against 4.0 ms for reading a whole frame
/// inline). See `docs/disk-access/adr.md`.
///
/// Returns `stride.min(remaining)` on a hit and `remaining` on a miss, so **the caller
/// must advance by the return value, not by what it asked for.**
async fn fill_window(
    store: &Arc<FrameStore>,
    buf: &mut Vec<u8>,
    at: u64,
    stride: usize,
    remaining: usize,
) -> Result<usize> {
    let want = stride.min(remaining);
    let got = store.read_at_nowait(&mut buf[..want], at)?;
    if got == want {
        return Ok(want);
    }
    // Missed. Everything still outstanding in the frame goes to the pool together.
    let rest = remaining - got;
    if buf.len() < got + rest {
        buf.resize(got + rest, 0);
    }
    let store = Arc::clone(store);
    let mut owned = std::mem::take(buf);
    owned = tokio::task::spawn_blocking(move || {
        store.read_at_blocking(&mut owned[got..got + rest], at + got as u64)?;
        Ok::<Vec<u8>, anyhow::Error>(owned)
    })
    .await
    .context("join frame read")??;
    *buf = owned;
    Ok(got + rest)
}

/// Copy the codestream to the wire, refilling `window` as it drains.
///
/// `store.read_window` decides the stride, so a filesystem that refuses `RWF_NOWAIT` gets
/// whole-frame pool reads rather than a round trip per window.
async fn stream_codestream(
    uni: &mut SendStream,
    store: &Arc<FrameStore>,
    span: FrameSpan,
    window: &mut Vec<u8>,
) -> Result<()> {
    // Whole frames where `RWF_NOWAIT` is refused (overlayfs, tmpfs), `READ_WINDOW` where
    // it works.
    let stride = store.read_window(span.len);
    if window.len() < stride {
        window.resize(stride, 0);
    }
    let mut pos = 0u32;
    while pos < span.len {
        let remaining = (span.len - pos) as usize;
        let at = span.offset + u64::from(pos);
        let ready = fill_window(store, window, at, stride, remaining).await?;

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
            uni.write_all(&window[sent..sent + piece])
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
    use std::io::Write;

    /// A study bundle on disk with `frames` frames of `len` bytes, each filled with a
    /// per-frame pattern so a mis-assembled frame cannot pass by accident.
    fn write_bundle(dir: &std::path::Path, frames: u32, len: u32) -> std::path::PathBuf {
        let meta = format!("{{\"frameCount\":{frames}}}");
        let data_base = 16 + 12 * frames as usize + meta.len();
        let path = dir.join("test.sbnd");
        let mut f = std::fs::File::create(&path).expect("create bundle");
        f.write_all(b"SBND").unwrap();
        f.write_all(&1u32.to_le_bytes()).unwrap();
        f.write_all(&(meta.len() as u32).to_le_bytes()).unwrap();
        f.write_all(&frames.to_le_bytes()).unwrap();
        for i in 0..frames {
            f.write_all(&((data_base as u64) + u64::from(i) * u64::from(len)).to_le_bytes())
                .unwrap();
            f.write_all(&len.to_le_bytes()).unwrap();
        }
        f.write_all(meta.as_bytes()).unwrap();
        for i in 0..frames {
            f.write_all(&frame_pattern(i, len)).unwrap();
        }
        f.sync_all().unwrap();
        path
    }

    fn frame_pattern(idx: u32, len: u32) -> Vec<u8> {
        (0..len)
            .map(|b| (b.wrapping_mul(31).wrapping_add(idx.wrapping_mul(7)) % 251) as u8)
            .collect()
    }

    /// `fill_window` must reassemble every frame byte-for-byte whatever the read path
    /// did — and since a miss reads the rest of the *frame*, it can return more than a
    /// window, so a caller that advances by what it asked for loses bytes.
    ///
    /// The loop below is `stream_codestream`'s, with `extend_from_slice` where the wire
    /// would be; that duplication is deliberate, and it is why this needs no sink
    /// abstraction and no QUIC connection. Frame lengths straddle the window boundary on
    /// purpose.
    /// Run `stream_codestream`'s loop against a sink of bytes, returning what came out and
    /// **how many fills it took**. The loop is copied rather than shared: that duplication
    /// is what lets this test the read path with no sink abstraction and no QUIC
    /// connection.
    fn drain(store: &Arc<FrameStore>, span: FrameSpan, stride: usize) -> (Vec<u8>, usize) {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("rt");
        let mut window = vec![0u8; stride];
        let mut out: Vec<u8> = Vec::new();
        let mut pos = 0u32;
        let mut fills = 0usize;
        while pos < span.len {
            let remaining = (span.len - pos) as usize;
            let at = span.offset + u64::from(pos);
            let ready = rt
                .block_on(fill_window(store, &mut window, at, stride, remaining))
                .expect("fill");
            assert!(ready > 0, "a fill that returns 0 would spin forever");
            fills += 1;
            out.extend_from_slice(&window[..ready]);
            pos += ready as u32;
        }
        (out, fills)
    }

    /// **The ADR's claim, as an assertion.** A window that misses reads to the end of the
    /// *frame*, not the end of the window — so a frame that misses costs one pool round
    /// trip however many windows long it is. Windowing the pool read too costs 2–3 per
    /// 250 KB frame, and that is where the miss-path throughput went: 1 404–1 573 f/s
    /// against 4 539–4 777 (`docs/disk-access/RERUN-miss.md`).
    ///
    /// Misses are forced through `force_pool_reads` rather than by evicting the page
    /// cache. Eviction is not a lever a test can rely on — `fadvise(DONTNEED)` will not
    /// evict a mapped page, and on this host it does not evict even before the mapping
    /// exists, which silently left an earlier version of this test on the warm path where
    /// it passed against a deliberately broken implementation.
    #[test]
    fn a_frame_that_misses_costs_one_pool_round_trip_not_one_per_window() {
        let dir = std::env::temp_dir().join(format!("wtpacs-trips-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        // Explicit stride: `read_window` collapses to the whole frame when `RWF_NOWAIT` is
        // refused, and a one-window frame cannot tell the two shapes apart.
        let stride = 4096usize;
        let len = (stride * 5 + 17) as u32;
        let windows = (len as usize).div_ceil(stride);
        let path = write_bundle(&dir, 3, len);

        // Both miss shapes: nothing in the cache, and the front of the window in it. The
        // second is what a real short read looks like, and the one whose offset arithmetic
        // has somewhere to go wrong.
        for shape in ["total miss", "partial hit"] {
            let mut store = FrameStore::open(&path).expect("open store");
            match shape {
                "total miss" => store.force_pool_reads(),
                _ => store.force_short_reads(stride / 3),
            }
            let store = Arc::new(store);
            for idx in 0..3u32 {
                let span = store.frame_span(idx).expect("span");
                let (out, fills) = drain(&store, span, stride);
                assert_eq!(
                    out,
                    frame_pattern(idx, len),
                    "frame {idx} came back wrong on a {shape}"
                );
                assert_eq!(
                    fills, 1,
                    "frame {idx} is {windows} windows long and took {fills} round trips on \
                     a {shape}, not 1"
                );
            }
        }
        std::fs::remove_file(&path).ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Assembly across the window boundary, on both branches of `fill_window`, at the
    /// lengths most likely to be off by one.
    #[test]
    fn refilling_reassembles_every_frame_whatever_the_read_path() {
        let dir = std::env::temp_dir().join(format!("wtpacs-fill-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let stride = 4096usize;
        for &len in &[
            1u32,
            (stride - 1) as u32,
            stride as u32,
            (stride + 1) as u32,
            (stride * 3 + 17) as u32,
            READ_WINDOW as u32,
            (READ_WINDOW + 1) as u32,
        ] {
            let path = write_bundle(&dir, 3, len);
            for shape in ["hit", "total miss", "partial hit"] {
                let mut store = FrameStore::open(&path).expect("open store");
                match shape {
                    "hit" => {}
                    "total miss" => store.force_pool_reads(),
                    _ => store.force_short_reads(stride / 3),
                }
                let store = Arc::new(store);
                for idx in 0..3u32 {
                    let span = store.frame_span(idx).expect("span");
                    let (out, _) = drain(&store, span, stride);
                    assert_eq!(
                        out,
                        frame_pattern(idx, len),
                        "frame {idx} of length {len} came back wrong on a {shape}"
                    );
                }
            }
            std::fs::remove_file(&path).ok();
        }
        std::fs::remove_dir_all(&dir).ok();
    }

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
