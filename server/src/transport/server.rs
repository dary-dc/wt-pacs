//! FoD ask → envelope on server uni stream (Media-complete).
//!
//! Serial loop: read one ask, send it to completion, read the next.
//! No server-side ask queue — see docs/adr-reject-server-ordering.md.
//!
//! Per-frame work: [`pipeline::FramePipeline`] trait (product [`pipeline::ProductPipeline`] /
//! lab [`pipeline::RecordedPipeline`]). See `docs/telemetry/adr-server-pipeline.md`.
//!
//! Frame bytes: streamed a window at a time straight from the page cache, inside the
//! pipeline's `send` step — see `docs/disk-access/adr.md`. Nothing is faulted on the
//! executor and nothing is copied into a whole-frame envelope; the session's window buffer
//! is the only per-session allocation.

use crate::media::frame_store::FrameStore;
use crate::transport::frame_out::FrameOut;
use crate::transport::pipeline::{FramePipeline, ProductPipeline};
use crate::transport::stream_mode::StreamMode;
use crate::transport::tls::load_pem_cert;
use crate::transport::wire::read_fod_msg;
use anyhow::{Context, Result};
use fod::FodMsg;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};
use wtransport::config::{states, IpBindConfig, QuicTransportConfig, ServerConfigBuilder};
use wtransport::endpoint::endpoint_side;
use wtransport::stream::{RecvStream, SendStream};
use wtransport::{Endpoint, Identity, ServerConfig};

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use crate::transport::pipeline::RecordedPipeline;

pub struct ServeConfig {
    pub wt_port: u16,
    pub study_path: PathBuf,
    pub cert_pem: PathBuf,
    pub key_pem: PathBuf,
    pub mode: StreamMode,
    /// Explicit bind address. `None` binds dual-stack `[::]` and falls back to `0.0.0.0` on a
    /// host with no IPv6 stack (containers commonly lack one).
    pub bind: Option<IpAddr>,
    /// QUIC transport knobs. Each `None` keeps the library default (send window 10 MB per
    /// connection, stream receive window 1.25 MB, idle timeout 30 s). The send window is the
    /// number that scales with slow clients: it bounds unacknowledged bytes held per connection.
    pub transport: TransportKnobs,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TransportKnobs {
    pub send_window_bytes: Option<u64>,
    pub stream_receive_window_bytes: Option<u32>,
    pub max_idle_timeout_ms: Option<u64>,
}

impl TransportKnobs {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// One line for the startup banner.
    pub fn describe(&self) -> String {
        if self.is_default() {
            return "default".to_string();
        }
        let mut parts = Vec::new();
        if let Some(v) = self.send_window_bytes {
            parts.push(format!("send_window={v}"));
        }
        if let Some(v) = self.stream_receive_window_bytes {
            parts.push(format!("stream_receive_window={v}"));
        }
        if let Some(v) = self.max_idle_timeout_ms {
            parts.push(format!("max_idle_timeout_ms={v}"));
        }
        parts.join(",")
    }
}

pub async fn run_server(config: ServeConfig) -> Result<()> {
    let cert_pem = std::fs::read_to_string(&config.cert_pem)
        .with_context(|| format!("read {}", config.cert_pem.display()))?;
    let key_pem = std::fs::read_to_string(&config.key_pem)
        .with_context(|| format!("read {}", config.key_pem.display()))?;
    let cert = load_pem_cert(&cert_pem, &key_pem)?;

    let (endpoint, bound) = build_endpoint(&config).await?;

    let store = Arc::new(FrameStore::open(&config.study_path).context("open study")?);

    // Lab builds: the report says what was served, so the two harvest files can be checked
    // against each other without trusting a folder name.
    #[cfg(feature = "telemetry")]
    crate::record::set_run_meta(crate::record::RunMeta {
        stream_mode: config.mode.as_str(),
        study: config.study_path.display().to_string(),
        study_frames: store.frame_count(),
    });

    let wt_url = format!("https://127.0.0.1:{}/", config.wt_port);
    let cert_sha256 = cert.sha256_hex().to_string();
    println!("wt_url={wt_url}");
    println!("cert_sha256={cert_sha256}");
    println!("study={}", config.study_path.display());
    println!("frames={}", store.frame_count());
    println!("completion=media_uni_stream");
    println!("stream_mode={}", config.mode.as_str());
    println!("bind={bound}");
    println!("transport={}", config.transport.describe());
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

/// Open the QUIC endpoint. Dual-stack any is the default; a host without an IPv6 stack refuses
/// that socket (`Address family not supported`), so fall back to IPv4 any rather than not starting.
async fn build_endpoint(config: &ServeConfig) -> Result<(Endpoint<endpoint_side::Server>, String)> {
    async fn identity(config: &ServeConfig) -> Result<Identity> {
        Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
            .await
            .context("load wtransport identity")
    }

    /// Identity plus transport knobs, from whichever bind the builder was given.
    fn finish(
        builder: ServerConfigBuilder<states::WantsIdentity>,
        identity: Identity,
        knobs: TransportKnobs,
    ) -> Result<ServerConfig> {
        if knobs.is_default() {
            return Ok(builder.with_identity(identity).build());
        }
        let mut transport = QuicTransportConfig::default();
        if let Some(v) = knobs.send_window_bytes {
            transport.send_window(v);
        }
        if let Some(v) = knobs.stream_receive_window_bytes {
            transport.stream_receive_window(v.into());
        }
        let mut builder = builder.with_custom_transport(identity, transport);
        if let Some(ms) = knobs.max_idle_timeout_ms {
            builder = builder
                .max_idle_timeout(Some(Duration::from_millis(ms)))
                .map_err(|_| anyhow::anyhow!("max_idle_timeout_ms {ms} out of range"))?;
        }
        Ok(builder.build())
    }

    let knobs = config.transport;

    if let Some(ip) = config.bind {
        let server_config = finish(
            ServerConfig::builder().with_bind_address(SocketAddr::new(ip, config.wt_port)),
            identity(config).await?,
            knobs,
        )?;
        let endpoint = Endpoint::server(server_config)
            .with_context(|| format!("wtransport endpoint on {ip}:{}", config.wt_port))?;
        return Ok((endpoint, ip.to_string()));
    }

    let dual = finish(
        ServerConfig::builder().with_bind_default(config.wt_port),
        identity(config).await?,
        knobs,
    )?;
    match Endpoint::server(dual) {
        Ok(endpoint) => Ok((endpoint, "[::] dual-stack".to_string())),
        Err(err) => {
            warn!(%err, "dual-stack bind failed; falling back to IPv4 any");
            let v4 = finish(
                ServerConfig::builder().with_bind_config(IpBindConfig::InAddrAnyV4, config.wt_port),
                identity(config).await?,
                knobs,
            )?;
            let endpoint = Endpoint::server(v4).context("wtransport endpoint (IPv4 fallback)")?;
            Ok((
                endpoint,
                "0.0.0.0 (IPv4 fallback: no dual-stack)".to_string(),
            ))
        }
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

    let out = FrameOut::open(mode, connection).await?;
    let mut product = ProductPipeline::new(store, out);

    // Lab wrap only when env on — RecordedPipeline always holds a live Tap.
    #[cfg(feature = "telemetry")]
    if let Some(tap) = Tap::for_session() {
        return run_session(
            &mut RecordedPipeline::new(product, tap),
            control_send,
            control_recv,
        )
        .await;
    }

    run_session(&mut product, control_send, control_recv).await
}

/// Read one FoD ask → send that frame to completion → repeat. EndSession stops the loop.
///
/// **One frame at a time, and that is the whole session's depth.** The next ask is not even
/// read off the control stream until the current frame is on the wire, so a client that
/// pipelines `RequestFrame` messages still gets served serially — its outstanding asks queue
/// in the transport, not in the server. `RequestFrames` is the same shape by another route.
/// See `docs/adr-frame-framing-and-loop-shape.md` §Serving depth.
async fn run_session<P: FramePipeline>(
    pipeline: &mut P,
    mut control_send: SendStream,
    mut control_recv: RecvStream,
) -> Result<()> {
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
                pipeline.serve_one(frame, &mut control_send).await?;
            }
            FodMsg::RequestFrames { frames } => {
                pipeline.serve_batch(&frames, &mut control_send).await?;
            }
            FodMsg::EndSession => break,
            other => {
                warn!(?other, "ask-only: ignoring unexpected FoD message");
            }
        }
    }

    pipeline.drain_acks().await;
    Ok(())
}
