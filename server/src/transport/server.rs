//! FoD ask → envelope on a server uni stream. No server-side ask queue —
//! `docs/adr-reject-server-ordering.md`. Per-frame work is [`pipeline::FramePipeline`].

use crate::media::frame_store::FrameStore;
use crate::transport::frame_out::FrameOut;
use crate::transport::pipeline::{FramePipeline, ProductPipeline};
use crate::transport::planner::{Ask, Planner, Step, ASKS_AHEAD};
use crate::transport::stream_mode::StreamMode;
use crate::transport::tuning::TransportTuning;
use crate::transport::websocket;
use crate::transport::wire::{read_fod_msg, Control};
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
    /// relying on page-cache eviction. `docs/disk-access/adr.md`.
    pub force_pool_reads: bool,
    /// Prototype, off by default: honour `?ask=` in the session URL, so the first frame moves
    /// behind the accept instead of behind the control stream. `docs/ARCHITECTURE.md`.
    pub open_ask: bool,
    /// Lab only: every session request is taken and never answered — WebKit bug 319879's dial
    /// that never settles, made on purpose. `docs/ARCHITECTURE.md` §A dial that never settles.
    pub hold_sessions: bool,
    /// Off by default: also serve the same envelopes over a WebSocket, TCP on `wt_port`.
    /// `docs/WIRE.md` §The WebSocket mapping.
    pub websocket: bool,
}

pub async fn run_server(config: ServeConfig) -> Result<()> {
    let identity = Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
        .await
        .with_context(|| format!("load TLS identity from {}", config.cert_pem.display()))?;
    let cert_sha256 = cert_sha256_hex(&identity)?;

    let (endpoint, bound) = build_endpoint(&config).await?;
    let websocket = if config.websocket {
        Some(websocket::bind(config.bind, config.wt_port, &config.cert_pem, &config.key_pem).await?)
    } else {
        None
    };

    let mut store = FrameStore::open(&config.study_path).context("open study")?;
    if config.force_pool_reads {
        warn!("--force-pool-reads: every read reports a miss; this is a lab flag, not a deployment one");
        store.force_pool_reads();
    }
    let store = Arc::new(store);

    #[cfg(feature = "telemetry")]
    crate::record::set_run_meta(crate::record::RunMeta {
        stream_mode: config.mode.to_string(),
        study: config.study_path.display().to_string(),
        study_frames: store.frame_count(),
    });

    let wt_url = format!("https://127.0.0.1:{}/", config.wt_port);
    println!("wt_url={wt_url}");
    if websocket.is_some() {
        println!("ws_url=wss://127.0.0.1:{}/", config.wt_port);
    }
    println!("cert_sha256={cert_sha256}");
    println!("study={}", config.study_path.display());
    println!("frames={}", store.frame_count());
    println!("read_fast_path={}", read_fast_path(&store));
    println!("completion=media_uni_stream");
    println!("stream_mode={}", config.mode);
    println!("bind={bound}");
    println!("transport={}", config.tuning.describe());
    #[cfg(feature = "telemetry")]
    println!("telemetry=compile-time");
    #[cfg(not(feature = "telemetry"))]
    println!("telemetry=absent");
    info!(
        %wt_url,
        study = %config.study_path.display(),
        stream_mode = %config.mode,
        "exact-server ready (Media-complete)"
    );

    if let Some((listener, tls)) = websocket {
        tokio::spawn(websocket::serve(listener, tls, Arc::clone(&store)));
    }
    let mode = config.mode;
    let open_ask = config.open_ask;
    let hold = config.hold_sessions;
    loop {
        let incoming = endpoint.accept().await;
        let store = Arc::clone(&store);
        tokio::spawn(async move {
            if hold {
                return hold_session(incoming).await;
            }
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
/// `docs/disk-access/adr.md`.
fn read_fast_path(store: &FrameStore) -> &'static str {
    if store.nowait_supported() {
        return "preadv2";
    }
    warn!(
        "RWF_NOWAIT is refused here (overlayfs or tmpfs?); every frame costs a blocking-pool \
         round trip. See docs/disk-access/adr.md"
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

async fn hold_session(incoming: wtransport::endpoint::IncomingSession) {
    if let Ok(_unanswered) = incoming.await {
        std::future::pending::<()>().await;
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
    // rather than behind the client's control stream. `docs/ARCHITECTURE.md`.
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
    let mut product = ProductPipeline::new(store, out).with_control(Control::Stream(control_send));

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
        sendmsg = s.udp_tx.ios,
        // Non-zero only where the peer advertised `min_ack_delay` (T7).
        ack_frequency = s.frame_tx.ack_frequency,
        "session path"
    );
}

/// The reader owns the control stream; the planner decides; the pipeline serves.
/// `docs/disk-access/adr.md`.
async fn run_session<P: FramePipeline>(pipeline: &mut P, control_recv: RecvStream) -> Result<()> {
    let (reader, mut asks) = spawn_ask_reader(control_recv);
    let result = drive(pipeline, &mut asks).await;
    reader.abort();
    let _ = reader.await;
    result
}

/// The loop over `Ask`, with no stream in it, so a test can drive it without QUIC.
pub(super) async fn drive<P: FramePipeline>(pipeline: &mut P, asks: &mut mpsc::Receiver<Ask>) -> Result<()> {
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
    forward(read_fod_msg(control_recv).await, tx).await
}

/// One FoD message as the loop's asks; `Err` once the reader should stop.
pub(super) async fn forward(msg: Result<FodMsg>, tx: &mpsc::Sender<Ask>) -> Result<(), ()> {
    let ask = match msg {
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
    /// `pipeline.rs`'s. `docs/disk-access/adr.md`.
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
    /// `docs/ARCHITECTURE.md`.
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
                    hold_sessions: false,
                    websocket: false,
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

    /// With `hold_sessions` the client's dial neither completes nor fails: the handshake is done,
    /// the CONNECT is taken, and nothing answers it — the dial a client needs its own deadline
    /// for. `docs/ARCHITECTURE.md` §A dial that never settles.
    #[test]
    fn a_held_dial_neither_connects_nor_fails() {
        let dir = std::env::temp_dir().join(format!("wtpacs-hold-{}", std::process::id()));
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
                hold_sessions: true,
                websocket: false,
            }));
            let endpoint = wtransport::Endpoint::client(
                ClientConfig::builder()
                    .with_bind_config(IpBindConfig::InAddrAnyV4)
                    .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
                    .build(),
            )
            .expect("client endpoint");
            let url = format!("https://127.0.0.1:{port}/");
            // A dial that errors is a server not listening yet; one that hangs is the hold.
            let mut held = false;
            for _ in 0..50 {
                match tokio::time::timeout(Duration::from_secs(2), endpoint.connect(url.clone())).await {
                    Ok(Ok(_)) => panic!("a held session request was answered"),
                    Ok(Err(_)) => tokio::time::sleep(Duration::from_millis(100)).await,
                    Err(_) => {
                        held = true;
                        break;
                    }
                }
            }
            assert!(held, "the server never took the dial");
            server.abort();
        });
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The server's SETTINGS leave with its handshake flight: a client that loses everything it
    /// sends after its first flight — so the server's handshake can never complete — still
    /// receives the HTTP/3 control stream, opening with SETTINGS. Without
    /// `patches/wtransport-0.7.2-settings-early.patch` it never does.
    /// `docs/ARCHITECTURE.md` §Lever 2.
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
                hold_sessions: false,
                websocket: false,
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

    /// A server whose whole first flight is lost probes every space it sent in, so its handshake
    /// flight rides the ServerHello's probe and its 0.5-RTT SETTINGS reach the client one round
    /// trip after the client's handshake completes — when an unpatched server's would. Without
    /// `patches/quinn-proto-0.11.18-probe-every-space.patch` they wait for the ACK of
    /// HANDSHAKE_DONE to be declared lost: two round trips. `docs/ARCHITECTURE.md` §What lever 2 costs.
    #[test]
    fn a_lost_first_flight_is_repeated_whole() {
        const ONE_WAY: Duration = Duration::from_millis(50);
        let dir = std::env::temp_dir().join(format!("wtpacs-first-flight-{}", std::process::id()));
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
                hold_sessions: false,
                websocket: false,
            }));
            while std::net::UdpSocket::bind(("127.0.0.1", port)).is_ok() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }

            // Every datagram is delayed ONE_WAY; the server's burst in the first ONE_WAY after its
            // first datagram — its first flight — is dropped.
            let front = Arc::new(tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay"));
            let relay = front.local_addr().expect("relay addr");
            let back = Arc::new(tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay"));
            back.connect(("127.0.0.1", port)).await.expect("relay upstream");
            let swallowed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let dropped = swallowed.clone();
            tokio::spawn(async move {
                let (mut up, mut down) = (vec![0u8; 65536], vec![0u8; 65536]);
                let mut client = None;
                let mut first_answer: Option<tokio::time::Instant> = None;
                loop {
                    tokio::select! {
                        Ok((n, from)) = front.recv_from(&mut up) => {
                            client = Some(from);
                            let (back, d) = (back.clone(), up[..n].to_vec());
                            tokio::spawn(async move {
                                tokio::time::sleep(ONE_WAY).await;
                                back.send(&d).await.ok();
                            });
                        }
                        Ok(n) = back.recv(&mut down) => {
                            let now = tokio::time::Instant::now();
                            if now - *first_answer.get_or_insert(now) < ONE_WAY {
                                dropped.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                continue;
                            }
                            let (front, d, to) = (front.clone(), down[..n].to_vec(), client);
                            tokio::spawn(async move {
                                tokio::time::sleep(ONE_WAY).await;
                                if let Some(to) = to {
                                    front.send_to(&d, to).await.ok();
                                }
                            });
                        }
                    }
                }
            });

            let config = ClientConfig::builder()
                .with_bind_config(IpBindConfig::InAddrAnyV4)
                .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
                .build();
            // The client's own Initial retransmit would land beside the server's probe, both ~1 s;
            // racing them is not this test's claim, so the client waits 3 s before it repeats.
            let mut quic = config.quic_config().clone();
            let mut transport = wtransport::quinn::TransportConfig::default();
            transport.initial_rtt(Duration::from_secs(1));
            quic.transport_config(Arc::new(transport));
            let mut endpoint = wtransport::quinn::Endpoint::client("127.0.0.1:0".parse().unwrap())
                .expect("quinn client");
            endpoint.set_default_client_config(quic);
            let connection = endpoint
                .connect(relay, "localhost")
                .expect("connect")
                .await
                .expect("client side of the handshake");
            let handshake_done = std::time::Instant::now();
            let _control = tokio::time::timeout(Duration::from_secs(5), connection.accept_uni())
                .await
                .expect("no control stream in 5 s")
                .expect("accept uni");
            let late = handshake_done.elapsed();
            assert!(
                swallowed.load(std::sync::atomic::Ordering::Relaxed) > 0,
                "the relay dropped nothing: the test did not lose the first flight"
            );
            assert!(
                late < ONE_WAY * 3,
                "the control stream came {late:?} after the handshake: the lost SETTINGS waited on HANDSHAKE_DONE"
            );
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
        mode: StreamMode,
    ) -> (tokio::task::JoinHandle<Result<()>>, wtransport::Connection, SendStream) {
        let server = tokio::spawn(run_server(ServeConfig {
            wt_port: port,
            study_path: study,
            cert_pem,
            key_pem,
            mode,
            bind: Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
            tuning: TransportTuning::default(),
            force_pool_reads: false,
            open_ask: false,
            hold_sessions: false,
            websocket: false,
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
        (server, connection, control)
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
            let (server, conn, control) =
                connect_session(study, cert_pem, key_pem, cert_hash, port, StreamMode::Shared).await;
            let media = conn.accept_uni().await.expect("accept media uni");
            body(control, media).await;
            server.abort();
        });
        std::fs::remove_dir_all(&dir).ok();
    }

    /// **`pool:k` over the wire.** Frames are dealt round-robin: each of the `k` streams carries
    /// the frames of one residue mod `k`, whole and in ask order. `docs/adr-stream-shape.md`.
    #[test]
    fn a_pool_deals_frames_round_robin_over_its_streams() {
        let (frames, k) = (7u32, 3u32);
        let dir = std::env::temp_dir().join(format!("wtpacs-pool-{}", std::process::id()));
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
            let mode = StreamMode::Pool(std::num::NonZeroUsize::new(k as usize).unwrap());
            let (server, conn, mut control) =
                connect_session(study, cert_pem, key_pem, cert_hash, port, mode).await;
            control
                .write_all(&fod::encode_fod_msg(&FodMsg::RequestFrames { frames: (0..frames).collect() }).unwrap())
                .await
                .expect("ask");
            let mut residues = Vec::new();
            for _ in 0..k {
                let mut uni = tokio::time::timeout(Duration::from_secs(10), conn.accept_uni())
                    .await
                    .expect("a pool stream never opened")
                    .expect("accept uni");
                let mut want = None;
                loop {
                    let Ok((idx, codestream)) =
                        tokio::time::timeout(Duration::from_millis(500), read_envelope(&mut uni)).await
                    else {
                        break;
                    };
                    let next = *want.get_or_insert(idx % k);
                    assert_eq!(idx, next, "a pool stream carried frame {idx} where {next} was due");
                    assert_eq!(codestream, pattern(idx), "frame {idx} came back wrong");
                    want = Some(next + k);
                }
                residues.push(want.map(|w| w % k));
            }
            residues.sort();
            assert_eq!(residues, vec![Some(0), Some(1), Some(2)], "the streams did not share the frames");
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
    /// `docs/disk-access/adr.md`.
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

    /// **The WebSocket path.** Binary messages, joined, are the shared uni stream's bytes — each
    /// frame whole, in fill order, its codestream split across messages so a client sees it move —
    /// and a refusal comes back as a text message holding FoD's JSON. `docs/ARCHITECTURE.md`.
    #[test]
    fn a_websocket_carries_the_same_envelopes_and_refusals() {
        use futures_util::{SinkExt, StreamExt};
        use rustls::pki_types::pem::PemObject;
        use tokio_tungstenite::tungstenite::Message;

        let frames = 3u32;
        let dir = std::env::temp_dir().join(format!("wtpacs-ws-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let study = write_study(&dir, frames);
        let (cert_pem, key_pem, _) = write_dev_cert(&dir);
        let cert = std::fs::read(&cert_pem).expect("cert");
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
                hold_sessions: false,
                websocket: true,
            }));
            let mut roots = rustls::RootCertStore::empty();
            for der in rustls::pki_types::CertificateDer::pem_slice_iter(&cert) {
                roots.add(der.expect("pem")).expect("trust the test cert");
            }
            let tls = tokio_rustls::TlsConnector::from(Arc::new(
                rustls::ClientConfig::builder()
                    .with_root_certificates(roots)
                    .with_no_client_auth(),
            ));
            let mut tcp = None;
            for _ in 0..50 {
                match tokio::net::TcpStream::connect(("127.0.0.1", port)).await {
                    Ok(t) => {
                        tcp = Some(t);
                        break;
                    }
                    Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
                }
            }
            let tcp = tcp.expect("the WebSocket listener never came up");
            let name = rustls::pki_types::ServerName::try_from("localhost").unwrap();
            let tls = tls.connect(name, tcp).await.expect("TLS with the QUIC certificate");
            let (mut ws, _) = tokio_tungstenite::client_async(format!("wss://localhost:{port}/"), tls)
                .await
                .expect("WebSocket upgrade");

            let ask = |msg: FodMsg| Message::text(serde_json::to_string(&msg).unwrap());
            ws.send(ask(FodMsg::StreamFrames { from: Some(0), to: Some(frames - 1) }))
                .await
                .expect("fill");
            let (mut wire, mut messages) = (Vec::new(), 0);
            let want: usize = (0..frames).map(|f| 8 + pattern(f).len()).sum();
            while wire.len() < want {
                let msg = tokio::time::timeout(Duration::from_secs(10), ws.next())
                    .await
                    .expect("the fill stalled")
                    .expect("socket ended")
                    .expect("read");
                let Message::Binary(bytes) = msg else { panic!("a fill frame came as {msg:?}") };
                wire.extend_from_slice(&bytes);
                messages += 1;
            }
            let mut at = 0;
            for f in 0..frames {
                let len = u32::from_be_bytes(wire[at..at + 4].try_into().unwrap()) as usize;
                let (idx, codestream) = unwrap(&wire[at + 4..at + 4 + len]).expect("envelope");
                assert_eq!(idx, f, "frames arrived out of fill order");
                assert_eq!(codestream, &pattern(f)[..], "frame {f} came back wrong");
                at += 4 + len;
            }
            assert!(
                messages > 2 * frames as usize,
                "{messages} messages for {frames} frames: a codestream was not split"
            );

            ws.send(ask(FodMsg::RequestFrame { frame: 99 })).await.expect("ask out of range");
            let refusal = tokio::time::timeout(Duration::from_secs(5), ws.next())
                .await
                .expect("no refusal")
                .expect("socket ended")
                .expect("read");
            let Message::Text(json) = refusal else { panic!("the refusal came as {refusal:?}") };
            assert!(
                matches!(fod::decode_fod_body(json.as_bytes()), Ok(FodMsg::FrameError { frame_index: 99, .. })),
                "the refusal was {json}, not a frame_error for 99"
            );
            server.abort();
        });
        std::fs::remove_dir_all(&dir).ok();
    }
}
