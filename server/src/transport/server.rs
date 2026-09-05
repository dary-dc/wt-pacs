//! FoD ask → envelope on server uni stream (Media-complete).
//!
//! Serial loop: read one ask, send it to completion, read the next.
//! No server-side ask queue — see docs/adr-reject-server-ordering.md.
//!
//! Stream mode is resolved once per session in `handle_incoming` and carried as
//! `Option<SendStream>`: `Some` = one shared stream for the session, `None` = one
//! stream per frame. Nothing downstream branches on a flag.
//!
//! Recording: `crate::record::Recorder` — zero-sized unless `feature = "telemetry"`.

use crate::media::frame_store::FrameStore;
use crate::record::{LocateOutcome, Recorder, WriteOutcome};
use crate::transport::tls::load_pem_cert;
use crate::transport::tuning::{SendPath, TransportTuning};
use crate::transport::wire::{read_fod_msg, write_fod_msg};
use anyhow::{Context, Result};
use bytes::Bytes;
use fod::FodMsg;
use frame_envelope::{wrap, ENVELOPE_LEN};
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
    /// Bind IP. `None` = dual-stack ANY (the default). Set it where the host has no
    /// IPv6 stack, which is where the dual-stack bind fails with EAFNOSUPPORT.
    pub bind_ip: Option<std::net::IpAddr>,
    /// QUIC transport knobs. `Default` reproduces quinn's own configuration.
    pub tuning: TransportTuning,
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

    let transport = config
        .tuning
        .to_transport_config()
        .context("build QUIC transport config")?;

    let builder = ServerConfig::builder();
    let builder = match bind_socket(&config)? {
        Some(socket) => builder.with_bind_socket(socket),
        None => match config.bind_ip {
            Some(ip) => builder.with_bind_address(std::net::SocketAddr::new(ip, config.wt_port)),
            None => builder.with_bind_default(config.wt_port),
        },
    };
    let server_config = builder
        .with_custom_transport(identity, transport)
        .build();

    let endpoint = Endpoint::server(server_config).context("wtransport endpoint")?;

    let store = Arc::new(FrameStore::open(&config.study_path).context("open study")?);

    let wt_url = format!("https://127.0.0.1:{}/", config.wt_port);
    let cert_sha256 = cert.sha256_hex().to_string();
    println!("wt_url={wt_url}");
    println!("cert_sha256={cert_sha256}");
    println!("study={}", config.study_path.display());
    println!("frames={}", store.frame_count());
    println!("completion=media_uni_stream");
    println!("stream_mode={}", config.mode.as_str());
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
    let send_path = config.tuning.send_path;
    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store, mode, send_path).await {
                warn!(%err, "session ended");
            }
        });
    }
}

/// A UDP socket with explicit SO_SNDBUF / SO_RCVBUF, or `None` to let wtransport bind.
///
/// Only built when a buffer size is actually requested — the default path must stay
/// exactly what it was, so an arm that changes nothing measures nothing.
fn bind_socket(config: &ServeConfig) -> Result<Option<std::net::UdpSocket>> {
    if config.tuning.socket_buffers_are_default() {
        return Ok(None);
    }
    use socket2::{Domain, Protocol, Socket, Type};
    let ip = config
        .bind_ip
        .unwrap_or(std::net::IpAddr::V6(std::net::Ipv6Addr::UNSPECIFIED));
    let addr = std::net::SocketAddr::new(ip, config.wt_port);
    let domain = if addr.is_ipv4() { Domain::IPV4 } else { Domain::IPV6 };
    let socket = Socket::new(domain, Type::DGRAM, Some(Protocol::UDP)).context("udp socket")?;
    if let Some(n) = config.tuning.socket_send_buffer {
        socket.set_send_buffer_size(n).context("SO_SNDBUF")?;
    }
    if let Some(n) = config.tuning.socket_recv_buffer {
        socket.set_recv_buffer_size(n).context("SO_RCVBUF")?;
    }
    socket.bind(&addr.into()).with_context(|| format!("bind {addr}"))?;
    info!(
        send_buffer = socket.send_buffer_size().unwrap_or(0),
        recv_buffer = socket.recv_buffer_size().unwrap_or(0),
        "bound UDP socket with explicit buffer sizes"
    );
    Ok(Some(socket.into()))
}

async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    store: Arc<FrameStore>,
    mode: StreamMode,
    send_path: SendPath,
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

    run_session(connection, control_send, control_recv, store, shared, send_path).await
}

/// Read one FoD ask → send that frame to completion → repeat. EndSession stops the loop.
async fn run_session(
    connection: Connection,
    mut control_send: SendStream,
    mut control_recv: RecvStream,
    store: Arc<FrameStore>,
    mut shared: Option<SendStream>,
    send_path: SendPath,
) -> Result<()> {
    let mut rec = Recorder::for_session();

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
                    &mut rec,
                    send_path,
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
                        &mut rec,
                        send_path,
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
    rec: &mut Recorder,
    send_path: SendPath,
) -> Result<()> {
    rec.ask(idx);

    let t0 = rec.stamp();
    // Prefault off the executor — a major fault is not an `.await`.
    // TODO(readability): hide Arc (inner FrameStore handle or block_in_place); perf unchanged.
    let store_touch = Arc::clone(store);
    let touch = tokio::task::spawn_blocking(move || store_touch.touch_frame_pages(idx))
        .await
        .context("join frame page touch")?;

    let located = touch.and_then(|_| match send_path {
        SendPath::Copy => store.frame_slice(idx).map(Payload::Borrowed),
        SendPath::Chunked => store.frame_bytes(idx).map(Payload::Owned),
    });

    match located {
        Ok(payload) => {
            let codestream_len = payload.len();
            rec.located(t0, LocateOutcome::Ok, codestream_len);
            let wire_len = ENVELOPE_LEN + codestream_len;

            // Both copies the copy path makes happen inside the write region, as they
            // did before the chunked path existed — `located` still means "found", not
            // "found and materialised".
            let t1 = rec.stamp();
            let result = match payload {
                Payload::Borrowed(bytes) => {
                    let buf = wrap(idx, bytes);
                    write_payload(connection, shared, acks, &buf).await
                }
                Payload::Owned(body) => {
                    write_payload_chunked(connection, shared, acks, idx, body).await
                }
            };
            match result {
                Ok(()) => rec.wrote(t1, WriteOutcome::Sent, wire_len),
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
/// Both write `[4B BE len][envelope]`; the modes differ only in how long a stream lives.
async fn write_payload(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    acks: &mut JoinSet<()>,
    payload: &[u8],
) -> Result<()> {
    // Two writes, not one buffer: building `[len][payload]` would copy the whole frame a
    // second time (`wrap` already copied it once). `write_all` copies into the connection's
    // send buffer either way, so the extra allocation buys nothing.
    // See docs/send-path-copy-costs.md. This fix has been reverted once — keep it.
    let len = (payload.len() as u32).to_be_bytes();
    match shared {
        Some(uni) => {
            uni.write_all(&len).await.context("write shared len")?;
            uni.write_all(payload).await.context("write shared frame")?;
        }
        None => {
            let mut uni = connection
                .open_uni()
                .await
                .context("open uni")?
                .await
                .context("open uni ready")?;
            uni.write_all(&len).await.context("write len")?;
            uni.write_all(payload).await.context("write envelope")?;

            // `finish()` is MOVED off this loop, not deleted: wtransport's `finish()` awaits
            // the peer's acknowledgement (~272 ms measured), which caps throughput at
            // Tf/(Tf+RTT) when awaited inline. See docs/adr-frame-framing-and-loop-shape.md.
            acks.spawn(async move {
                let _ = uni.finish().await;
            });
        }
    }
    Ok(())
}

/// The located codestream, in the shape the chosen send path wants.
///
/// `SendPath` is resolved to one of these per frame, so the write below matches on a
/// value rather than re-reading the flag — the same shape `StreamMode` uses.
enum Payload<'a> {
    /// Copy path control: mapped bytes, wrapped and copied at write time.
    Borrowed(&'a [u8]),
    /// Chunked path: a refcounted slice of the mapping, written without a copy.
    Owned(Bytes),
}

impl Payload<'_> {
    fn len(&self) -> usize {
        match self {
            Self::Borrowed(b) => b.len(),
            Self::Owned(b) => b.len(),
        }
    }
}

/// `[4B BE total_len][4B BE display_index]` — the first 8 bytes of a framed envelope.
///
/// Pinned against the copy path by `chunked_header_matches_copy_path`: the chunked
/// writer must put exactly these bytes in front of the codestream, or the two send
/// paths are not the same wire and no arm comparing them means anything.
fn envelope_header(idx: u32, codestream_len: usize) -> [u8; ENVELOPE_LEN * 2] {
    let wire_len = (ENVELOPE_LEN + codestream_len) as u32;
    let mut header = [0u8; ENVELOPE_LEN * 2];
    header[..ENVELOPE_LEN].copy_from_slice(&wire_len.to_be_bytes());
    header[ENVELOPE_LEN..].copy_from_slice(&idx.to_be_bytes());
    header
}

/// Same bytes on the wire as `write_payload`, without materialising them.
///
/// `[4B BE len][4B BE display_index]` is an 8-byte header chunk; the codestream is a
/// `Bytes` slice of the study mapping. `quinn::SendStream::write_all_chunks` *moves*
/// each `Bytes` into the connection's send buffer (`BytesArray::pop_chunk` is a
/// `mem::take`), where `write_all(&[u8])` allocates and copies (`ByteSlice::pop_chunk`
/// is `Bytes::from(data.to_owned())`). Reached through `quic_stream_mut()` because
/// `wtransport::SendStream` exposes only the `&[u8]` writes.
async fn write_payload_chunked(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    acks: &mut JoinSet<()>,
    idx: u32,
    body: Bytes,
) -> Result<()> {
    let mut chunks = [
        Bytes::copy_from_slice(&envelope_header(idx, body.len())),
        body,
    ];

    match shared {
        Some(uni) => {
            uni.quic_stream_mut()
                .write_all_chunks(&mut chunks)
                .await
                .context("write shared frame chunks")?;
        }
        None => {
            let mut uni = connection
                .open_uni()
                .await
                .context("open uni")?
                .await
                .context("open uni ready")?;
            uni.quic_stream_mut()
                .write_all_chunks(&mut chunks)
                .await
                .context("write frame chunks")?;
            // Same reason as the copy path: `finish()` awaits the peer acknowledgement,
            // which caps throughput at Tf/(Tf+RTT) when awaited inline.
            acks.spawn(async move {
                let _ = uni.finish().await;
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::wire::length_prefixed;

    /// The chunked path must be byte-identical to `length_prefixed(wrap(idx, body))`.
    #[test]
    fn chunked_header_matches_copy_path() {
        for (idx, body) in [
            (0u32, b"".as_slice()),
            (1, b"x"),
            (7, b"htj2k-codestream-bytes"),
            (u32::MAX, &[0xAB; 4096]),
        ] {
            let copy_wire = length_prefixed(&wrap(idx, body));
            let header = envelope_header(idx, body.len());
            let mut chunked_wire = header.to_vec();
            chunked_wire.extend_from_slice(body);
            assert_eq!(copy_wire, chunked_wire, "idx {idx}, body {}", body.len());
        }
    }
}
