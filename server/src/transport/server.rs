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
use std::time::{Duration, Instant};
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
    /// When true and `mode` is `PerFrame`, assign decreasing QUIC stream priorities
    /// in ask order (earliest ask → highest priority). Ignored for `Shared`.
    pub ask_priority: bool,
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
    let ask_priority = config.ask_priority;
    let send_path = config.tuning.send_path;
    let prefault = config.tuning.prefault;
    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store, mode, ask_priority, send_path, prefault).await {
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

#[allow(clippy::too_many_arguments)]
async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    store: Arc<FrameStore>,
    mode: StreamMode,
    ask_priority: bool,
    send_path: SendPath,
    prefault: bool,
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

    run_session(
        connection,
        control_send,
        control_recv,
        store,
        shared,
        // Priority ordering is a per-frame-stream mechanism; with one shared stream there
        // is nothing to order, so the flag is resolved to false here rather than checked
        // again at every write.
        ask_priority && matches!(mode, StreamMode::PerFrame),
        send_path,
        prefault,
    )
    .await
}

/// Read one FoD ask → send that frame to completion → repeat. EndSession stops the loop.
async fn run_session(
    connection: Connection,
    mut control_send: SendStream,
    mut control_recv: RecvStream,
    store: Arc<FrameStore>,
    mut shared: Option<SendStream>,
    ask_priority: bool,
    send_path: SendPath,
    prefault: bool,
) -> Result<()> {
    let mut rec = Recorder::for_session();
    // Ask ordinal within the session; priority decreases as it grows, so the earliest
    // ask keeps the highest priority.
    let mut ask_seq: i32 = 0;

    // Loss-regime sampler. Never spawned unless WTPACS_PATH_TELEMETRY is set, and it ends
    // with the connection, so it cannot outlive what it describes. See
    // `record::path` for why this lives on the server rather than in the browser client.
    #[cfg(feature = "telemetry")]
    let _path_sampler = tokio::spawn(crate::record::path::run(connection.clone()));

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
                    ask_priority,
                    &mut ask_seq,
                    send_path,
                    prefault,
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
                        ask_priority,
                        &mut ask_seq,
                        send_path,
                        prefault,
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
    ask_priority: bool,
    ask_seq: &mut i32,
    send_path: SendPath,
    prefault: bool,
) -> Result<()> {
    rec.ask(idx);
    // Isolation B: wall clock from ask-handled → first/last write_all into quinn.
    // Enable with WT_SERVE_TIMING=1 (stderr lines `serve_timing ...`).
    let timing = std::env::var_os("WT_SERVE_TIMING").is_some();
    let t_ask = Instant::now();

    let t0 = rec.stamp();
    // Prefault off the executor — a major fault is not an `.await`.
    // TODO(readability): hide Arc (inner FrameStore handle or block_in_place); perf unchanged.
    let touch = if prefault {
        let store_touch = Arc::clone(store);
        tokio::task::spawn_blocking(move || store_touch.touch_frame_pages(idx))
            .await
            .context("join frame page touch")?
    } else {
        Ok(())
    };

    let located = touch.and_then(|_| match send_path {
        SendPath::Copy | SendPath::Split => store.frame_slice(idx).map(Payload::Borrowed),
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
            let t_serve = timing.then_some((idx, t_ask));
            let result = match payload {
                Payload::Borrowed(bytes) if send_path == SendPath::Copy => {
                    let buf = wrap(idx, bytes);
                    write_payload(connection, shared, acks, &buf, ask_priority, ask_seq, t_serve)
                        .await
                }
                Payload::Borrowed(bytes) => {
                    write_payload_split(
                        connection, shared, acks, idx, bytes, ask_priority, ask_seq, t_serve,
                    )
                    .await
                }
                Payload::Owned(body) => {
                    write_payload_chunked(
                        connection, shared, acks, idx, body, ask_priority, ask_seq, t_serve,
                    )
                    .await
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
/// Open a per-frame uni stream, applying ask-order priority when the arm asks for it.
///
/// Extracted because all three send paths open a stream and both merged branches needed a
/// hook right here — L1's `--ask-priority` arm and the copy/split/chunked split. Three
/// copies of this would drift, and a priority applied on only some paths would silently
/// make the arms incomparable.
async fn open_frame_uni(
    connection: &Connection,
    ask_priority: bool,
    ask_seq: &mut i32,
) -> Result<SendStream> {
    // `set_priority` takes `&self`, so no `mut` is needed here; the callers bind it
    // mutably because `write_all` does.
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

/// `serve_timing` line for offline join with the client's ask ordinals.
///
/// Gated by `WT_SERVE_TIMING`; `timing` is `None` when it is unset, so this is a no-op on
/// the measured path.
fn note_serve_timing(timing: Option<(u32, Instant)>, mode: &str, t_first: Instant) {
    if let Some((idx, t_ask)) = timing {
        let ask_to_first_ms = t_first.duration_since(t_ask).as_secs_f64() * 1000.0;
        let ask_to_last_ms = t_ask.elapsed().as_secs_f64() * 1000.0;
        eprintln!(
            "serve_timing frame={idx} mode={mode} ask_to_first_ms={ask_to_first_ms:.3} ask_to_last_ms={ask_to_last_ms:.3}"
        );
    }
}

#[allow(clippy::too_many_arguments)]
async fn write_payload(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    acks: &mut JoinSet<()>,
    payload: &[u8],
    ask_priority: bool,
    ask_seq: &mut i32,
    timing: Option<(u32, Instant)>,
) -> Result<()> {
    // Two writes, not one buffer: building `[len][payload]` would copy the whole frame a
    // second time (`wrap` already copied it once). `write_all` copies into the connection's
    // send buffer either way, so the extra allocation buys nothing.
    // See docs/send-path-copy-costs.md. This fix has been reverted once — keep it.
    let len = (payload.len() as u32).to_be_bytes();
    match shared {
        Some(uni) => {
            let t_first = Instant::now();
            uni.write_all(&len).await.context("write shared len")?;
            uni.write_all(payload).await.context("write shared frame")?;
            note_serve_timing(timing, "shared", t_first);
        }
        None => {
            let mut uni = open_frame_uni(connection, ask_priority, ask_seq).await?;
            let t_first = Instant::now();
            uni.write_all(&len).await.context("write len")?;
            uni.write_all(payload).await.context("write envelope")?;
            note_serve_timing(timing, "per-frame", t_first);

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

/// `[len]`, `[index]`, codestream as three separate `&[u8]` writes.
///
/// Drops `wrap()`'s allocation — nothing is ever made contiguous — but each
/// `write_all(&[u8])` still reaches `ByteSlice::pop_chunk`, which allocates and copies
/// into the send buffer. So the codestream is copied once, not twice. This is the
/// current best shape and the baseline the chunked path is measured against.
#[allow(clippy::too_many_arguments)]
async fn write_payload_split(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    acks: &mut JoinSet<()>,
    idx: u32,
    codestream: &[u8],
    ask_priority: bool,
    ask_seq: &mut i32,
    timing: Option<(u32, Instant)>,
) -> Result<()> {
    let header = envelope_header(idx, codestream.len());
    let (len, index) = header.split_at(ENVELOPE_LEN);
    match shared {
        Some(uni) => {
            let t_first = Instant::now();
            uni.write_all(len).await.context("write shared len")?;
            uni.write_all(index).await.context("write shared index")?;
            uni.write_all(codestream)
                .await
                .context("write shared codestream")?;
            note_serve_timing(timing, "shared", t_first);
        }
        None => {
            let mut uni = open_frame_uni(connection, ask_priority, ask_seq).await?;
            let t_first = Instant::now();
            uni.write_all(len).await.context("write len")?;
            uni.write_all(index).await.context("write index")?;
            uni.write_all(codestream).await.context("write codestream")?;
            note_serve_timing(timing, "per-frame", t_first);
            acks.spawn(async move {
                let _ = uni.finish().await;
            });
        }
    }
    Ok(())
}

/// Same bytes on the wire as `write_payload`, without materialising them.
///
/// `[4B BE len][4B BE display_index]` is an 8-byte header chunk; the codestream is a
/// `Bytes` slice of the study mapping. `quinn::SendStream::write_all_chunks` *moves*
/// each `Bytes` into the connection's send buffer (`BytesArray::pop_chunk` is a
/// `mem::take`), where `write_all(&[u8])` allocates and copies (`ByteSlice::pop_chunk`
/// is `Bytes::from(data.to_owned())`). Reached through `quic_stream_mut()` because
/// `wtransport::SendStream` exposes only the `&[u8]` writes.
#[allow(clippy::too_many_arguments)]
async fn write_payload_chunked(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    acks: &mut JoinSet<()>,
    idx: u32,
    body: Bytes,
    ask_priority: bool,
    ask_seq: &mut i32,
    timing: Option<(u32, Instant)>,
) -> Result<()> {
    let mut chunks = [
        Bytes::copy_from_slice(&envelope_header(idx, body.len())),
        body,
    ];

    match shared {
        Some(uni) => {
            let t_first = Instant::now();
            uni.quic_stream_mut()
                .write_all_chunks(&mut chunks)
                .await
                .context("write shared frame chunks")?;
            note_serve_timing(timing, "shared", t_first);
        }
        None => {
            let mut uni = open_frame_uni(connection, ask_priority, ask_seq).await?;
            let t_first = Instant::now();
            uni.quic_stream_mut()
                .write_all_chunks(&mut chunks)
                .await
                .context("write frame chunks")?;
            note_serve_timing(timing, "per-frame", t_first);
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

    /// All three send paths must put identical bytes on the wire.
    ///
    /// `copy` builds `length_prefixed(wrap(..))`; `split` writes the two header halves
    /// then the codestream; `chunked` writes the 8-byte header then the codestream. If
    /// these ever diverge, the arms are measuring different protocols and every number
    /// in `docs/quic-transport-optimization.md` is void.
    #[test]
    fn all_send_paths_are_the_same_wire() {
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

            let (len, index) = header.split_at(ENVELOPE_LEN);
            let mut split_wire = len.to_vec();
            split_wire.extend_from_slice(index);
            split_wire.extend_from_slice(body);

            assert_eq!(copy_wire, chunked_wire, "chunked, idx {idx}, {} B", body.len());
            assert_eq!(copy_wire, split_wire, "split, idx {idx}, {} B", body.len());
        }
    }
}
