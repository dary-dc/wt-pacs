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
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
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
    /// Lab only: serve every frame as a miss, so a cold study can be measured without
    /// relying on page-cache eviction. `docs/disk-access/EVIDENCE.md`.
    pub force_pool_reads: bool,
    /// Prototype, off by default: honour `?ask=` in the session URL, so the first frame moves
    /// behind the accept instead of behind the control stream. `docs/proposal-session-open.md`.
    pub open_ask: bool,
}

pub async fn run_server(config: ServeConfig) -> Result<()> {
    let identity = Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
        .await
        .with_context(|| format!("load TLS identity from {}", config.cert_pem.display()))?;
    let cert_sha256 = cert_sha256_hex(&identity)?;

    let (endpoint, bound) = build_endpoint(&config).await?;

    let mut store = FrameStore::open(&config.study_path).context("open study")?;
    if config.force_pool_reads {
        warn!("--force-pool-reads: every read reports a miss; this is a lab flag, not a deployment one");
        store.force_pool_reads();
    }
    let store = Arc::new(store);

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
    let open_ask = config.open_ask;
    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if let Err(err) = handle_incoming(incoming, store, mode, open_ask).await {
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
    mode: StreamMode,
    open_ask: bool,
) -> Result<()> {
    let session_request = incoming.await.context("incoming session")?;
    // Read before accepting: the whole point of an opening ask is to serve behind the accept
    // rather than behind the client's control stream. `docs/proposal-session-open.md`.
    let opening = open_ask.then(|| parse_open_ask(session_request.path(), store.frame_count()));
    let connection = session_request.accept().await.context("accept session")?;

    #[cfg(feature = "telemetry")]
    tokio::spawn(crate::record::path::run(connection.clone()));

    if let Some(Some(ask)) = opening {
        return serve_opening_ask(connection, store, mode, ask).await;
    }

    let (control_send, control_recv) = connection
        .accept_bi()
        .await
        .context("accept control bidi")?;

    let path = connection.clone();
    let out = FrameOut::open(mode, connection).await?;
    let mut product = ProductPipeline::new(store, out).with_control(control_send);

    #[cfg(feature = "telemetry")]
    let result = match Tap::for_session() {
        Some(tap) => run_session(&mut RecordedPipeline::new(product, tap), control_recv).await,
        None => run_session(&mut product, control_recv).await,
    };
    #[cfg(not(feature = "telemetry"))]
    let result = run_session(&mut product, control_recv).await;

    report_path(&path);
    result
}

/// `?ask=frame:N` or `?ask=fill:A-B`. `None` for absent, malformed, or out of range — the
/// session then proceeds as today and the client's own ask gets the normal refusal.
fn parse_open_ask(path: &str, frames: u32) -> Option<Ask> {
    let value = path
        .split_once('?')?
        .1
        .split('&')
        .find_map(|f| f.strip_prefix("ask="))?;
    let ask = match value.split_once(':')? {
        ("frame", n) => Ask::Frame(n.parse().ok()?),
        ("fill", range) => {
            let (from, to) = range.split_once('-')?;
            Ask::Fill { from: from.parse().ok(), to: to.parse().ok() }
        }
        _ => return None,
    };
    match ask {
        Ask::Frame(n) if n >= frames => None,
        Ask::Fill { to: Some(to), .. } if to >= frames => None,
        ask => Some(ask),
    }
}

/// Lab path: serve the opening ask immediately, and take the control stream whenever it turns
/// up. A refusal waits for it, since that is the only way one can be sent.
async fn serve_opening_ask(
    connection: wtransport::Connection,
    store: Arc<FrameStore>,
    mode: StreamMode,
    ask: Ask,
) -> Result<()> {
    let path = connection.clone();
    let control = connection.clone();
    let out = FrameOut::open(mode, connection).await?;
    let (ctl_tx, ctl_rx) = oneshot::channel();
    let mut product = ProductPipeline::new(store, out).with_late_control(ctl_rx);

    let (tx, mut asks) = mpsc::channel(ASKS_AHEAD);
    tx.send(ask).await.ok();
    let reader = tokio::spawn(async move {
        let Ok((send, mut recv)) = control.accept_bi().await else { return };
        ctl_tx.send(send).ok();
        while read_asks(&mut recv, &tx).await.is_ok() {}
    });

    let result = drive(&mut product, &mut asks).await;
    reader.abort();
    let _ = reader.await;
    report_path(&path);
    result
}

/// Once per session, so a deployment can see the MTU, loss and RTT it actually got.
fn report_path(connection: &wtransport::Connection) {
    let s = connection.quic_connection().stats();
    info!(
        mtu = s.path.current_mtu,
        rtt_us = s.path.rtt.as_micros() as u64,
        cwnd = s.path.cwnd,
        sent = s.path.sent_packets,
        lost = s.path.lost_packets,
        congestion_events = s.path.congestion_events,
        datagrams_tx = s.udp_tx.datagrams,
        "session path"
    );
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
    use crate::transport::wire::write_fod_msg;
    use fod::FodMsg;
    use frame_envelope::unwrap;
    use std::io::Write;
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

    /// The ask in the session URL is served without the client ever writing to the control
    /// stream, an out-of-range one is ignored rather than taken, and a refusal in such a session
    /// waits for the control stream instead of being dropped. R1 —
    /// `docs/proposal-session-open.md`.
    #[test]
    fn an_opening_ask_is_served_behind_the_accept() {
        for (query, want) in [("?ask=frame:3", Some(3u32)), ("?ask=frame:99", None)] {
            let frames = 6u32;
            let dir = std::env::temp_dir()
                .join(format!("wtpacs-open-{}-{}", std::process::id(), want.unwrap_or(99)));
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
                let server = tokio::spawn(run_server(ServeConfig {
                    wt_port: port,
                    study_path: study,
                    cert_pem,
                    key_pem,
                    mode: StreamMode::Shared,
                    bind: Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
                    tuning: TransportTuning::default(),
                    force_pool_reads: false,
                    open_ask: true,
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
                let url = format!("https://127.0.0.1:{port}/{query}");
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

                // No control stream is opened: the frame must arrive on the URL ask alone.
                let media = tokio::time::timeout(
                    Duration::from_secs(5),
                    connection.accept_uni(),
                )
                .await;
                match want {
                    Some(frame) => {
                        let mut media = media.expect("no media uni").expect("accept media uni");
                        let (idx, codestream) = read_envelope(&mut media).await;
                        assert_eq!(idx, frame, "the URL ask served the wrong frame");
                        assert_eq!(codestream, pattern(frame), "frame {frame} came back wrong");

                        let (mut send, mut recv) =
                            connection.open_bi().await.expect("open control").await.expect("control");
                        write_fod_msg(&mut send, &FodMsg::RequestFrame { frame: 99 })
                            .await
                            .expect("ask out of range");
                        let refusal = tokio::time::timeout(
                            Duration::from_secs(5),
                            read_fod_msg(&mut recv),
                        )
                        .await
                        .expect("no refusal on the control stream")
                        .expect("refusal");
                        assert!(
                            matches!(refusal, FodMsg::FrameError { frame_index: 99, .. }),
                            "the refusal was {refusal:?}, not a frame_error for 99",
                        );
                    }
                    None => assert!(
                        media.is_err(),
                        "an out-of-range opening ask opened a media stream",
                    ),
                }
                server.abort();
            });
            std::fs::remove_dir_all(&dir).ok();
        }
    }

    /// The server's SETTINGS leave with its handshake flight: a client that loses everything it
    /// sends after its first flight — so the server's handshake can never complete — still
    /// receives the HTTP/3 control stream, opening with SETTINGS. Without
    /// `patches/wtransport-0.7.2-settings-early.patch` it never does.
    /// `docs/proposal-session-open.md` §Lever 2.
    #[test]
    fn settings_ride_the_handshake_flight() {
        let dir = std::env::temp_dir().join(format!("wtpacs-settings-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let study = write_study(&dir, 1);
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
                tuning: TransportTuning::default(),
                force_pool_reads: false,
                open_ask: false,
            }));
            while std::net::UdpSocket::bind(("127.0.0.1", port)).is_ok() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }

            let front = tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay");
            let relay = front.local_addr().expect("relay addr");
            let back = tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay");
            back.connect(("127.0.0.1", port)).await.expect("relay upstream");
            tokio::spawn(async move {
                let (mut up, mut down) = (vec![0u8; 65536], vec![0u8; 65536]);
                let (mut client, mut answered) = (None, false);
                loop {
                    tokio::select! {
                        Ok((n, from)) = front.recv_from(&mut up) => {
                            client = Some(from);
                            if !answered {
                                back.send(&up[..n]).await.ok();
                            }
                        }
                        Ok(n) = back.recv(&mut down) => {
                            answered = true;
                            if let Some(to) = client {
                                front.send_to(&down[..n], to).await.ok();
                            }
                        }
                    }
                }
            });

            let config = ClientConfig::builder()
                .with_bind_config(IpBindConfig::InAddrAnyV4)
                .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
                .build();
            let mut endpoint = wtransport::quinn::Endpoint::client("127.0.0.1:0".parse().unwrap())
                .expect("quinn client");
            endpoint.set_default_client_config(config.quic_config().clone());
            let connection = endpoint
                .connect(relay, "localhost")
                .expect("connect")
                .await
                .expect("client side of the handshake");
            let mut control =
                tokio::time::timeout(Duration::from_secs(3), connection.accept_uni())
                    .await
                    .expect("no server stream before the server's handshake completed")
                    .expect("accept uni");
            let mut head = [0u8; 2];
            control.read_exact(&mut head).await.expect("control stream head");
            assert_eq!(head, [0x00, 0x04], "not a control stream opening with SETTINGS");
            server.abort();
        });
        std::fs::remove_dir_all(&dir).ok();
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
            force_pool_reads: false,
            open_ask: false,
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
        let (control, _control_recv) = connection
            .open_bi()
            .await
            .expect("open bi")
            .await
            .expect("bi ready");
        let media = connection.accept_uni().await.expect("accept media uni");
        (server, connection, control, media)
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
}
