//! FoD ask → envelope on a server uni stream. No server-side ask queue —
//! `docs/adr-reject-server-ordering.md`. Per-frame work is [`pipeline::FramePipeline`].

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
    /// `None` binds dual-stack `[::]`, falling back to `0.0.0.0` where there is no IPv6.
    pub bind: Option<IpAddr>,
    /// Each `None` keeps the library default.
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
    println!("read_fast_path={}", read_fast_path(&store));
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

/// Warns where the fast path is absent: the fallback is correct and ~2.5x slower per frame.
/// `docs/disk-access/DEPLOYMENT.md`.
fn read_fast_path(store: &FrameStore) -> &'static str {
    if store.nowait_supported() {
        return "preadv2";
    }
    warn!(
        "RWF_NOWAIT is refused here (overlayfs or tmpfs?); every frame costs a blocking-pool \
         round trip. See docs/disk-access/DEPLOYMENT.md"
    );
    "pooled_pread"
}

/// A host without an IPv6 stack refuses the dual-stack socket, so fall back to IPv4 any.
async fn build_endpoint(config: &ServeConfig) -> Result<(Endpoint<endpoint_side::Server>, String)> {
    async fn identity(config: &ServeConfig) -> Result<Identity> {
        Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
            .await
            .context("load wtransport identity")
    }

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

/// **One frame at a time is the session's whole depth**: a client that pipelines asks still
/// gets them served serially. `docs/adr-frame-framing-and-loop-shape.md` §Serving depth.
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
                pipeline.serve_one(frame, None, &mut control_send).await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use fod::FodMsg;
    use frame_envelope::unwrap;
    use std::io::Write;
    use wtransport::ClientConfig;

    /// A study of `frames` frames, each a different length and pattern, so a batch served
    /// out of the wrong window or the wrong order cannot pass.
    fn write_study(dir: &std::path::Path, frames: u32) -> std::path::PathBuf {
        let bodies: Vec<Vec<u8>> = (0..frames).map(pattern).collect();
        let refs: Vec<&[u8]> = bodies.iter().map(|b| b.as_slice()).collect();
        let path = dir.join("batch.sbnd");
        study_bundle::write_bundle(
            &path,
            format!("{{\"frameCount\":{frames}}}").as_bytes(),
            &refs,
        )
        .expect("write study");
        path
    }

    /// Longer than one read window, so a frame takes several reads and the look-ahead has
    /// to survive them.
    fn pattern(idx: u32) -> Vec<u8> {
        let len = crate::media::frame_store::READ_WINDOW as u32 + 1 + idx * 997;
        (0..len)
            .map(|b| (b.wrapping_mul(31).wrapping_add(idx.wrapping_mul(7)) % 251) as u8)
            .collect()
    }

    /// A cert the client can pin by hash, the way a browser does — P-256 and under two
    /// weeks, which is what `with_server_certificate_hashes` will accept.
    fn write_dev_cert(dir: &std::path::Path) -> (PathBuf, PathBuf, [u8; 32]) {
        use sha2::{Digest, Sha256};
        let now = time::OffsetDateTime::now_utc();
        let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).expect("key");
        let mut params =
            rcgen::CertificateParams::new(vec!["localhost".to_string()]).expect("params");
        params.subject_alt_names = vec![
            rcgen::SanType::DnsName("localhost".try_into().unwrap()),
            rcgen::SanType::IpAddress(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
        ];
        params.not_before = now - time::Duration::hours(1);
        params.not_after = now + time::Duration::days(7);
        let cert = params.self_signed(&key).expect("self-signed");

        let (cert_path, key_path) = (dir.join("cert.pem"), dir.join("key.pem"));
        std::fs::File::create(&cert_path)
            .and_then(|mut f| f.write_all(cert.pem().as_bytes()))
            .expect("cert pem");
        std::fs::File::create(&key_path)
            .and_then(|mut f| f.write_all(key.serialize_pem().as_bytes()))
            .expect("key pem");
        (cert_path, key_path, Sha256::digest(cert.der()).into())
    }

    /// A port nobody is listening on right now. Racy in principle; the alternative is a
    /// fixed port, which collides with a developer running the server.
    fn free_port() -> u16 {
        std::net::UdpSocket::bind("127.0.0.1:0")
            .and_then(|s| s.local_addr())
            .expect("free port")
            .port()
    }

    /// Read one length-prefixed envelope off the shared media stream.
    async fn read_envelope(recv: &mut RecvStream) -> (u32, Vec<u8>) {
        let mut head = [0u8; 4];
        read_exact(recv, &mut head).await;
        let mut body = vec![0u8; u32::from_be_bytes(head) as usize];
        read_exact(recv, &mut body).await;
        let (idx, codestream) = unwrap(&body).expect("envelope");
        (idx, codestream.to_vec())
    }

    async fn read_exact(recv: &mut RecvStream, out: &mut [u8]) {
        let mut done = 0;
        while done < out.len() {
            let n = recv
                .read(&mut out[done..])
                .await
                .expect("read")
                .expect("stream ended early");
            done += n;
        }
    }

    /// **`serve_batch` over the wire.** Every frame of a `RequestFrames` arrives whole and
    /// in ask order, with the read ahead running under it — the one path where a frame is
    /// served out of a window that was filled while the frame before it was still being
    /// sent. `docs/adr-frame-framing-and-loop-shape.md` §Serving depth.
    #[test]
    fn a_batch_arrives_whole_and_in_ask_order() {
        let dir = std::env::temp_dir().join(format!("wtpacs-batch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let frames = 6u32;
        let study = write_study(&dir, frames);
        let (cert_pem, key_pem, cert_hash) = write_dev_cert(&dir);
        let port = free_port();

        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("rt");
        let _ = rustls::crypto::ring::default_provider().install_default();

        rt.block_on(async move {
            let server = tokio::spawn(run_server(ServeConfig {
                wt_port: port,
                study_path: study,
                cert_pem,
                key_pem,
                mode: StreamMode::Shared,
                bind: Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
                transport: TransportKnobs::default(),
            }));

            let endpoint = wtransport::Endpoint::client(
                ClientConfig::builder()
                    .with_bind_config(IpBindConfig::InAddrAnyV4)
                    .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(
                        cert_hash,
                    )])
                    .build(),
            )
            .expect("client endpoint");
            let url = format!("https://127.0.0.1:{port}/");

            let mut connection = None;
            for _ in 0..50 {
                match endpoint.connect(url.clone()).await {
                    Ok(c) => {
                        connection = Some(c);
                        break;
                    }
                    Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
                }
            }
            let connection = connection.expect("server never accepted a connection");

            let (mut control, _control_recv) =
                connection.open_bi().await.expect("open bi").await.expect("bi ready");
            let asked: Vec<u32> = (0..frames).collect();
            control
                .write_all(&fod::encode_fod_msg(&FodMsg::RequestFrames { frames: asked.clone() }).unwrap())
                .await
                .expect("ask");

            let mut media = connection.accept_uni().await.expect("accept media uni");
            for want in asked {
                let (idx, codestream) =
                    tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                        .await
                        .expect("frame never arrived");
                assert_eq!(idx, want, "frames arrived out of ask order");
                assert_eq!(codestream, pattern(want), "frame {want} came back wrong");
            }
            server.abort();
        });
        std::fs::remove_dir_all(&dir).ok();
    }
}
