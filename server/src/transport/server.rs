//! FoD ask → envelope on server uni stream (Media-complete).
//!
//! Serial loop: read one ask, send it to completion, read the next.
//! No server-side ask queue — see docs/adr-reject-server-ordering.md.

use crate::media::frame_store::FrameStore;
use crate::transport::tls::load_pem_cert;
use crate::transport::wire::{read_fod_msg, write_fod_msg};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::wrap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, info, warn};
use wtransport::stream::{RecvStream, SendStream};
use wtransport::{Connection, Endpoint, Identity, ServerConfig};

pub struct ServeConfig {
    pub wt_port: u16,
    pub study_path: PathBuf,
    pub cert_pem: PathBuf,
    pub key_pem: PathBuf,
    /// Send every frame on **one** shared uni stream, length-prefixed, instead of
    /// opening a stream per frame.
    ///
    /// The viewer integration target uses one stream per endpoint, so measurements
    /// taken in per-frame-stream mode do not describe it. See
    /// `docs/window-saturation-experiment.md` §3e. Default stays per-frame.
    pub shared_stream: bool,
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

    let shared_stream = config.shared_stream;
    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store, shared_stream).await {
                warn!(%err, "session ended");
            }
        });
    }
}

async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    store: Arc<FrameStore>,
    shared_stream: bool,
) -> Result<()> {
    let session_request = incoming.await.context("incoming session")?;
    let connection = session_request.accept().await.context("accept session")?;
    info!(frames = store.frame_count(), shared_stream, "session opened");

    let (control_send, control_recv) = connection
        .accept_bi()
        .await
        .context("accept control bidi")?;

    run_session(connection, control_send, control_recv, store, shared_stream).await
}

/// Read one FoD ask → send that frame to completion → repeat. EndSession stops the loop.
async fn run_session(
    connection: Connection,
    mut control_send: SendStream,
    mut control_recv: RecvStream,
    store: Arc<FrameStore>,
    shared_stream: bool,
) -> Result<()> {
    // Opened once per session when shared; frames are length-prefixed into it in order.
    let mut shared: Option<SendStream> = if shared_stream {
        Some(
            connection
                .open_uni()
                .await
                .context("open shared uni")?
                .await
                .context("shared uni ready")?,
        )
    } else {
        None
    };
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
                send_one_frame(&connection, &mut shared, &mut control_send, &store, frame).await?;
            }
            FodMsg::RequestFrames { frames } => {
                for frame in frames {
                    send_one_frame(&connection, &mut shared, &mut control_send, &store, frame).await?;
                }
            }
            FodMsg::EndSession => break,
            other => {
                warn!(?other, "ask-only: ignoring unexpected FoD message");
            }
        }
    }
    Ok(())
}

async fn send_one_frame(
    connection: &Connection,
    shared: &mut Option<SendStream>,
    control_send: &mut SendStream,
    store: &FrameStore,
    idx: u32,
) -> Result<()> {
    let work_start = Instant::now();
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
            return Ok(());
        }
    };
    let payload = wrap(idx, bytes);
    let work_us = work_start.elapsed().as_micros() as u64;

    let write_start = Instant::now();
    match shared {
        // Shared stream: [4B BE envelope_len][envelope]. Stream stays open for the session.
        Some(uni) => {
            let len = (payload.len() as u32).to_be_bytes();
            uni.write_all(&len).await.context("write shared len")?;
            uni.write_all(&payload).await.context("write shared envelope")?;
        }
        // Per-frame stream: stream end delimits the envelope.
        //
        // **This path caps server throughput at `Tf / (Tf + RTT)` of the link.** Measured
        // 2026-08-26 under netem (250 KB frames, 10 Mbit, 60 ms RTT): `open_uni` 0.0 ms,
        // `write_all` 0.1 ms, **`finish` 272 ms** — `finish().await` blocks until the frame is
        // transmitted and acknowledged, and this loop is serial, so the server cannot read the
        // next ask until then. Client-side ask depth cannot help: measured flat at 7.00 Mbps for
        // D = 1, 2, 4 and 8 alike, against 8.50 on the shared stream.
        //
        // It degrades with RTT: at 51 KB frames and 150 ms RTT the ceiling is ~21% of the link.
        // The shared-stream path has no per-frame `finish()`, so `write_all` returns once buffered
        // and the loop proceeds. See `docs/adr-client-window-depth.md`.
        None => {
            let mut uni = connection
                .open_uni()
                .await
                .context("open uni")?
                .await
                .context("open uni ready")?;
            uni.write_all(&payload).await.context("write envelope")?;
            uni.finish().await.context("finish uni")?;
        }
    }
    let write_us = write_start.elapsed().as_micros() as u64;

    debug!(frame = idx, work_us, write_us, "frame sent");
    Ok(())
}
