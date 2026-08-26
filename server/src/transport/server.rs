//! FoD ask → envelope on server uni stream (Media-complete).
//!
//! Serial loop: read one ask, send it to completion, read the next.
//! No server-side ask queue — see docs/adr-reject-server-ordering.md.
//!
//! Recording: generic `R: Record` seam (`crate::record`). Production uses `Noop`;
//! lab builds (`feature = "telemetry"`) may attach `Tap` at the single spawn-site fork.

use crate::media::frame_store::FrameStore;
use crate::record::{LocateOutcome, Noop, Record, WriteOutcome};
use crate::transport::sink::{FrameSink, PeerAckStamp, StreamMode};
use crate::transport::tls::load_pem_cert;
use crate::transport::wire::{read_fod_msg, write_fod_msg};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::wrap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};
use wtransport::stream::{RecvStream, SendStream};
use wtransport::{Connection, Endpoint, Identity, ServerConfig};

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

    spawn_session(connection, control_send, control_recv, store, mode).await
}

/// The only `cfg` fork in product code (R10).
async fn spawn_session(
    connection: Connection,
    control_send: SendStream,
    control_recv: RecvStream,
    store: Arc<FrameStore>,
    mode: StreamMode,
) -> Result<()> {
    #[cfg(feature = "telemetry")]
    {
        if let Some(tap) = crate::record::tap::Tap::for_session() {
            return run_session(connection, control_send, control_recv, store, mode, tap).await;
        }
    }
    run_session(
        connection,
        control_send,
        control_recv,
        store,
        mode,
        Noop,
    )
    .await
}

fn drain_acks<R: Record>(sink: &mut FrameSink<R::Stamp>, rec: &mut R)
where
    R::Stamp: PeerAckStamp,
{
    while let Some(ack) = sink.try_recv_ack() {
        rec.delivered(ack.since, ack.outcome, ack.frame_index);
    }
}

/// Read one FoD ask → send that frame to completion → repeat. EndSession stops the loop.
async fn run_session<R: Record>(
    connection: Connection,
    mut control_send: SendStream,
    mut control_recv: RecvStream,
    store: Arc<FrameStore>,
    mode: StreamMode,
    mut rec: R,
) -> Result<()>
where
    R::Stamp: PeerAckStamp,
{
    info!(frames = store.frame_count(), ?mode, "session opened");

    let mut sink = FrameSink::open(&connection, mode).await?;

    loop {
        drain_acks(&mut sink, &mut rec);

        let msg = match read_fod_msg(&mut control_recv).await {
            Ok(m) => m,
            Err(err) => {
                warn!(%err, "control read ended");
                break;
            }
        };

        match msg {
            FodMsg::RequestFrame { frame } => {
                send_one_frame(&mut sink, &mut control_send, &store, frame, &mut rec).await?;
            }
            FodMsg::RequestFrames { frames } => {
                for frame in frames {
                    send_one_frame(&mut sink, &mut control_send, &store, frame, &mut rec).await?;
                }
            }
            FodMsg::EndSession => break,
            other => {
                warn!(?other, "ask-only: ignoring unexpected FoD message");
            }
        }
    }

    drain_acks(&mut sink, &mut rec);
    let _ = tokio::time::timeout(Duration::from_secs(2), sink.drain()).await;
    drain_acks(&mut sink, &mut rec);
    Ok(())
}

async fn send_one_frame<R: Record>(
    sink: &mut FrameSink<R::Stamp>,
    control_send: &mut SendStream,
    store: &FrameStore,
    idx: u32,
    rec: &mut R,
) -> Result<()>
where
    R::Stamp: PeerAckStamp,
{
    rec.ask(idx);

    let t0 = rec.stamp();
    match store.frame_slice(idx) {
        Ok(bytes) => {
            rec.located(t0, LocateOutcome::Ok, bytes.len());

            let t1 = rec.stamp();
            let payload = wrap(idx, bytes);
            match sink.send(idx, &payload).await {
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
