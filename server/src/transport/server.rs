//! FoD ask → envelope on server uni stream (Media-complete).
//!
//! Serial loop: read one ask, send it to completion, read the next.
//! No server-side ask queue — see docs/adr-reject-server-ordering.md.
//!
//! Stream mode is resolved once per session in `handle_incoming` and carried as
//! `Option<SendStream>`: `Some` = one shared stream for the session, `None` = one
//! stream per frame. Nothing downstream branches on a flag.
//!
//! Frame bytes: streamed a window at a time straight from the page cache — see
//! `docs/disk-access/adr.md`. Nothing is faulted on the executor and nothing is copied
//! into a whole-frame envelope; the session's window buffer is the only per-session
//! allocation.
//!
//! Recording: `crate::record::Recorder` — zero-sized unless `feature = "telemetry"`.

use crate::media::frame_store::FrameStore;
#[cfg(test)]
use crate::media::frame_store::READ_WINDOW;
use crate::record::{LocateOutcome, Recorder, WriteOutcome};
use crate::transport::tls::load_pem_cert;
use crate::transport::wire::{read_fod_msg, write_fod_msg};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::ENVELOPE_LEN;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinSet;
use tracing::{info, warn};
use wtransport::stream::{RecvStream, SendStream};
use wtransport::{Connection, Endpoint, Identity, ServerConfig};

/// How frames reach the client. A process-wide configuration choice, resolved to an
/// `Option<SendStream>` once per session.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum StreamMode {
    /// One uni stream for the whole session. Frames arrive strictly in ask order.
    Shared,
    /// One uni stream per frame. Independent delivery; allows `set_priority` and `reset`.
    PerFrame,
}

impl StreamMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "shared",
            Self::PerFrame => "per-frame",
        }
    }
}

pub struct ServeConfig {
    pub wt_port: u16,
    pub study_path: PathBuf,
    pub cert_pem: PathBuf,
    pub key_pem: PathBuf,
    /// How frames reach the client for this process. See `StreamMode`.
    pub mode: StreamMode,
    /// Process-private frame cache budget in bytes; `0` disables it. See `FrameCache` —
    /// a hit skips the read path entirely, at the price of holding those bytes.
    pub frame_cache_bytes: usize,
}

pub async fn run_server(config: ServeConfig) -> Result<()> {
    let cert_pem = std::fs::read_to_string(&config.cert_pem)
        .with_context(|| format!("read {}", config.cert_pem.display()))?;
    let key_pem = std::fs::read_to_string(&config.key_pem)
        .with_context(|| format!("read {}", config.key_pem.display()))?;
    let cert = load_pem_cert(&cert_pem, &key_pem)?;

    let identity = Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
        .await
        .context("load wtransport identity")?;

    let server_config = ServerConfig::builder()
        .with_bind_default(config.wt_port)
        .with_identity(identity)
        .build();

    let endpoint = Endpoint::server(server_config).context("wtransport endpoint")?;

    let store = Arc::new(
        FrameStore::open_with_cache(&config.study_path, config.frame_cache_bytes)
            .context("open study")?,
    );

    let wt_url = format!("https://127.0.0.1:{}/", config.wt_port);
    let cert_sha256 = cert.sha256_hex().to_string();
    println!("wt_url={wt_url}");
    println!("cert_sha256={cert_sha256}");
    println!("study={}", config.study_path.display());
    println!("frames={}", store.frame_count());
    println!("completion=media_uni_stream");
    println!("stream_mode={}", config.mode.as_str());
    println!("frame_cache_bytes={}", config.frame_cache_bytes);
    #[cfg(feature = "telemetry")]
    println!("telemetry=compile-time");
    #[cfg(not(feature = "telemetry"))]
    println!("telemetry=absent");
    info!(
        %wt_url,
        study = %config.study_path.display(),
        stream_mode = config.mode.as_str(),
        "exact-server ready (Media-complete)"
    );

    let mode = config.mode;
    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store, mode).await {
                warn!(%err, "session ended");
            }
        });
    }
}

async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    store: Arc<FrameStore>,
    mode: StreamMode,
) -> Result<()> {
    let session_request = incoming.await.context("incoming session")?;
    let connection = session_request.accept().await.context("accept session")?;

    let (control_send, control_recv) = connection
        .accept_bi()
        .await
        .context("accept control bidi")?;

    // The mode, resolved once. Everything downstream sees a value, not a flag.
    let shared = match mode {
        StreamMode::Shared => Some(
            connection
                .open_uni()
                .await
                .context("open shared uni")?
                .await
                .context("shared uni ready")?,
        ),
        StreamMode::PerFrame => None,
    };

    run_session(connection, control_send, control_recv, store, shared).await
}

/// Read one FoD ask → send that frame to completion → repeat. EndSession stops the loop.
async fn run_session(
    connection: Connection,
    mut control_send: SendStream,
    mut control_recv: RecvStream,
    store: Arc<FrameStore>,
    mut shared: Option<SendStream>,
) -> Result<()> {
    let mut rec = Recorder::for_session();
    // One reusable read window for the whole session, not a buffer per frame and not a
    // whole-frame envelope. `FrameStore::read_window` sizes it.
    let mut window = Vec::new();

    info!(
        frames = store.frame_count(),
        shared = shared.is_some(),
        "session opened"
    );

    // Per-frame mode only: holds the acknowledgement waits moved off this loop.
    let mut acks = JoinSet::new();

    loop {
        let msg = match read_fod_msg(&mut control_recv).await {
            Ok(m) => m,
            Err(err) => {
                warn!(%err, "control read ended");
                break;
            }
        };

        match msg {
            FodMsg::RequestFrame { frame } => {
                send_one_frame(
                    &connection,
                    &mut shared,
                    &mut acks,
                    &mut control_send,
                    &store,
                    frame,
                    &mut window,
                    &mut rec,
                )
                .await?;
            }
            FodMsg::RequestFrames { frames } => {
                for frame in frames {
                    send_one_frame(
                        &connection,
                        &mut shared,
                        &mut acks,
                        &mut control_send,
                        &store,
                        frame,
                        &mut window,
                        &mut rec,
                    )
                    .await?;
                }
            }
            FodMsg::EndSession => break,
            other => {
                warn!(?other, "ask-only: ignoring unexpected FoD message");
            }
        }
    }

    // Let trailing frames finish acknowledging before the connection closes.
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        while acks.join_next().await.is_some() {}
    })
    .await;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn send_one_frame(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    acks: &mut JoinSet<()>,
    control_send: &mut SendStream,
    store: &Arc<FrameStore>,
    idx: u32,
    window: &mut Vec<u8>,
    rec: &mut Recorder,
) -> Result<()> {
    rec.ask(idx);

    let t0 = rec.stamp();
    // Index lookup only — no I/O, so a refusal costs nothing and happens before any
    // stream is opened.
    match store.frame_range(idx) {
        Ok((offset, len)) => {
            rec.located(t0, LocateOutcome::Ok, len as usize);

            let t1 = rec.stamp();
            match write_frame(connection, shared, acks, store, idx, offset, len, window).await {
                Ok(sent) => rec.wrote(t1, WriteOutcome::Sent, sent),
                Err(err) => {
                    rec.wrote(t1, WriteOutcome::WriteErr, 0);
                    return Err(err);
                }
            }
        }
        Err(err) => {
            rec.located(t0, LocateOutcome::NotFound, 0);
            warn!(frame = idx, %err, "frame refused");
            write_fod_msg(
                control_send,
                &FodMsg::FrameError {
                    frame_index: idx,
                    reason: err.to_string(),
                },
            )
            .await?;
            let t1 = rec.stamp();
            rec.wrote(t1, WriteOutcome::Refused, 0);
        }
    }
    Ok(())
}

/// `Some` = append to the session's shared stream. `None` = one stream per frame.
/// Both write `[4B BE len][4B BE index][codestream]`; the modes differ only in how long a
/// stream lives. Returns the payload byte count (`[index][codestream]`).
#[allow(clippy::too_many_arguments)]
async fn write_frame(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    acks: &mut JoinSet<()>,
    store: &Arc<FrameStore>,
    idx: u32,
    offset: u64,
    len: u32,
    window: &mut Vec<u8>,
) -> Result<usize> {
    let payload_len = ENVELOPE_LEN as u32 + len;
    let head = frame_head(idx, len);

    match shared {
        Some(uni) => {
            uni.write_all(&head).await.context("write shared head")?;
            stream_codestream(uni, store, idx, offset, len, window).await?;
        }
        None => {
            let mut uni = connection
                .open_uni()
                .await
                .context("open uni")?
                .await
                .context("open uni ready")?;
            uni.write_all(&head).await.context("write head")?;
            stream_codestream(&mut uni, store, idx, offset, len, window).await?;

            // `finish()` is MOVED off this loop, not deleted: wtransport's `finish()` awaits
            // the peer's acknowledgement (~272 ms measured), which caps throughput at
            // Tf/(Tf+RTT) when awaited inline. See docs/adr-frame-framing-and-loop-shape.md.
            acks.spawn(async move {
                let _ = uni.finish().await;
            });
        }
    }
    Ok(payload_len as usize)
}

/// `[4B BE payload len][4B BE frame index]` — the bytes that precede a codestream.
///
/// Length and index are both known before a single byte is read, so the header goes out
/// ahead of the frame and the codestream streams behind it — no whole-frame envelope is
/// ever built. Still never a combined `[len][payload]` buffer either: `write_all` copies
/// into the connection's send buffer regardless, so building one only adds a copy.
/// See docs/send-path-copy-costs.md — that fix has been reverted once, keep it.
fn frame_head(idx: u32, codestream_len: u32) -> [u8; 4 + ENVELOPE_LEN] {
    let payload_len = ENVELOPE_LEN as u32 + codestream_len;
    let mut head = [0u8; 4 + ENVELOPE_LEN];
    head[..4].copy_from_slice(&payload_len.to_be_bytes());
    head[4..].copy_from_slice(&idx.to_be_bytes());
    head
}

/// Copy the codestream to the wire one `READ_WINDOW` at a time.
///
/// Each window is taken from the page cache with `read_at_nowait`, which returns short
/// instead of waiting on disk — so no ask can park this executor thread on I/O the way a
/// major fault on an mmap'd slice does. Only the shortfall goes to the blocking pool, and
/// the read-ahead that miss triggers usually keeps the following windows on the fast path
/// (measured: 0 pool hops warm, 5–8 per 320-frame sequential cold pass, all 320 on a
/// reverse pass — i.e. it degrades to plain pooled `pread`, never worse).
/// See `docs/disk-access/adr.md`.
///
/// `store.read_window` decides the stride, so a filesystem that refuses `RWF_NOWAIT` gets
/// whole-frame pool reads rather than a round trip per window.
///
/// A frame the cache already holds skips all of it — the bytes are handed to quinn by
/// reference instead of copied into it (`write_chunk`, not `write_all`), which is sound
/// only because they are immutable and process-private. See `FrameCache`.
///
/// The ask that earns a frame its cache slot fills it from the windows it is already
/// streaming: one extra copy of the frame, no extra read, no pool hop, no background task.
async fn stream_codestream(
    uni: &mut SendStream,
    store: &Arc<FrameStore>,
    idx: u32,
    offset: u64,
    len: u32,
    window: &mut Vec<u8>,
) -> Result<()> {
    if let Some(bytes) = store.cached_frame(idx) {
        uni.quic_stream_mut()
            .write_chunk(bytes)
            .await
            .context("write cached codestream")?;
        return Ok(());
    }

    // Second ask for this frame, and the cache has room: assemble it as we stream.
    let mut filling = store
        .claim_fill(idx)
        .then(|| store.assembly_buffer(len as usize));

    // Whole frames where `RWF_NOWAIT` is refused (overlayfs, tmpfs), `READ_WINDOW` where
    // it works: one pool round trip per frame either way, never one per window.
    let stride = store.read_window(len);
    if window.len() < stride {
        window.resize(stride, 0);
    }
    let mut pos = 0u32;
    while pos < len {
        let want = stride.min((len - pos) as usize);
        let at = offset + u64::from(pos);
        let got = store.read_at_nowait(&mut window[..want], at)?;
        if got < want {
            let store = Arc::clone(store);
            let mut owned = std::mem::take(window);
            owned = tokio::task::spawn_blocking(move || {
                store.read_at_blocking(&mut owned[got..want], at + got as u64)?;
                Ok::<Vec<u8>, anyhow::Error>(owned)
            })
            .await
            .context("join frame read")??;
            *window = owned;
        }
        if let Some(buf) = filling.as_mut() {
            buf.extend_from_slice(&window[..want]);
        }
        // `write_all` copies into the connection's send buffer, so the window is free to
        // be refilled as soon as this returns — and the bytes quinn later puts on the wire
        // are process-private, not page-cache pages that reclaim could take back.
        uni.write_all(&window[..want])
            .await
            .context("write codestream")?;
        pos += want as u32;
    }
    match filling {
        Some(buf) if buf.len() == len as usize => store.admit(idx, buf.freeze()),
        Some(_) => store.abandon_fill(idx),
        None => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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

    /// The cache hit path writes one owned chunk where the streaming path writes windows.
    /// Clients parse bytes, not code paths, so the two have to be byte-identical.
    #[test]
    fn cached_frame_bytes_match_the_streamed_windows() {
        let codestream: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let idx = 3u32;

        let mut streamed = frame_head(idx, codestream.len() as u32).to_vec();
        for window in codestream.chunks(READ_WINDOW) {
            streamed.extend_from_slice(window);
        }

        // What the hit path writes: the same head, then the whole frame as one chunk.
        let mut cached = frame_head(idx, codestream.len() as u32).to_vec();
        cached.extend_from_slice(&bytes::Bytes::from(codestream.clone()));

        assert_eq!(cached, streamed, "cache hit changed the wire bytes");
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
