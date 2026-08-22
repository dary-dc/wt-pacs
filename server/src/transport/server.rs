//! FoD ask → envelope on server uni stream (Media-complete).

use crate::media::frame_store::FrameStore;
use crate::transport::tls::load_pem_cert;
use crate::transport::wire::{read_fod_msg, write_fod_msg};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::wrap;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};
use wtransport::{Endpoint, Identity, ServerConfig};

pub struct ServeConfig {
    pub wt_port: u16,
    pub study_path: PathBuf,
    pub cert_pem: PathBuf,
    pub key_pem: PathBuf,
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
    info!(
        %wt_url,
        study = %config.study_path.display(),
        "exact-server ready (Media-complete)"
    );

    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store).await {
                warn!(%err, "session ended");
            }
        });
    }
}

async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    store: Arc<FrameStore>,
) -> Result<()> {
    let session_request = incoming.await.context("incoming session")?;
    let connection = session_request.accept().await.context("accept session")?;
    info!(frames = store.frame_count(), "session opened");

    let (mut control_send, mut control_recv) = connection
        .accept_bi()
        .await
        .context("accept control bidi")?;

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
                send_frames(&connection, &mut control_send, &store, &[frame]).await?;
            }
            FodMsg::RequestFrames { frames } => {
                send_frames(&connection, &mut control_send, &store, &frames).await?;
            }
            FodMsg::EndSession => break,
            other => warn!(?other, "ask-only: ignoring unexpected FoD message"),
        }
    }
    Ok(())
}

async fn send_frames(
    connection: &wtransport::Connection,
    control_send: &mut wtransport::stream::SendStream,
    store: &FrameStore,
    requested: &[u32],
) -> Result<()> {
    for &idx in requested {
        let bytes = match store.frame_slice(idx) {
            Ok(bytes) => bytes,
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
                continue;
