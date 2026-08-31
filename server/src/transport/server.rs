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
    store: &FrameStore,
    idx: u32,
    rec: &mut Recorder,
) -> Result<()> {
    rec.ask(idx);

    let t0 = rec.stamp();
    match store.frame_slice(idx) {
        Ok(bytes) => {
            rec.located(t0, LocateOutcome::Ok, bytes.len());

            let t1 = rec.stamp();
            let envelope_len = ENVELOPE_LEN + bytes.len();
            match write_payload(connection, shared, acks, idx, bytes).await {
                Ok(()) => rec.wrote(t1, WriteOutcome::Sent, envelope_len),
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
/// Both write `[4B BE len][4B BE display_index][codestream]`; the modes differ only in how long a
/// stream lives. Three writes — len, index, mmap slice — avoid assembling a contiguous envelope
/// (`wrap()` memcpy). `write_all` still copies the codestream into QUIC's send buffer once.
async fn write_payload(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    acks: &mut JoinSet<()>,
    display_index: u32,
    codestream: &[u8],
) -> Result<()> {
    let envelope_len = (ENVELOPE_LEN + codestream.len()) as u32;
    let len = envelope_len.to_be_bytes();
    let index = display_index.to_be_bytes();
    match shared {
        Some(uni) => {
            uni.write_all(&len).await.context("write shared len")?;
            uni.write_all(&index).await.context("write shared index")?;
            uni.write_all(codestream)
                .await
                .context("write shared codestream")?;
        }
        None => {
            let mut uni = connection
                .open_uni()
                .await
                .context("open uni")?
                .await
                .context("open uni ready")?;
            uni.write_all(&len).await.context("write len")?;
            uni.write_all(&index).await.context("write index")?;
            uni.write_all(codestream)
                .await
                .context("write codestream")?;

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
