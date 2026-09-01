//! FoD ask → envelope on server uni stream (Media-complete).
//!
//! Serial loop: read one ask, send it to completion, read the next.
//! No server-side ask queue — see docs/adr-reject-server-ordering.md.
//!
//! Stream mode is resolved once per session into `FrameOut` (shared uni vs per-frame).
//! Recording (Decision C / Option B): product `LiveSink` has zero telemetry tokens;
//! lab builds wrap it in `RecordedSink` at session start. See
//! `docs/telemetry/adr-server-frame-sink.md`.

use crate::media::frame_store::FrameStore;
use crate::transport::frame_sink::{FrameOut, FrameSink, LiveSink};
use crate::transport::tls::load_pem_cert;
use crate::transport::wire::{read_fod_msg, write_fod_msg};
use anyhow::{Context, Result};
use fod::FodMsg;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};
use wtransport::stream::{RecvStream, SendStream};
use wtransport::{Endpoint, Identity, ServerConfig};

#[cfg(feature = "telemetry")]
use crate::record::Recorder;
#[cfg(feature = "telemetry")]
use crate::transport::frame_sink::RecordedSink;

/// How frames reach the client. A process-wide configuration choice, resolved to an
/// `FrameOut` once per session.
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

    // Mode → FrameOut once. No Option<SendStream> re-checked per frame downstream.
    let out = match mode {
        StreamMode::Shared => {
            let uni = connection
                .open_uni()
                .await
                .context("open shared uni")?
                .await
                .context("shared uni ready")?;
            FrameOut::shared(uni)
        }
        StreamMode::PerFrame => FrameOut::per_frame(connection),
    };
    let is_shared = out.is_shared();
    let sink = LiveSink::new(out);

    // Fork once: default binary never constructs RecordedSink / Recorder.
    #[cfg(feature = "telemetry")]
    {
        let rec = Recorder::for_session();
        return run_session(
            RecordedSink { inner: sink, rec },
            control_send,
            control_recv,
            store,
            is_shared,
        )
        .await;
    }

    #[cfg(not(feature = "telemetry"))]
    {
        run_session(sink, control_send, control_recv, store, is_shared).await
    }
}

/// Read one FoD ask → send that frame to completion → repeat. EndSession stops the loop.
async fn run_session<S: FrameSink>(
    mut sink: S,
    mut control_send: SendStream,
    mut control_recv: RecvStream,
    store: Arc<FrameStore>,
    is_shared: bool,
) -> Result<()> {
    info!(
        frames = store.frame_count(),
        shared = is_shared,
        "session opened"
    );

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
                send_one_frame(&mut sink, &mut control_send, &store, frame).await?;
            }
            FodMsg::RequestFrames { frames } => {
                for frame in frames {
                    send_one_frame(&mut sink, &mut control_send, &store, frame).await?;
                }
            }
            FodMsg::EndSession => break,
            other => {
                warn!(?other, "ask-only: ignoring unexpected FoD message");
            }
        }
    }

    sink.drain_acks().await;
    Ok(())
}

async fn send_one_frame<S: FrameSink>(
    sink: &mut S,
    control_send: &mut SendStream,
    store: &FrameStore,
    idx: u32,
) -> Result<()> {
    sink.ask(idx);

    match sink.time_locate(|| store.frame_slice(idx)) {
        Ok(bytes) => sink.send_frame(idx, bytes).await,
        Err(err) => {
            warn!(frame = idx, %err, "frame refused");
            write_fod_msg(
                control_send,
                &FodMsg::FrameError {
                    frame_index: idx,
                    reason: err.to_string(),
                },
            )
            .await?;
            sink.on_refused();
            Ok(())
        }
    }
}
