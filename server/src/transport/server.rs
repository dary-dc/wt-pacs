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
use fod::FodMsg;
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{info, warn};
use wtransport::config::{states, ServerConfigBuilder};
use wtransport::stream::RecvStream;
use wtransport::{Endpoint, Identity, ServerConfig};

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use crate::transport::pipeline::RecordedPipeline;

#[derive(Clone)]
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
    /// Endpoints on the port, one per thread. `0` is one per core.
    pub workers: usize,
}

/// One endpoint per worker, each on its own thread and single-threaded runtime, so a
/// session's packets, driver and serving loop never change thread. Resolves only when a
/// worker fails. `docs/transport/why-these-changes.md` §8.
pub async fn serve(config: ServeConfig) -> Result<()> {
    let workers = match config.workers {
        0 => std::thread::available_parallelism().map_or(1, |n| n.get()),
        n => n,
    };
    let (store, identity, sockets) = prepare(&config, workers).await?;
    let (tx, mut rx) = mpsc::unbounded_channel();
    for (i, socket) in sockets.into_iter().enumerate() {
        let (config, store, identity, tx) = (
            config.clone(),
            Arc::clone(&store),
            identity.clone_identity(),
            tx.clone(),
        );
        std::thread::Builder::new()
            .name(format!("wt-endpoint-{i}"))
            .spawn(move || {
                let result = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(anyhow::Error::from)
                    .and_then(|rt| rt.block_on(run_endpoint(&config, store, identity, socket)));
                let _ = tx.send(result.with_context(|| format!("endpoint {i}")));
            })
            .with_context(|| format!("spawn endpoint thread {i}"))?;
    }
    drop(tx);
    rx.recv()
        .await
        .unwrap_or_else(|| Err(anyhow!("every endpoint thread ended")))
}

/// One endpoint on the current runtime — what a test drives.
pub async fn run_server(config: ServeConfig) -> Result<()> {
    let (store, identity, mut sockets) = prepare(&config, 1).await?;
    let socket = sockets.pop().context("one socket")?;
    run_endpoint(&config, store, identity, socket).await
}

/// Binds every socket before the banner, so `wt_url=` means the port answers.
async fn prepare(
    config: &ServeConfig,
    workers: usize,
) -> Result<(Arc<FrameStore>, Identity, Vec<UdpSocket>)> {
    let identity = Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
        .await
        .with_context(|| format!("load TLS identity from {}", config.cert_pem.display()))?;
    let cert_sha256 = cert_sha256_hex(&identity)?;
    let (sockets, bound) = bind_sockets(config, workers)?;
    let store = Arc::new(FrameStore::open(&config.study_path).context("open study")?);

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
    println!("workers={workers}");
    println!("transport={}", config.tuning.describe());
    #[cfg(feature = "telemetry")]
    println!("telemetry=compile-time");
    #[cfg(not(feature = "telemetry"))]
    println!("telemetry=absent");
    info!(
        %wt_url,
        study = %config.study_path.display(),
        stream_mode = config.mode.as_str(),
        workers,
        "exact-server ready (Media-complete)"
    );
    Ok((store, identity, sockets))
}

async fn run_endpoint(
    config: &ServeConfig,
    store: Arc<FrameStore>,
    identity: Identity,
    socket: UdpSocket,
) -> Result<()> {
    let server_config = finish(
        ServerConfig::builder().with_bind_socket(socket),
        identity,
        &config.tuning,
    )?;
    let endpoint = Endpoint::server(server_config).context("wtransport endpoint")?;
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
/// More than one socket shares the port through `SO_REUSEPORT`; one keeps the port exclusive.
fn bind_sockets(config: &ServeConfig, n: usize) -> Result<(Vec<UdpSocket>, String)> {
    let reuse_port = n > 1;
    let port = config.wt_port;
    let (first, addr, label) = match config.bind {
        Some(ip) => {
            let addr = SocketAddr::new(ip, port);
            let socket =
                bind_socket(addr, reuse_port).with_context(|| format!("bind {ip}:{port}"))?;
            (socket, addr, ip.to_string())
        }
        None => {
            let dual = SocketAddr::new(Ipv6Addr::UNSPECIFIED.into(), port);
            match bind_socket(dual, reuse_port) {
                Ok(socket) => (socket, dual, "[::] dual-stack".to_string()),
                Err(err) => {
                    warn!(%err, "dual-stack bind failed; falling back to IPv4 any");
                    let v4 = SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), port);
                    let socket = bind_socket(v4, reuse_port).context("bind IPv4 any")?;
                    (
                        socket,
                        v4,
                        "0.0.0.0 (IPv4 fallback: no dual-stack)".to_string(),
                    )
                }
            }
        }
    };
    let mut sockets = vec![first];
    for _ in 1..n {
        sockets.push(bind_socket(addr, reuse_port).with_context(|| format!("bind {addr}"))?);
    }
    Ok((sockets, label))
}

fn bind_socket(addr: SocketAddr, reuse_port: bool) -> std::io::Result<UdpSocket> {
    let domain = if addr.is_ipv6() {
        Domain::IPV6
    } else {
        Domain::IPV4
    };
    let socket = Socket::new(domain, Type::DGRAM, Some(Protocol::UDP))?;
    if addr.is_ipv6() {
        socket.set_only_v6(false)?;
    }
    if reuse_port {
        socket.set_reuse_port(true)?;
    }
    socket.bind(&addr.into())?;
    Ok(socket.into())
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

async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    store: Arc<FrameStore>,
    mode: StreamMode,
) -> Result<()> {
    let session_request = incoming.await.context("incoming session")?;
    let connection = session_request.accept().await.context("accept session")?;

    #[cfg(feature = "telemetry")]
    tokio::spawn(crate::record::path::run(connection.clone()));

    let (control_send, control_recv) = connection
        .accept_bi()
        .await
        .context("accept control bidi")?;

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
        Ok(FodMsg::FrameError { .. }) => return Ok(()),
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
    use fod::FodMsg;
    use frame_envelope::unwrap;
    use std::io::Write;
    use wtransport::config::IpBindConfig;
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
    ) {
        let server = tokio::spawn(run_server(ServeConfig {
            wt_port: port,
            study_path: study,
            cert_pem,
            key_pem,
            mode: StreamMode::Shared,
            bind: Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
            tuning: TransportTuning::default(),
            workers: 1,
        }));
        let (connection, control, media) = connect_client(port, cert_hash).await;
        (server, connection, control, media)
    }

    async fn connect_client(
        port: u16,
        cert_hash: [u8; 32],
    ) -> (wtransport::Connection, SendStream, RecvStream) {
        let endpoint = wtransport::Endpoint::client(
            ClientConfig::builder()
                .with_bind_config(IpBindConfig::InAddrAnyV4)
                .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
                .build(),
        )
        .expect("client endpoint");
        let url = format!("https://127.0.0.1:{port}/");
        let mut connection = None;
        // Bounded per attempt: a port nobody answers on would otherwise wait out a handshake.
        for _ in 0..50 {
            match tokio::time::timeout(Duration::from_secs(2), endpoint.connect(url.clone())).await
            {
                Ok(Ok(c)) => {
                    connection = Some(c);
                    break;
                }
                _ => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
        let connection = connection.expect("server never accepted a connection");
        let (control, _control_recv) = connection
            .open_bi()
            .await
            .expect("open bi")
            .await
            .expect("bi ready");
        let media = connection.accept_uni().await.expect("accept media uni");
        (connection, control, media)
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
            let (server, _conn, control, media) =
                connect_session(study, cert_pem, key_pem, cert_hash, port).await;
            body(control, media).await;
            server.abort();
        });
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

    fn loopback(port: u16, workers: usize) -> ServeConfig {
        ServeConfig {
            wt_port: port,
            study_path: PathBuf::new(),
            cert_pem: PathBuf::new(),
            key_pem: PathBuf::new(),
            mode: StreamMode::Shared,
            bind: Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
            tuning: TransportTuning::default(),
            workers,
        }
    }

    /// `n` sockets share one port only when there are several: a single endpoint still
    /// keeps its port exclusive, so a second server on it is refused as before.
    #[test]
    fn several_sockets_share_the_port_and_one_keeps_it() {
        let port = free_port();
        let (sockets, _) = bind_sockets(&loopback(port, 3), 3).expect("three sockets");
        assert_eq!(sockets.len(), 3);
        for socket in &sockets {
            assert_eq!(socket.local_addr().expect("addr").port(), port);
        }
        drop(sockets);
        let (_one, _) = bind_sockets(&loopback(port, 1), 1).expect("one socket");
        assert!(
            bind_sockets(&loopback(port, 1), 1).is_err(),
            "a second server took a single endpoint's port"
        );
        assert!(
            bind_sockets(&loopback(port, 2), 2).is_err(),
            "SO_REUSEPORT joined a port a single endpoint holds"
        );
    }

    /// **Per-core endpoints serve.** `serve` with two workers answers sessions from either
    /// endpoint's own thread and single-threaded runtime — the ask reader, the read path
    /// and the blocking pool all run there. `docs/transport/why-these-changes.md` §8.
    #[test]
    fn serve_answers_sessions_on_its_endpoints() {
        let dir = std::env::temp_dir().join(format!("wtpacs-serve-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let frames = 4u32;
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
            let server = tokio::spawn(serve(ServeConfig {
                study_path: study,
                cert_pem,
                key_pem,
                ..loopback(port, 2)
            }));
            for want in 0..frames {
                let (_connection, mut control, mut media) = connect_client(port, cert_hash).await;
                control
                    .write_all(&fod::encode_fod_msg(&FodMsg::RequestFrame { frame: want }).unwrap())
                    .await
                    .expect("ask");
                let (idx, codestream) =
                    tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                        .await
                        .expect("frame never arrived");
                assert_eq!((idx, codestream), (want, pattern(want)), "session {want}");
            }
            assert!(
                !server.is_finished(),
                "serve returned while its endpoints were serving"
            );
            server.abort();
        });
        std::fs::remove_dir_all(&dir).ok();
    }
}
