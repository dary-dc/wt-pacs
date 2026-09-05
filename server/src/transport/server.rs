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
use frame_envelope::wrap;
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
    println!("ask_priority={}", config.ask_priority);
    #[cfg(feature = "telemetry")]
    println!("telemetry=compile-time");
    #[cfg(not(feature = "telemetry"))]
    println!("telemetry=absent");
    info!(
        %wt_url,
        study = %config.study_path.display(),
        stream_mode = config.mode.as_str(),
        ask_priority = config.ask_priority,
        "exact-server ready (Media-complete)"
    );

    let mode = config.mode;
    let ask_priority = config.ask_priority;
    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store, mode, ask_priority).await {
                warn!(%err, "session ended");
            }
        });
    }
}

async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    store: Arc<FrameStore>,
    mode: StreamMode,
    ask_priority: bool,
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
        ask_priority && matches!(mode, StreamMode::PerFrame),
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
) -> Result<()> {
    let mut rec = Recorder::for_session();

    info!(
        frames = store.frame_count(),
        shared = shared.is_some(),
        ask_priority,
        "session opened"
    );

    // Per-frame mode only: holds the acknowledgement waits moved off this loop.
    let mut acks = JoinSet::new();
    // Ask order for QUIC stream priority (earliest ask → highest priority).
    let mut ask_seq: i32 = 0;

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
) -> Result<()> {
    rec.ask(idx);
    // Isolation B: wall clock from ask-handled → first/last write_all into quinn.
    // Enable with WT_SERVE_TIMING=1 (stderr lines `serve_timing ...`).
    let timing = std::env::var_os("WT_SERVE_TIMING").is_some();
    let t_ask = Instant::now();

    let t0 = rec.stamp();
    // Prefault off the executor — a major fault is not an `.await`.
    // TODO(readability): hide Arc (inner FrameStore handle or block_in_place); perf unchanged.
    let store_touch = Arc::clone(store);
    let touch = tokio::task::spawn_blocking(move || store_touch.touch_frame_pages(idx))
        .await
        .context("join frame page touch")?;

    match touch.and_then(|_| store.frame_slice(idx)) {
        Ok(bytes) => {
            rec.located(t0, LocateOutcome::Ok, bytes.len());

            let t1 = rec.stamp();
            let payload = wrap(idx, bytes);
            match write_payload(
                connection,
                shared,
                acks,
                &payload,
                ask_priority,
                ask_seq,
                timing.then_some((idx, t_ask)),
            )
            .await
            {
                Ok(()) => rec.wrote(t1, WriteOutcome::Sent, payload.len()),
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
            if let Some((idx, t_ask)) = timing {
                let ask_to_first_ms = t_first.duration_since(t_ask).as_secs_f64() * 1000.0;
                let ask_to_last_ms = t_ask.elapsed().as_secs_f64() * 1000.0;
                eprintln!(
                    "serve_timing frame={idx} mode=shared ask_to_first_ms={ask_to_first_ms:.3} ask_to_last_ms={ask_to_last_ms:.3}"
                );
            }
        }
        None => {
            let mut uni = connection
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
            let t_first = Instant::now();
            uni.write_all(&len).await.context("write len")?;
            uni.write_all(payload).await.context("write envelope")?;
            if let Some((idx, t_ask)) = timing {
                let ask_to_first_ms = t_first.duration_since(t_ask).as_secs_f64() * 1000.0;
                let ask_to_last_ms = t_ask.elapsed().as_secs_f64() * 1000.0;
                eprintln!(
                    "serve_timing frame={idx} mode=per-frame ask_to_first_ms={ask_to_first_ms:.3} ask_to_last_ms={ask_to_last_ms:.3}"
                );
            }

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
