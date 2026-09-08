//! FoD ask → envelope on a server uni stream, serially. docs/adr-reject-server-ordering.md.

use crate::media::frame_store::FrameStore;
use crate::record::{LocateOutcome, Recorder, WriteOutcome};
use crate::transport::tls::load_pem_cert;
use crate::transport::tuning::{SendPath, TransportTuning};
use crate::transport::wire::{read_fod_msg, write_fod_msg};
use anyhow::{Context, Result};
use bytes::Bytes;
use fod::FodMsg;
use frame_envelope::ENVELOPE_LEN;
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

/// How a session serves frames, resolved once from `ServeConfig`.
#[derive(Clone, Copy)]
struct Serving {
    ask_priority: bool,
    send_path: SendPath,
    prefault: bool,
}

pub struct ServeConfig {
    pub wt_port: u16,
    pub study_path: PathBuf,
    pub cert_pem: PathBuf,
    pub key_pem: PathBuf,
    /// How frames reach the client for this process. See `StreamMode`.
    pub mode: StreamMode,
    /// Per-frame only: decreasing QUIC stream priority in ask order. L1 arm Q.
    #[cfg(feature = "lab")]
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

    let builder = match config.bind_ip {
        Some(ip) => ServerConfig::builder()
            .with_bind_address(std::net::SocketAddr::new(ip, config.wt_port)),
        None => ServerConfig::builder().with_bind_default(config.wt_port),
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
    let serving = Serving {
        #[cfg(feature = "lab")]
        ask_priority: config.ask_priority,
        #[cfg(not(feature = "lab"))]
        ask_priority: false,
        send_path: config.tuning.send_path,
        prefault: config.tuning.prefault,
    };
    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store, mode, serving).await {
                warn!(%err, "session ended");
            }
        });
    }
}

async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    store: Arc<FrameStore>,
    mode: StreamMode,
    mut serving: Serving,
) -> Result<()> {
    let session_request = incoming.await.context("incoming session")?;
    let connection = session_request.accept().await.context("accept session")?;

    let (control_send, control_recv) = connection
        .accept_bi()
        .await
        .context("accept control bidi")?;

    // Resolved once, so nothing downstream branches on the flag.
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

    // With one shared stream there is nothing to order, so this is resolved once here
    // rather than checked again at every write.
    serving.ask_priority &= matches!(mode, StreamMode::PerFrame);

    run_session(connection, control_send, control_recv, store, shared, serving).await
}

/// Read one FoD ask → send that frame to completion → repeat. EndSession stops the loop.
async fn run_session(
    connection: Connection,
    mut control_send: SendStream,
    mut control_recv: RecvStream,
    store: Arc<FrameStore>,
    mut shared: Option<SendStream>,
    serving: Serving,
) -> Result<()> {
    let mut rec = Recorder::for_session();
    // Ask ordinal within the session; priority decreases as it grows, so the earliest
    // ask keeps the highest priority.
    let mut ask_seq: i32 = 0;

    // Ends with the connection, so it cannot outlive what it describes.
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
                    serving,
                    &mut ask_seq,
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
                        serving,
                        &mut ask_seq,
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

// `rec.stamp()` is `()` unless `feature = "telemetry"`, which is what the zero-sized
// recorder is for; clippy sees only the disabled shape.
#[allow(clippy::too_many_arguments, clippy::let_unit_value)]
async fn send_one_frame(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    acks: &mut JoinSet<()>,
    control_send: &mut SendStream,
    store: &Arc<FrameStore>,
    idx: u32,
    rec: &mut Recorder,
    serving: Serving,
    ask_seq: &mut i32,
) -> Result<()> {
    rec.ask(idx);
    #[cfg(feature = "lab")]
    let t_serve = serve_timing_enabled().then(|| (idx, Instant::now()));
    #[cfg(not(feature = "lab"))]
    let t_serve: Option<(u32, Instant)> = None;

    let t0 = rec.stamp();
    // Prefault off the executor — a major fault is not an `.await`.
    // TODO(readability): hide Arc (inner FrameStore handle or block_in_place); perf unchanged.
    let touch = if serving.prefault {
        let store_touch = Arc::clone(store);
        tokio::task::spawn_blocking(move || store_touch.touch_frame_pages(idx))
            .await
            .context("join frame page touch")?
    } else {
        Ok(())
    };

    let located = touch.and_then(|_| store.frame_bytes(idx));

    match located {
        Ok(body) => {
            let codestream_len = body.len();
            rec.located(t0, LocateOutcome::Ok, codestream_len);
            let wire_len = ENVELOPE_LEN + codestream_len;

            // The copy path's copies happen inside the write region, as they did before
            // the chunked path existed: `located` means "found", not "materialised".
            let t1 = rec.stamp();
            let result = match serving.send_path {
                #[cfg(feature = "lab")]
                SendPath::Copy => {
                    let buf = frame_envelope::wrap(idx, &body);
                    write_payload(connection, shared, acks, &buf, serving.ask_priority, ask_seq, t_serve)
                        .await
                }
                SendPath::Chunked => {
                    write_payload_chunked(
                        connection, shared, acks, idx, body, serving.ask_priority, ask_seq, t_serve,
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

/// Open a per-frame uni stream. Shared by both send paths: a priority applied on only one
/// of them would silently make the arms incomparable.
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
/// `WT_SERVE_TIMING`, read once. Reading it per frame takes the process environment lock.
#[cfg(feature = "lab")]
fn serve_timing_enabled() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("WT_SERVE_TIMING").is_some())
}

fn note_serve_timing(timing: Option<(u32, Instant)>, mode: &str, t_first: Instant) {
    if let Some((idx, t_ask)) = timing {
        let ask_to_first_ms = t_first.duration_since(t_ask).as_secs_f64() * 1000.0;
        let ask_to_last_ms = t_ask.elapsed().as_secs_f64() * 1000.0;
        eprintln!(
            "serve_timing frame={idx} mode={mode} ask_to_first_ms={ask_to_first_ms:.3} ask_to_last_ms={ask_to_last_ms:.3}"
        );
    }
}

/// The copy path: two full-frame copies, reproducing `main` exactly. The rollback hatch.
#[cfg(feature = "lab")]
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
    // Two writes, not one buffer: making `[len][payload]` contiguous copies the frame a
    // third time. Reverted once already — keep it.
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

            // Moved off this loop, not deleted: `finish()` awaits the peer's ack (~272 ms).
            acks.spawn(async move {
                let _ = uni.finish().await;
            });
        }
    }
    Ok(())
}

/// `[4B BE total_len][4B BE display_index]`, pinned against the copy path by
/// `all_send_paths_are_the_same_wire`.
fn envelope_header(idx: u32, codestream_len: usize) -> [u8; ENVELOPE_LEN * 2] {
    let wire_len = (ENVELOPE_LEN + codestream_len) as u32;
    let mut header = [0u8; ENVELOPE_LEN * 2];
    header[..ENVELOPE_LEN].copy_from_slice(&wire_len.to_be_bytes());
    header[ENVELOPE_LEN..].copy_from_slice(&idx.to_be_bytes());
    header
}

/// Same wire as `write_payload`, without materialising it: `write_all_chunks` moves each
/// `Bytes` into the send buffer where `write_all(&[u8])` allocates and copies.
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

    /// Both send paths must put identical bytes on the wire, or every arm comparing
    /// them is comparing two protocols. This is the acceptance gate for the merge port.
    #[test]
    fn all_send_paths_are_the_same_wire() {
        for (idx, body) in [
            (0u32, b"".as_slice()),
            (1, b"x"),
            (7, b"htj2k-codestream-bytes"),
            (u32::MAX, &[0xAB; 4096]),
        ] {
            let copy_wire = length_prefixed(&frame_envelope::wrap(idx, body));

            let mut chunked_wire = envelope_header(idx, body.len()).to_vec();
            chunked_wire.extend_from_slice(body);

            assert_eq!(copy_wire, chunked_wire, "idx {idx}, {} B", body.len());
        }
    }
}
