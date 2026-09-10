//! FoD ask → envelope on a server uni stream. No server-side ask queue —
//! `docs/adr-reject-server-ordering.md`. Per-frame work is [`pipeline::FramePipeline`].

use crate::media::frame_store::FrameStore;
use crate::transport::frame_out::FrameOut;
use crate::transport::pipeline::{FramePipeline, ProductPipeline};
use crate::transport::planner::{Ask, Planner, Step, ASKS_AHEAD};
use crate::transport::stream_mode::StreamMode;
use crate::transport::tuning::TransportTuning;
use crate::transport::wire::read_fod_msg;
use anyhow::{anyhow, Context, Result};
use fod::{encode_fod_msg, FodMsg};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{info, warn};
use wtransport::config::{states, IpBindConfig, ServerConfigBuilder};
use wtransport::endpoint::endpoint_side;
use wtransport::stream::RecvStream;
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
    /// QUIC transport knobs. Unset fields keep the library default.
    pub tuning: TransportTuning,
}

pub async fn run_server(config: ServeConfig) -> Result<()> {
    let identity = Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
        .await
        .with_context(|| format!("load TLS identity from {}", config.cert_pem.display()))?;
    let cert_sha256 = cert_sha256_hex(&identity)?;

    let (endpoint, bound) = build_endpoint(&config).await?;

    let store = Arc::new(FrameStore::open(&config.study_path).context("open study")?);
    let study_fod = Arc::<[u8]>::from(encode_fod_msg(&FodMsg::Study {
        frames: store.frame_count(),
    })?);

    #[cfg(feature = "telemetry")]
    crate::record::set_run_meta(crate::record::RunMeta {
        stream_mode: config.mode.as_str(),
        study: config.study_path.display().to_string(),
        study_frames: store.frame_count(),
    });

    let wt_url = format!("https://127.0.0.1:{}/", config.wt_port);
    println!("wt_url={wt_url}");
    println!("cert_sha256={cert_sha256}");
    println!("study={}", config.study_path.display());
    println!("frames={}", store.frame_count());
    println!("read_fast_path={}", read_fast_path(&store));
    println!("completion=media_uni_stream");
    println!("stream_mode={}", config.mode.as_str());
    println!("bind={bound}");
    println!("transport={}", config.tuning.describe());
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
        let study_fod = Arc::clone(&study_fod);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store, study_fod, mode).await {
                warn!(%err, "session ended");
            }
        });
    }
}

/// Lower-case hex SHA-256 of the leaf certificate — the value a browser pins through
/// `serverCertificateHashes`, printed in the banner for the harness and `dev-transport.json`.
fn cert_sha256_hex(identity: &Identity) -> Result<String> {
    let leaf = identity
        .certificate_chain()
        .as_slice()
        .first()
        .context("certificate PEM holds no certificate")?;
    Ok(leaf
        .hash()
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
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
        tuning: &TransportTuning,
    ) -> Result<ServerConfig> {
        if tuning.quic_is_library_default() {
            return Ok(builder.with_identity(identity).build());
        }
        let transport = tuning.to_transport_config()?;
        let mut builder = builder.with_custom_transport(identity, transport);
        if let Some(ms) = tuning.max_idle_timeout_ms {
            builder = builder
                .max_idle_timeout(Some(Duration::from_millis(ms)))
                .map_err(|_| anyhow::anyhow!("max_idle_timeout_ms {ms} out of range"))?;
        }
        Ok(builder.build())
    }

    if let Some(ip) = config.bind {
        let server_config = finish(
            ServerConfig::builder().with_bind_address(SocketAddr::new(ip, config.wt_port)),
            identity(config).await?,
            &config.tuning,
        )?;
        let endpoint = Endpoint::server(server_config)
            .with_context(|| format!("wtransport endpoint on {ip}:{}", config.wt_port))?;
        return Ok((endpoint, ip.to_string()));
    }

    let dual = finish(
        ServerConfig::builder().with_bind_default(config.wt_port),
        identity(config).await?,
        &config.tuning,
    )?;
    match Endpoint::server(dual) {
        Ok(endpoint) => Ok((endpoint, "[::] dual-stack".to_string())),
        Err(err) => {
            warn!(%err, "dual-stack bind failed; falling back to IPv4 any");
            let v4 = finish(
                ServerConfig::builder().with_bind_config(IpBindConfig::InAddrAnyV4, config.wt_port),
                identity(config).await?,
                &config.tuning,
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
    study_fod: Arc<[u8]>,
    mode: StreamMode,
) -> Result<()> {
    let session_request = incoming.await.context("incoming session")?;
    let connection = session_request.accept().await.context("accept session")?;

    #[cfg(feature = "telemetry")]
    tokio::spawn(crate::record::path::run(connection.clone()));

    let (mut control_send, control_recv) = connection
        .accept_bi()
        .await
        .context("accept control bidi")?;
    // Catalog, once, before any ask. `docs/WIRE.md`.
    control_send
        .write_all(&study_fod)
        .await
        .context("write study")?;

    let out = FrameOut::open(mode, connection).await?;
    let mut product = ProductPipeline::new(store, out).with_control(control_send);

    #[cfg(feature = "telemetry")]
    if let Some(tap) = Tap::for_session() {
        return run_session(&mut RecordedPipeline::new(product, tap), control_recv).await;
    }

    run_session(&mut product, control_recv).await
}

/// The reader owns the control stream; the planner decides; the pipeline serves.
/// `docs/disk-access/IMPLEMENTATION.md`.
async fn run_session<P: FramePipeline>(pipeline: &mut P, control_recv: RecvStream) -> Result<()> {
    let (reader, mut asks) = spawn_ask_reader(control_recv);
    let result = drive(pipeline, &mut asks).await;
    reader.abort();
    let _ = reader.await;
    result
}

/// The loop over `Ask`, with no stream in it, so a test can drive it without QUIC.
async fn drive<P: FramePipeline>(pipeline: &mut P, asks: &mut mpsc::Receiver<Ask>) -> Result<()> {
    let mut plan = Planner::new(pipeline.store().frame_count());
    loop {
        let step = plan.next(|| asks.try_recv().ok())?;
        if plan.take_noted_fill() {
            pipeline.note_fill();
        }
        match step {
            Step::Serve {
                frame,
                upcoming,
                mode,
            } => pipeline.serve(frame, &upcoming, mode).await?,
            Step::Refuse { frame, reason } => {
                pipeline.refuse(frame, anyhow!(reason)).await?;
            }
            Step::Wait => match asks.recv().await {
                Some(ask) => plan.push(ask),
                None => break,
            },
            Step::End => break,
        }
    }
    pipeline.drain_acks().await;
    Ok(())
}

fn spawn_ask_reader(
    mut control_recv: RecvStream,
) -> (tokio::task::JoinHandle<()>, mpsc::Receiver<Ask>) {
    let (tx, rx) = mpsc::channel(ASKS_AHEAD);
    let reader = tokio::spawn(async move {
        loop {
            if read_asks(&mut control_recv, &tx).await.is_err() {
                return;
            }
        }
    });
    (reader, rx)
}

async fn read_asks(control_recv: &mut RecvStream, tx: &mpsc::Sender<Ask>) -> Result<(), ()> {
    let ask = match read_fod_msg(control_recv).await {
        Ok(FodMsg::RequestFrame { frame }) => {
            tx.send(Ask::Frame(frame)).await.map_err(|_| ())?;
            return Ok(());
        }
        Ok(FodMsg::RequestFrames { frames }) => {
            for frame in frames {
                tx.send(Ask::Frame(frame)).await.map_err(|_| ())?;
            }
            return Ok(());
        }
        Ok(FodMsg::StreamFrames { from, to }) => Ask::Fill { from, to },
        Ok(FodMsg::EndStream) => Ask::EndStream,
        Ok(FodMsg::EndSession) => Ask::EndSession,
        Ok(FodMsg::FrameError { .. }) | Ok(FodMsg::Study { .. }) => return Ok(()),
        Err(err) => Ask::Failed(err),
    };
    let failed = matches!(ask, Ask::Failed(_));
    tx.send(ask).await.map_err(|_| ())?;
    if failed {
        Err(())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::frame_store::FrameSpan;
    use crate::transport::planner::Mode;
    use crate::transport::wire::read_fod_msg;
    use fod::FodMsg;
    use frame_envelope::unwrap;
    use std::io::{Read, Write};
    use std::time::Instant;
    use wtransport::stream::SendStream;
    use wtransport::ClientConfig;

    /// Records what the loop hands the pipeline: the frame and the names that go with it.
    struct LoopRecorder {
        store: Arc<FrameStore>,
        seen: Vec<(u32, Vec<u32>)>,
        fills: u32,
    }

    impl FramePipeline for LoopRecorder {
        fn store(&self) -> &Arc<FrameStore> {
            &self.store
        }
        fn locate(&mut self, store: &FrameStore, frame: u32) -> Result<FrameSpan> {
            store.frame_span(frame)
        }
        async fn send(
            &mut self,
            _frame: u32,
            _store: &Arc<FrameStore>,
            _span: FrameSpan,
            _ahead: &[FrameSpan],
            _mode: Mode,
        ) -> Result<()> {
            Ok(())
        }
        async fn serve(&mut self, frame: u32, upcoming: &[u32], _mode: Mode) -> Result<()> {
            self.seen.push((frame, upcoming.to_vec()));
            Ok(())
        }
        async fn refuse(&mut self, _frame: u32, _err: anyhow::Error) -> Result<()> {
            Ok(())
        }
        async fn drain_acks(&mut self) {}
        fn note_fill(&mut self) {
            self.fills += 1;
        }
    }

    /// **The loop's own line.** `Step::Serve`'s `upcoming` reaches `serve`; a fill names
    /// `FILL_AHEAD` and is counted once. No QUIC — the seam below `serve` is
    /// `pipeline.rs`'s. `docs/disk-access/IMPLEMENTATION.md`.
    #[test]
    fn the_loop_hands_serve_the_frames_the_planner_named() {
        let dir = std::env::temp_dir().join(format!("wtpacs-drive-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let study = write_study(&dir, 4);
        let store = Arc::new(FrameStore::open(&study).expect("open store"));
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("rt");

        let mut rec = LoopRecorder {
            store,
            seen: Vec::new(),
            fills: 0,
        };
        let (tx, mut rx) = mpsc::channel(ASKS_AHEAD);
        for ask in [Ask::Frame(0), Ask::Frame(2), Ask::Frame(3), Ask::EndSession] {
            tx.try_send(ask).expect("queue ask");
        }
        rt.block_on(drive(&mut rec, &mut rx)).expect("drive");
        assert_eq!(
            rec.seen,
            vec![(0, vec![2, 3]), (2, vec![3]), (3, vec![])],
            "the planner's names did not reach serve"
        );

        let mut rec = LoopRecorder {
            store: Arc::clone(rec.store()),
            seen: Vec::new(),
            fills: 0,
        };
        let (tx, mut rx) = mpsc::channel(ASKS_AHEAD);
        tx.try_send(Ask::Fill {
            from: Some(1),
            to: Some(3),
        })
        .expect("queue fill");
        tx.try_send(Ask::EndSession).expect("queue end");
        drop(tx);
        rt.block_on(drive(&mut rec, &mut rx)).expect("drive fill");
        assert_eq!(rec.fills, 0, "a fill cancelled by EndSession was counted");

        let mut rec = LoopRecorder {
            store: Arc::clone(rec.store()),
            seen: Vec::new(),
            fills: 0,
        };
        let (tx, mut rx) = mpsc::channel(ASKS_AHEAD);
        tx.try_send(Ask::Fill {
            from: Some(1),
            to: Some(3),
        })
        .expect("queue fill");
        drop(tx);
        rt.block_on(drive(&mut rec, &mut rx)).expect("drive fill");
        assert_eq!(
            rec.seen,
            vec![(1, vec![2]), (2, vec![3]), (3, vec![])],
            "a fill did not name one frame ahead"
        );
        assert_eq!(rec.fills, 1, "a fill that served was not counted once");
        std::fs::remove_dir_all(&dir).ok();
    }

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

    /// **`RequestFrames` over the wire.** Every frame arrives whole and in ask order, with
    /// the read ahead running under it — the one path where a frame is served out of a
    /// window that was filled while the frame before it was still being sent.
    #[test]
    fn a_batch_arrives_whole_and_in_ask_order() {
        let frames = 6u32;
        wire_test(frames, |mut control, mut media| async move {
            let asked: Vec<u32> = (0..frames).collect();
            control
                .write_all(
                    &fod::encode_fod_msg(&FodMsg::RequestFrames {
                        frames: asked.clone(),
                    })
                    .unwrap(),
                )
                .await
                .expect("ask");
            for want in asked {
                let (idx, codestream) =
                    tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                        .await
                        .expect("frame never arrived");
                assert_eq!(idx, want, "frames arrived out of ask order");
                assert_eq!(codestream, pattern(want), "frame {want} came back wrong");
            }
        });
    }

    /// Pipelined `RequestFrame`s reach the loop as `current` + `upcoming`, not one-at-a-time.
    /// `docs/adr-frame-framing-and-loop-shape.md` §6d.
    #[test]
    fn pipelined_single_asks_arrive_whole_and_in_ask_order() {
        let frames = 6u32;
        wire_test(frames, |mut control, mut media| async move {
            let asked: Vec<u32> = (0..frames).collect();
            for &frame in &asked {
                control
                    .write_all(&fod::encode_fod_msg(&FodMsg::RequestFrame { frame }).unwrap())
                    .await
                    .expect("ask");
            }
            for want in asked {
                let (idx, codestream) =
                    tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                        .await
                        .expect("frame never arrived");
                assert_eq!(idx, want, "frames arrived out of ask order");
                assert_eq!(codestream, pattern(want), "frame {want} came back wrong");
            }
        });
    }

    async fn connect_session(
        study: PathBuf,
        cert_pem: PathBuf,
        key_pem: PathBuf,
        cert_hash: [u8; 32],
        port: u16,
    ) -> (
        tokio::task::JoinHandle<Result<()>>,
        wtransport::Connection,
        SendStream,
        RecvStream,
        RecvStream,
    ) {
        let server = tokio::spawn(run_server(ServeConfig {
            wt_port: port,
            study_path: study,
            cert_pem,
            key_pem,
            mode: StreamMode::Shared,
            bind: Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
            tuning: TransportTuning::default(),
        }));
        let endpoint = wtransport::Endpoint::client(
            ClientConfig::builder()
                .with_bind_config(IpBindConfig::InAddrAnyV4)
                .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
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
        let (control, control_recv) = connection
            .open_bi()
            .await
            .expect("open bi")
            .await
            .expect("bi ready");
        let media = connection.accept_uni().await.expect("accept media uni");
        (server, connection, control, control_recv, media)
    }

    fn wire_test<F, Fut>(frames: u32, body: F)
    where
        F: FnOnce(SendStream, RecvStream) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("wtpacs-wire-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
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
            let (server, _conn, control, _control_in, media) =
                connect_session(study, cert_pem, key_pem, cert_hash, port).await;
            body(control, media).await;
            server.abort();
        });
        std::fs::remove_dir_all(&dir).ok();
    }

    async fn open_client(
        cert_hash: [u8; 32],
        port: u16,
    ) -> (wtransport::Connection, SendStream, RecvStream, RecvStream) {
        let endpoint = wtransport::Endpoint::client(
            ClientConfig::builder()
                .with_bind_config(IpBindConfig::InAddrAnyV4)
                .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
                .build(),
        )
        .expect("client endpoint");
        let url = format!("https://127.0.0.1:{port}/");
        let connection = endpoint.connect(url).await.expect("connect");
        let (control, control_recv) = connection
            .open_bi()
            .await
            .expect("open bi")
            .await
            .expect("bi ready");
        let media = connection.accept_uni().await.expect("accept media uni");
        (connection, control, control_recv, media)
    }

    async fn catalog_from_control(control_in: &mut RecvStream) -> (u32, Duration) {
        let t0 = Instant::now();
        let msg = tokio::time::timeout(Duration::from_secs(5), read_fod_msg(control_in))
            .await
            .expect("study never arrived")
            .expect("study decode");
        let dt = t0.elapsed();
        match msg {
            FodMsg::Study { frames } => (frames, dt),
            other => panic!("first control message was {other:?}, not study"),
        }
    }

    fn sidecar_get(port: u16) -> (u32, Duration) {
        let t0 = Instant::now();
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).expect("sidecar");
        s.set_read_timeout(Some(Duration::from_secs(2)))
            .expect("timeout");
        s.write_all(b"GET /study/metadata HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
            .expect("write get");
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).expect("read body");
        let text = String::from_utf8_lossy(&buf);
        let body = text.split("\r\n\r\n").nth(1).expect("http body");
        let v: serde_json::Value = serde_json::from_str(body.trim()).expect("json");
        (
            v["frameCount"].as_u64().expect("frameCount") as u32,
            t0.elapsed(),
        )
    }

    fn spawn_sidecar(body: Vec<u8>) -> (u16, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind sidecar");
        let port = listener.local_addr().expect("addr").port();
        let handle = std::thread::spawn(move || {
            listener.set_nonblocking(true).expect("nonblocking");
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(30) {
                match listener.accept() {
                    Ok((mut s, _)) => {
                        let mut req = [0u8; 256];
                        let _ = s.read(&mut req);
                        let head = format!(
                            "HTTP/1.0 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = s.write_all(head.as_bytes());
                        let _ = s.write_all(&body);
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    Err(_) => break,
                }
            }
        });
        (port, handle)
    }

    fn median_us(samples: &mut [u32]) -> u32 {
        samples.sort_unstable();
        samples[samples.len() / 2]
    }

    /// The catalog is the first control message, and it names the study the store opened.
    #[test]
    fn the_study_descriptor_is_the_first_control_message() {
        let frames = 5u32;
        let dir = std::env::temp_dir().join(format!("wtpacs-study-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
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
            let (server, _conn, mut control, mut control_in, mut media) =
                connect_session(study, cert_pem, key_pem, cert_hash, port).await;
            let (got, _) = catalog_from_control(&mut control_in).await;
            assert_eq!(got, frames, "catalog named a different study");
            control
                .write_all(&fod::encode_fod_msg(&FodMsg::RequestFrame { frame: 0 }).unwrap())
                .await
                .expect("ask");
            let (idx, _) = tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                .await
                .expect("frame");
            assert_eq!(idx, 0, "a catalog write blocked the first ask");
            server.abort();
        });
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Catalog latency after the bidi is up: control `study` vs a sidecar HTTP GET.
    /// Interleaved; the claim is the FoD already in the receive buffer, not a second RTT.
    #[test]
    fn catalog_on_control_is_faster_than_a_sidecar_get() {
        let frames = 4u32;
        let dir = std::env::temp_dir().join(format!("wtpacs-catalog-ab-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let study = write_study(&dir, frames);
        let (cert_pem, key_pem, cert_hash) = write_dev_cert(&dir);
        let wt_port = free_port();
        let meta = format!("{{\"frameCount\":{frames}}}").into_bytes();
        let (http_port, sidecar) = spawn_sidecar(meta);
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("rt");
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (mut study_us, mut http_us) = rt.block_on(async move {
            let (server, _conn, _c, mut control_in, _m) =
                connect_session(study, cert_pem, key_pem, cert_hash, wt_port).await;
            let mut study_us = Vec::new();
            let mut http_us = Vec::new();
            for i in 0..8 {
                let http_first = i % 2 == 0;
                if http_first {
                    let (n, dt) = sidecar_get(http_port);
                    assert_eq!(n, frames);
                    http_us.push(dt.as_micros() as u32);
                }
                if i == 0 {
                    let (n, dt) = catalog_from_control(&mut control_in).await;
                    assert_eq!(n, frames);
                    study_us.push(dt.as_micros() as u32);
                } else {
                    let (_conn, _c, mut cin, _m) = open_client(cert_hash, wt_port).await;
                    let (n, dt) = catalog_from_control(&mut cin).await;
                    assert_eq!(n, frames);
                    study_us.push(dt.as_micros() as u32);
                }
                if !http_first {
                    let (n, dt) = sidecar_get(http_port);
                    assert_eq!(n, frames);
                    http_us.push(dt.as_micros() as u32);
                }
            }
            server.abort();
            (study_us, http_us)
        });
        let study_p50 = median_us(&mut study_us);
        let http_p50 = median_us(&mut http_us);
        eprintln!("catalog p50: study={study_p50} us sidecar_http={http_p50} us");
        assert!(
            study_p50 < http_p50,
            "control catalog p50 {study_p50} us was not below sidecar HTTP {http_p50} us"
        );
        drop(sidecar);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// `StreamFrames { from, to }` recites that range, nothing outside it.
    #[test]
    fn stream_frames_range_arrives_in_order() {
        wire_test(6, |mut control, mut media| async move {
            control
                .write_all(
                    &fod::encode_fod_msg(&FodMsg::StreamFrames {
                        from: Some(1),
                        to: Some(3),
                    })
                    .unwrap(),
                )
                .await
                .expect("ask");
            for want in 1..=3 {
                let (idx, codestream) =
                    tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                        .await
                        .expect("frame never arrived");
                assert_eq!(idx, want, "frames arrived out of fill order");
                assert_eq!(codestream, pattern(want), "frame {want} came back wrong");
            }
            let extra =
                tokio::time::timeout(Duration::from_millis(200), read_envelope(&mut media)).await;
            assert!(extra.is_err(), "fill sent a frame past `to`");
        });
    }

    /// `StreamFrames {}` recites the whole study, in order, and nothing past it.
    /// `docs/disk-access/IMPLEMENTATION.md`.
    #[test]
    fn empty_stream_frames_is_the_whole_study() {
        let frames = 4u32;
        wire_test(frames, |mut control, mut media| async move {
            control
                .write_all(
                    &fod::encode_fod_msg(&FodMsg::StreamFrames {
                        from: None,
                        to: None,
                    })
                    .unwrap(),
                )
                .await
                .expect("ask");
            for want in 0..frames {
                let (idx, codestream) =
                    tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                        .await
                        .expect("frame never arrived");
                assert_eq!(idx, want, "frames arrived out of fill order");
                assert_eq!(codestream, pattern(want), "frame {want} came back wrong");
            }
            let extra =
                tokio::time::timeout(Duration::from_millis(200), read_envelope(&mut media)).await;
            assert!(extra.is_err(), "fill sent a frame past the study");
        });
    }

    /// `EndStream` after the fill has started stops it before the study ends.
    /// Does not pin the last frame delivered — QUIC may already hold one. §13.4.
    #[test]
    fn end_stream_stops_a_fill_on_the_wire() {
        let frames = 64u32;
        wire_test(frames, |mut control, mut media| async move {
            control
                .write_all(
                    &fod::encode_fod_msg(&FodMsg::StreamFrames {
                        from: None,
                        to: None,
                    })
                    .unwrap(),
                )
                .await
                .expect("ask");
            tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                .await
                .expect("at least one frame arrived");
            control
                .write_all(&fod::encode_fod_msg(&FodMsg::EndStream).unwrap())
                .await
                .expect("end");
            let mut got = 1u32;
            while tokio::time::timeout(Duration::from_millis(400), read_envelope(&mut media))
                .await
                .is_ok()
            {
                got += 1;
            }
            assert!(
                got < frames,
                "EndStream let the fill run to the end ({got}/{frames})"
            );
        });
    }

    /// A data request during a fill ends the fill and is then served.
    #[test]
    fn request_frame_during_fill_switches_to_on_demand() {
        wire_test(6, |mut control, mut media| async move {
            let mut bytes = fod::encode_fod_msg(&FodMsg::StreamFrames {
                from: None,
                to: None,
            })
            .unwrap();
            bytes.extend(fod::encode_fod_msg(&FodMsg::RequestFrame { frame: 5 }).unwrap());
            control.write_all(&bytes).await.expect("fill+switch");

            let (first, _) =
                tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                    .await
                    .expect("a frame");
            assert!(
                first == 0 || first == 5,
                "first frame after a switch should be the fill head or the ask, not {first}"
            );
            if first == 0 {
                let (second, body) =
                    tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                        .await
                        .expect("on-demand frame");
                assert_eq!(second, 5, "fill kept reciting after the mode switch");
                assert_eq!(body, pattern(5));
            } else {
                assert_eq!(first, 5);
            }
        });
    }
}
