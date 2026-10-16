//! FoD ask → envelope on a server uni stream. No server-side ask queue —
//! `docs/adr/reject-server-ordering.md`. Per-frame work is [`pipeline::FramePipeline`].

use crate::media::frame_store::FrameStore;
use crate::media::read_path::ReadMode;
use crate::transport::link::{ControlStream, Link};
use crate::transport::pipeline::{FramePipeline, ProductPipeline};
use crate::transport::planner::{fill_range, frame_in_range, Command, Planner, Step, ASKS_AHEAD};
use crate::transport::stream_mode::StreamMode;
use crate::transport::tuning::TransportTuning;
use crate::transport::{banner, websocket};
use crate::transport::wire::read_fod_msg;
use anyhow::{Context, Result};
use fod::FodMsg;
use std::future::Future;
use std::ops::ControlFlow;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tracing::{info, warn};
use wtransport::config::IpBindConfig;
use wtransport::endpoint::endpoint_side;
use wtransport::stream::RecvStream;
use wtransport::{Endpoint, Identity, ServerConfig};

#[cfg(feature = "telemetry")]
use crate::record::tap::Tap;
#[cfg(feature = "telemetry")]
use crate::transport::pipeline::RecordedPipeline;

#[derive(clap::Args)]
pub struct ServeConfig {
    #[arg(long = "port", value_name = "PORT", default_value = "4433")]
    pub wt_port: u16,
    #[arg(long = "series", value_name = "SERIES")]
    pub series_path: PathBuf,
    #[arg(long, default_value = "server/dev-cert/cert.pem")]
    pub cert_pem: PathBuf,
    #[arg(long, default_value = "server/dev-cert/key.pem")]
    pub key_pem: PathBuf,
    /// How frames reach the client: `shared` or `per-frame` (lab only: `per-frame-asks-first`).
    #[arg(long = "stream-mode", value_name = "STREAM_MODE", value_enum, default_value_t = StreamMode::Shared)]
    pub mode: StreamMode,
    /// Bind address for the QUIC endpoint. Default: dual-stack `[::]`, falling back to `0.0.0.0`
    /// when the host has no IPv6.
    #[arg(long)]
    pub bind: Option<IpAddr>,
    #[command(flatten)]
    pub tuning: TransportTuning,
    /// Lab only: serve every frame as a miss, for measuring a series nobody has read. docs/adr/disk-access.md
    #[arg(long, default_value_t = false)]
    pub force_pool_reads: bool,
    /// Honour `?ask=frame:N` / `?ask=fill:A-B` in the session URL; `--opening-ask false` turns it off. docs/ARCHITECTURE.md
    #[arg(long, default_value_t = true, num_args = 0..=1, default_missing_value = "true", action = clap::ArgAction::Set)]
    pub opening_ask: bool,
    /// Lab only: take each CONNECT and never answer it. docs/ARCHITECTURE.md §A dial that never settles
    #[arg(long, default_value_t = false)]
    pub hold_sessions: bool,
    /// Lab only: each session sends this many media bytes, then nothing, with no FIN. docs/ARCHITECTURE.md
    #[arg(long, value_name = "BYTES")]
    pub stall_after_bytes: Option<u64>,
    /// Lab only: before each frame, the send window is the congestion window plus two of the series' largest frames.
    /// docs/transport/link-conditions.md §ASKAHEAD
    #[arg(long, default_value_t = false)]
    pub send_window_follows_cwnd: bool,
    /// Also serve the same envelopes over a WebSocket, TCP on `--port`. docs/WIRE.md §The WebSocket mapping
    #[arg(long, default_value_t = false)]
    pub websocket: bool,
}

pub async fn run_server(config: ServeConfig) -> Result<()> {
    let identity = Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
        .await
        .with_context(|| format!("load TLS identity from {}", config.cert_pem.display()))?;
    let cert_sha256 = cert_sha256_hex(&identity)?;

    let (endpoint, bound) = build_endpoint(&config, &identity)?;
    let websocket = if config.websocket {
        Some(websocket::bind(config.bind, config.wt_port, &config.cert_pem, &config.key_pem).await?)
    } else {
        None
    };

    let mut store = FrameStore::open(&config.series_path).context("open series")?;
    if config.force_pool_reads {
        warn!("--force-pool-reads: every read reports a miss; this is a lab flag, not a deployment one");
        store.force_pool_reads();
    }
    let store = Arc::new(store);

    #[cfg(feature = "telemetry")]
    crate::record::set_run_meta(crate::record::RunMeta {
        stream_mode: config.mode.to_string(),
        series: config.series_path.display().to_string(),
        series_frames: store.frame_count(),
    });

    banner::print(&config, &store, &bound, &cert_sha256);
    let sessions = Sessions::new(&config, store);
    if let Some((listener, tls)) = websocket {
        tokio::spawn(websocket::serve(listener, tls, sessions.clone()));
    }
    let hold = config.hold_sessions;
    loop {
        let incoming = endpoint.accept().await;
        let sessions = sessions.clone();
        tokio::spawn(async move {
            if hold {
                return hold_session(incoming).await;
            }
            if let Err(err) = handle_incoming(incoming, sessions).await {
                warn!(err = %format_args!("{err:#}"), "session ended");
            }
        });
    }
}

/// What every session is served with, fixed at start.
#[derive(Clone)]
pub(super) struct Sessions {
    pub(super) store: Arc<FrameStore>,
    read_mode: ReadMode,
    mode: StreamMode,
    pub(super) opening_ask: bool,
    stall: Option<u64>,
    cwnd_ahead: Option<u64>,
    #[cfg(feature = "telemetry")]
    taps: Arc<dyn Fn() -> Option<Tap> + Send + Sync>,
}

impl Sessions {
    /// Warns for each lab lever that is on, so a lab flag is never mistaken for a deployment.
    fn new(config: &ServeConfig, store: Arc<FrameStore>) -> Self {
        if let Some(bytes) = config.stall_after_bytes {
            warn!(bytes, "--stall-after-bytes: every session stalls; this is a lab flag, not a deployment one");
        }
        let cwnd_ahead = config.send_window_follows_cwnd.then(|| {
            let largest = (0..store.frame_count()).map(|i| store.frame_span(i).len).max().unwrap_or(0);
            2 * u64::from(largest)
        });
        if let Some(bytes) = cwnd_ahead {
            warn!(bytes, "--send-window-follows-cwnd: the send window is cwnd + this; a lab flag, not a deployment one");
        }
        let read_mode = ReadMode::parse(std::env::var("WTPACS_READ_PATH").ok().as_deref())
            .unwrap_or_else(|err| {
                warn!("{err}; using auto");
                ReadMode::Auto
            });
        Sessions {
            store,
            read_mode,
            mode: config.mode,
            opening_ask: config.opening_ask,
            stall: config.stall_after_bytes,
            cwnd_ahead,
            #[cfg(feature = "telemetry")]
            taps: Arc::new(Tap::for_session),
        }
    }

    pub(super) fn pipeline(&self, link: Link) -> ProductPipeline {
        ProductPipeline::new(Arc::clone(&self.store), link, self.read_mode)
    }

    /// One session, whatever carries it: `opening` first, then each ask `read` forwards, until
    /// the asks end or a send fails. The reader is stopped before this returns.
    pub(super) async fn serve<F>(
        &self,
        mut product: ProductPipeline,
        opening: Option<Command>,
        read: impl FnOnce(mpsc::Sender<Command>) -> F,
    ) -> Result<()>
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let (tx, mut asks) = mpsc::channel(ASKS_AHEAD);
        if let Some(ask) = opening {
            tx.send(ask).await.ok();
        }
        let reader = tokio::spawn(read(tx));
        #[cfg(feature = "telemetry")]
        let result = match (self.taps)() {
            Some(tap) => drive(&mut RecordedPipeline::new(product, tap), &mut asks).await,
            None => drive(&mut product, &mut asks).await,
        };
        #[cfg(not(feature = "telemetry"))]
        let result = drive(&mut product, &mut asks).await;
        reader.abort();
        let _ = reader.await;
        result
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

/// Tried in order: a host without an IPv6 stack refuses the dual-stack socket, so IPv4 any follows it.
fn build_endpoint(
    config: &ServeConfig,
    identity: &Identity,
) -> Result<(Endpoint<endpoint_side::Server>, String)> {
    let port = config.wt_port;
    let binds = match config.bind {
        Some(ip) => vec![(ServerConfig::builder().with_bind_address(SocketAddr::new(ip, port)), ip.to_string())],
        None => vec![
            (ServerConfig::builder().with_bind_default(port), "[::] dual-stack".to_string()),
            (
                ServerConfig::builder().with_bind_config(IpBindConfig::InAddrAnyV4, port),
                "0.0.0.0 (IPv4 fallback: no dual-stack)".to_string(),
            ),
        ],
    };
    let mut binds = binds.into_iter().peekable();
    while let Some((bind, label)) = binds.next() {
        let server_config = bind
            .with_custom_transport(identity.clone_identity(), config.tuning.to_transport_config()?)
            .build();
        match Endpoint::server(server_config) {
            Ok(endpoint) => return Ok((endpoint, label)),
            Err(err) if binds.peek().is_some() => warn!(%err, "{label} bind failed; trying the next"),
            Err(err) => return Err(err).with_context(|| format!("wtransport endpoint on {label}, port {port}")),
        }
    }
    unreachable!("the last bind returns its own error")
}

async fn hold_session(incoming: wtransport::endpoint::IncomingSession) {
    if let Ok(_unanswered) = incoming.await {
        std::future::pending::<()>().await;
    }
}

async fn handle_incoming(
    incoming: wtransport::endpoint::IncomingSession,
    sessions: Sessions,
) -> Result<()> {
    let session_request = incoming.await.context("incoming session")?;
    // Read before accepting: the whole point of an opening ask is to serve behind the accept
    // rather than behind the client's control stream. `docs/ARCHITECTURE.md`.
    let opening = sessions
        .opening_ask
        .then(|| parse_opening_ask(session_request.path(), sessions.store.frame_count()))
        .flatten();
    let connection = session_request.accept().await.context("accept session")?;

    #[cfg(feature = "telemetry")]
    tokio::spawn(crate::record::path::run(connection.clone()));

    let link = |control| Link::quic(sessions.mode, connection.clone(), control, sessions.stall, sessions.cwnd_ahead);
    let result = async {
        match opening {
            Some(ask) => {
                let (ctl_tx, ctl_rx) = oneshot::channel();
                let link = link(ControlStream::Coming(ctl_rx)).await?;
                let control = connection.clone();
                let read = |tx| async move {
                    let Ok((send, mut recv)) = control.accept_bi().await else { return };
                    ctl_tx.send(send).ok();
                    while read_asks(&mut recv, &tx).await.is_continue() {}
                };
                sessions.serve(sessions.pipeline(link), Some(ask), read).await
            }
            None => {
                let (send, mut recv) = connection.accept_bi().await.context("accept control bidi")?;
                let link = link(ControlStream::Open(send)).await?;
                let read = |tx| async move { while read_asks(&mut recv, &tx).await.is_continue() {} };
                sessions.serve(sessions.pipeline(link), None, read).await
            }
        }
    }
    .await;
    report_path(&connection);
    match result {
        Err(err) if closed_by_peer(&connection, &err) => {
            info!(err = %format_args!("{err:#}"), "session closed by peer");
            Ok(())
        }
        result => result,
    }
}

/// The peer went: it stopped a stream the server was writing, or closed. `docs/WIRE.md` §FoD messages.
fn closed_by_peer(connection: &wtransport::Connection, err: &anyhow::Error) -> bool {
    use wtransport::error::{ConnectionError, StreamOpeningError, StreamReadError, StreamWriteError};
    use wtransport::quinn;
    let stopped = err.chain().any(|e| {
        matches!(e.downcast_ref(), Some(quinn::WriteError::Stopped(_)))
            || matches!(e.downcast_ref(), Some(StreamWriteError::Stopped(_)))
    });
    let gone = err.chain().any(|e| {
        matches!(e.downcast_ref(), Some(StreamReadError::NotConnected))
            || matches!(e.downcast_ref(), Some(StreamWriteError::NotConnected))
            || matches!(e.downcast_ref(), Some(StreamOpeningError::NotConnected))
            || matches!(e.downcast_ref(), Some(quinn::WriteError::ConnectionLost(_)))
            || e.downcast_ref::<ConnectionError>().is_some()
    });
    let closed = matches!(
        connection.quic_connection().close_reason(),
        Some(quinn::ConnectionError::ApplicationClosed(_) | quinn::ConnectionError::LocallyClosed)
    );
    stopped || (gone && closed)
}

/// `?ask=frame:N` or `?ask=fill:A-B`. `None` for absent, malformed, or out of range — the
/// session then proceeds as without it.
pub(super) fn parse_opening_ask(path: &str, frames: u32) -> Option<Command> {
    let value = path
        .split_once('?')?
        .1
        .split('&')
        .find_map(|f| f.strip_prefix("ask="))?;
    match value.split_once(':')? {
        ("frame", n) => {
            let frame = n.parse().ok()?;
            frame_in_range(frame, frames).ok()?;
            Some(Command::Frame(frame))
        }
        ("fill", range) => {
            let (from, to) = range.split_once('-')?;
            let (from, to) = (Some(from.parse().ok()?), Some(to.parse().ok()?));
            fill_range(from, to, frames).ok()?;
            Some(Command::Fill { from, to })
        }
        _ => None,
    }
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
        "session path"
    );
}

/// The loop over `Command`, with no stream in it, so a test can drive it without QUIC. However it
/// ends, outstanding finishes get their grace.
pub(super) async fn drive<P: FramePipeline>(pipeline: &mut P, asks: &mut mpsc::Receiver<Command>) -> Result<()> {
    let result = steps(pipeline, asks).await;
    pipeline.finish().await;
    result
}

async fn steps<P: FramePipeline>(pipeline: &mut P, asks: &mut mpsc::Receiver<Command>) -> Result<()> {
    let mut plan = Planner::new(pipeline.store().frame_count());
    loop {
        match plan.next(|| asks.try_recv().ok())? {
            Step::Serve { frame, next } => pipeline.serve(frame, &next).await?,
            Step::Refuse { frame, reason } => pipeline.refuse(frame, reason).await?,
            Step::Wait => match asks.recv().await {
                Some(ask) => plan.push(ask),
                None => return Ok(()),
            },
            Step::End => return Ok(()),
        }
    }
}

async fn read_asks(control_recv: &mut RecvStream, tx: &mpsc::Sender<Command>) -> ControlFlow<()> {
    forward(read_fod_msg(control_recv).await, tx).await
}

/// One FoD message as the loop's asks; `Break` once the reader should stop. `None`, the peer's
/// goodbye, stops it with no ask, so the loop ends when it next waits.
pub(super) async fn forward(msg: Result<Option<FodMsg>>, tx: &mpsc::Sender<Command>) -> ControlFlow<()> {
    let ask = match msg {
        Ok(Some(FodMsg::RequestFrame { frame })) => Command::Frame(frame),
        Ok(Some(FodMsg::StreamFrames { from, to })) => Command::Fill { from, to },
        Ok(Some(FodMsg::EndStream)) => Command::EndStream,
        Ok(Some(FodMsg::EndSession)) => Command::EndSession,
        Ok(Some(FodMsg::FrameError { .. })) => return ControlFlow::Continue(()),
        Ok(None) => return ControlFlow::Break(()),
        Err(err) => Command::Failed(err),
    };
    let failed = matches!(ask, Command::Failed(_));
    if tx.send(ask).await.is_err() || failed {
        return ControlFlow::Break(());
    }
    ControlFlow::Continue(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::planner::Next;
    use anyhow::anyhow;
    use crate::transport::wire::write_fod_msg;
    use fod::FodMsg;
    use frame_envelope::unwrap;
    use std::io::Write;
    use std::path::Path;
    use std::time::Duration;
    use wtransport::stream::SendStream;
    use wtransport::ClientConfig;

    type Ws = tokio_tungstenite::WebSocketStream<tokio_rustls::client::TlsStream<tokio::net::TcpStream>>;

    /// A series of `frames` frames and a dev certificate in a temp dir of its own, removed on
    /// drop; a port free for UDP and TCP alike; the crypto provider installed.
    struct Fixture {
        dir: PathBuf,
        series: PathBuf,
        cert_pem: PathBuf,
        key_pem: PathBuf,
        cert_hash: [u8; 32],
        port: u16,
    }

    impl Fixture {
        fn new(frames: u32) -> Self {
            static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
            let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!("wtpacs-test-{}-{n}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("tmpdir");
            let series = write_series(&dir, frames);
            let (cert_pem, key_pem, cert_hash) = write_dev_cert(&dir);
            let _ = rustls::crypto::ring::default_provider().install_default();
            Self { dir, series, cert_pem, key_pem, cert_hash, port: free_port_for_both() }
        }

        /// A server on loopback `port`: shared streams, every lab flag off, no opening ask.
        fn config(&self) -> ServeConfig {
            ServeConfig {
                wt_port: self.port,
                series_path: self.series.clone(),
                cert_pem: self.cert_pem.clone(),
                key_pem: self.key_pem.clone(),
                mode: StreamMode::Shared,
                bind: Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
                tuning: TransportTuning::default(),
                force_pool_reads: false,
                opening_ask: false,
                hold_sessions: false,
                stall_after_bytes: None,
                send_window_follows_cwnd: false,
                websocket: false,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.dir).ok();
        }
    }

    /// Records what the loop hands the pipeline: the frame and what follows it.
    struct LoopRecorder {
        store: Arc<FrameStore>,
        seen: Vec<(u32, Next)>,
        fills: u32,
        drained: bool,
    }

    impl FramePipeline for LoopRecorder {
        fn store(&self) -> &Arc<FrameStore> {
            &self.store
        }
        async fn read(&mut self, frame: u32, next: &Next) -> Result<bytes::Bytes> {
            self.fills += u32::from(matches!(next, Next::Fill { first: true, .. }));
            self.seen.push((frame, next.clone()));
            Ok(bytes::Bytes::new())
        }
        async fn write(&mut self, _frame: u32, _body: bytes::Bytes, _ask: bool) -> Result<()> {
            Ok(())
        }
        async fn refuse(&mut self, _frame: u32, _reason: String) -> Result<()> {
            Ok(())
        }
        async fn finish(&mut self) {
            self.drained = true;
        }
    }

    /// A client's `frame_error` is ignored: the reader goes on and the loop is handed nothing.
    /// `docs/WIRE.md` §FoD messages
    #[tokio::test]
    async fn a_clients_frame_error_is_ignored() {
        let (tx, mut rx) = mpsc::channel(ASKS_AHEAD);
        let msg = FodMsg::FrameError { frame_index: 3, reason: "sent by a client".into() };
        assert!(forward(Ok(Some(msg)), &tx).await.is_continue(), "a client's frame_error stopped the reader");
        assert!(rx.try_recv().is_err(), "a client's frame_error reached the loop as an ask");
    }

    /// **The loop's own line.** `Step::Serve`'s `next` reaches `serve`; a fill names one frame
    /// ahead and is counted once. No QUIC — the seam below `serve` is `pipeline.rs`'s.
    /// `docs/adr/disk-access.md`.
    #[tokio::test]
    async fn the_loop_hands_serve_the_frames_the_planner_named() {
        let fx = Fixture::new(4);
        let store = Arc::new(FrameStore::open(&fx.series).expect("open store"));

        let mut rec = LoopRecorder {
            store,
            seen: Vec::new(),
            fills: 0,
            drained: false,
        };
        let (tx, mut rx) = mpsc::channel(ASKS_AHEAD);
        for ask in [Command::Frame(0), Command::Frame(2), Command::Frame(3), Command::EndSession] {
            tx.try_send(ask).expect("queue ask");
        }
        drive(&mut rec, &mut rx).await.expect("drive");
        let tiles = |names: &[u32]| Next::Tiles(names.to_vec());
        assert_eq!(
            rec.seen,
            vec![(0, tiles(&[2, 3])), (2, tiles(&[3])), (3, tiles(&[]))],
            "the planner's names did not reach serve"
        );

        let mut rec = LoopRecorder {
            store: Arc::clone(rec.store()),
            seen: Vec::new(),
            fills: 0,
            drained: false,
        };
        let (tx, mut rx) = mpsc::channel(ASKS_AHEAD);
        tx.try_send(Command::Fill {
            from: Some(1),
            to: Some(3),
        })
        .expect("queue fill");
        tx.try_send(Command::EndSession).expect("queue end");
        drop(tx);
        drive(&mut rec, &mut rx).await.expect("drive fill");
        assert_eq!(rec.fills, 0, "a fill cancelled by EndSession was counted");

        let mut rec = LoopRecorder {
            store: Arc::clone(rec.store()),
            seen: Vec::new(),
            fills: 0,
            drained: false,
        };
        let (tx, mut rx) = mpsc::channel(ASKS_AHEAD);
        tx.try_send(Command::Fill {
            from: Some(1),
            to: Some(3),
        })
        .expect("queue fill");
        drop(tx);
        drive(&mut rec, &mut rx).await.expect("drive fill");
        let fill = |after, first| Next::Fill { after, first };
        assert_eq!(
            rec.seen,
            vec![(1, fill(Some(2), true)), (2, fill(Some(3), false)), (3, fill(None, false))],
            "a fill did not name one frame ahead"
        );
        assert_eq!(rec.fills, 1, "a fill that served was not counted once");
    }

    /// However the asks end — a reader that failed included — outstanding finishes get their
    /// grace before the loop returns. `docs/WIRE.md` §Stream modes.
    #[tokio::test]
    async fn the_loop_drains_its_finishes_however_the_asks_end() {
        let fx = Fixture::new(2);
        let store = Arc::new(FrameStore::open(&fx.series).expect("open store"));
        let mut rec = LoopRecorder { store, seen: Vec::new(), fills: 0, drained: false };
        let (tx, mut rx) = mpsc::channel(ASKS_AHEAD);
        tx.try_send(Command::Frame(0)).expect("queue ask");
        tx.try_send(Command::Failed(anyhow!("a malformed message"))).expect("queue failure");
        assert!(drive(&mut rec, &mut rx).await.is_err(), "the failure was swallowed");
        assert!(rec.drained, "a session that ended in error skipped the finishes' grace");
    }

    /// One session served by `handle_incoming` itself, so the test sees what the session ended
    /// with. `client` gets the connection, which stays open until the session has ended unless
    /// `client` closes it.
    async fn one_session<F, Fut>(tuning: TransportTuning, client: F) -> Result<()>
    where
        F: FnOnce(wtransport::Connection) -> Fut,
        Fut: Future<Output = ()>,
    {
        let fx = Fixture::new(4);
        let sessions = plain_sessions(&fx.series);
        let config = ServeConfig { tuning, ..fx.config() };
        let identity = Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
            .await
            .expect("identity");
        let (endpoint, _) = build_endpoint(&config, &identity).expect("endpoint");
        let server =
            tokio::spawn(async move { handle_incoming(endpoint.accept().await, sessions).await });
        let connection = dial(fx.port, fx.cert_hash, "").await;
        client(connection.clone()).await;
        let ended = tokio::time::timeout(Duration::from_secs(10), server)
            .await
            .expect("the session never ended")
            .expect("session task");
        drop(connection);
        ended
    }

    async fn open_control(connection: &wtransport::Connection) -> (SendStream, RecvStream) {
        connection.open_bi().await.expect("open bi").await.expect("bi ready")
    }

    /// Shared streams, no opening ask, nothing recorded.
    fn plain_sessions(series: &Path) -> Sessions {
        Sessions {
            store: Arc::new(FrameStore::open(series).expect("open store")),
            read_mode: ReadMode::Auto,
            mode: StreamMode::Shared,
            opening_ask: false,
            stall: None,
            cwnd_ahead: None,
            #[cfg(feature = "telemetry")]
            taps: Arc::new(|| None),
        }
    }

    /// **A goodbye is not an error.** No client sends `end_session`: a session ends with the
    /// client closing it, and that is a normal end, not a WARN. `docs/WIRE.md` §FoD messages.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_client_that_closes_after_its_frames_ends_its_session_cleanly() {
        let ended = one_session(TransportTuning::default(), |connection| async move {
            let (mut control, _recv) = open_control(&connection).await;
            control
                .write_all(&fod::encode_fod_msg(&FodMsg::RequestFrame { frame: 1 }).unwrap())
                .await
                .expect("ask");
            let mut media = connection.accept_uni().await.expect("accept media uni");
            let (idx, _) = tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                .await
                .expect("frame never arrived");
            assert_eq!(idx, 1);
            connection.close(0u32.into(), b"done");
        })
        .await;
        assert!(ended.is_ok(), "a client's close ended its session as {ended:?}");
    }

    /// **A client that stops reading has said goodbye too.** Dropping the media stream stops it;
    /// the server's next write then fails as stopped, before any close reaches it, and that is
    /// the client walking away from a fill, not a failure. `docs/WIRE.md` §FoD messages.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_client_that_stops_its_media_stream_ends_its_session_cleanly() {
        let ended = one_session(TransportTuning::default(), |connection| async move {
            let (mut control, _recv) = open_control(&connection).await;
            let ask = |frame| fod::encode_fod_msg(&FodMsg::RequestFrame { frame }).unwrap();
            control.write_all(&ask(0)).await.expect("ask");
            let mut media = connection.accept_uni().await.expect("accept media uni");
            tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                .await
                .expect("frame never arrived");
            drop(media);
            tokio::time::sleep(Duration::from_millis(200)).await;
            control.write_all(&ask(1)).await.expect("ask");
        })
        .await;
        assert!(ended.is_ok(), "a stopped media stream ended the session as {ended:?}");
    }

    /// A message the server cannot read still ends the session in error, a goodbye or not.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_malformed_ask_ends_its_session_in_error() {
        let ended = one_session(TransportTuning::default(), |connection| async move {
            let (mut control, _recv) = open_control(&connection).await;
            let mut bytes = 5u32.to_le_bytes().to_vec();
            bytes.extend_from_slice(b"xxxxx");
            control.write_all(&bytes).await.expect("write");
        })
        .await;
        assert!(ended.is_err(), "a malformed ask ended its session cleanly");
    }

    /// A peer that goes silent until the connection times out has not said goodbye.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_session_that_times_out_ends_in_error() {
        let idle = TransportTuning { max_idle_timeout_ms: Some(300), ..TransportTuning::default() };
        let ended = one_session(idle, |connection| async move {
            let (control, _recv) = open_control(&connection).await;
            // Held open past the timeout: dropping it would finish it, which is a goodbye.
            tokio::time::sleep(Duration::from_secs(1)).await;
            drop(control);
        })
        .await;
        assert!(ended.is_err(), "a timed-out session ended cleanly");
    }

    /// A client that finishes its control stream between messages has said goodbye too.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_client_that_finishes_its_control_stream_ends_its_session_cleanly() {
        let ended = one_session(TransportTuning::default(), |connection| async move {
            let (mut control, _recv) = open_control(&connection).await;
            control.finish().await.expect("finish");
        })
        .await;
        assert!(ended.is_ok(), "a FIN between messages ended the session as {ended:?}");
    }

    /// A client that dials and goes before opening its control stream has said goodbye too: a
    /// close during session setup is classified like one during serving.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_client_that_closes_right_after_the_accept_ends_cleanly() {
        let ended = one_session(TransportTuning::default(), |connection| async move {
            connection.close(0u32.into(), b"gone");
        })
        .await;
        assert!(ended.is_ok(), "a close during setup ended the session as {ended:?}");
    }

    /// A WebSocket client's Close is a goodbye too. `docs/WIRE.md` §The WebSocket mapping.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_websocket_close_ends_its_session_cleanly() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
        use tokio_tungstenite::tungstenite::protocol::CloseFrame;
        use tokio_tungstenite::tungstenite::Message;

        let ended = ws_session(|mut ws| async move {
            let ask = serde_json::to_string(&FodMsg::RequestFrame { frame: 1 }).unwrap();
            ws.send(Message::text(ask)).await.expect("ask");
            let (want, mut got) = (8 + pattern(1).len(), 0);
            while got < want {
                let msg = tokio::time::timeout(Duration::from_secs(10), ws.next())
                    .await
                    .expect("the frame stalled")
                    .expect("socket ended")
                    .expect("read");
                got += msg.into_data().len();
            }
            ws.close(Some(CloseFrame { code: CloseCode::Normal, reason: "".into() }))
                .await
                .expect("close");
        })
        .await;
        assert!(ended.is_ok(), "a WebSocket Close ended its session as {ended:?}");
    }

    /// A session the server ends sends the client a Close frame, not a bare TCP teardown, so a
    /// client can tell an end from a broken link. `docs/WIRE.md` §The WebSocket mapping.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_websocket_session_ends_with_a_close_frame() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;

        let ended = ws_session(|mut ws| async move {
            let end = serde_json::to_string(&FodMsg::EndSession).unwrap();
            ws.send(Message::text(end)).await.expect("end_session");
            let last = tokio::time::timeout(Duration::from_secs(10), ws.next())
                .await
                .expect("the session never ended");
            assert!(
                matches!(last, Some(Ok(Message::Close(_)))),
                "the session ended without a Close frame: {last:?}"
            );
        })
        .await;
        assert!(ended.is_ok(), "end_session ended the session as {ended:?}");
    }

    /// A WebSocket frame announcing more than `MAX_FOD_LEN` ends the session at its header, before
    /// the server reserves room for its payload. `docs/WIRE.md` §The WebSocket mapping
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_websocket_frame_over_the_cap_is_refused_at_its_header() {
        use crate::transport::wire::MAX_FOD_LEN;
        use futures_util::StreamExt;
        use tokio::io::AsyncWriteExt;

        let ended = ws_session(|mut ws| async move {
            // A masked text frame's header with a 64-bit length; its payload is never sent.
            let mut head = vec![0x81, 0xFF];
            head.extend_from_slice(&(MAX_FOD_LEN as u64 + 1).to_be_bytes());
            head.extend_from_slice(&[0; 4]);
            ws.get_mut().write_all(&head).await.expect("header");
            ws.get_mut().flush().await.expect("flush");
            let answer = tokio::time::timeout(Duration::from_secs(3), ws.next()).await;
            assert!(answer.is_ok(), "the server waited for the payload of an over-long frame");
        })
        .await;
        assert!(ended.is_err(), "an over-long frame ended the session as {ended:?}");
    }

    /// One WebSocket session served by `websocket::session` on a two-frame series; `client`
    /// gets the upgraded socket, and the result is what the session ended with.
    async fn ws_session<F, Fut>(client: F) -> Result<()>
    where
        F: FnOnce(Ws) -> Fut,
        Fut: Future<Output = ()>,
    {
        let fx = Fixture::new(2);
        let sessions = plain_sessions(&fx.series);
        let localhost = Some(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST));
        let (listener, tls) =
            websocket::bind(localhost, 0, &fx.cert_pem, &fx.key_pem).await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.expect("accept");
            websocket::session(tcp, tls, sessions).await
        });
        client(ws_dial(port, &fx.cert_pem, "").await).await;
        tokio::time::timeout(Duration::from_secs(10), server)
            .await
            .expect("the session never ended")
            .expect("session task")
    }

    /// An opening ask is taken only whole and in range: each end of a fill is a frame number, the
    /// range is one the planner would serve, and anything else is ignored rather than widened.
    #[test]
    fn an_opening_ask_is_taken_only_whole_and_in_range() {
        for (path, want) in [
            ("/?ask=fill:0-3", Some("Fill { from: Some(0), to: Some(3) }")),
            ("/?x=1&ask=frame:2", Some("Frame(2)")),
            ("/?ask=fill:abc-xyz", None),
            ("/?ask=fill:-", None),
            ("/?ask=fill:3-x", None),
            ("/?ask=fill:7-3", None),
            ("/?ask=fill:99-", None),
            ("/?ask=fill:3-6", None),
            ("/?ask=frame:6", None),
            ("/?ask=frame:x", None),
            ("/", None),
        ] {
            let got = parse_opening_ask(path, 6).map(|ask| format!("{ask:?}"));
            assert_eq!(got.as_deref(), want, "{path}");
        }
    }

    /// A series of `frames` frames, each a different length and pattern, so a batch served
    /// out of the wrong window or the wrong order cannot pass.
    fn write_series(dir: &Path, frames: u32) -> PathBuf {
        let bodies: Vec<Vec<u8>> = (0..frames).map(pattern).collect();
        let refs: Vec<&[u8]> = bodies.iter().map(|b| b.as_slice()).collect();
        let path = dir.join("batch.sbnd");
        series_bundle::write_bundle(
            &path,
            format!("{{\"frameCount\":{frames}}}").as_bytes(),
            &refs,
        )
        .expect("write series");
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
    fn write_dev_cert(dir: &Path) -> (PathBuf, PathBuf, [u8; 32]) {
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

    /// A client that pins the server's certificate by hash, the way a browser does.
    fn pinned(cert_hash: [u8; 32]) -> ClientConfig {
        ClientConfig::builder()
            .with_bind_config(IpBindConfig::InAddrAnyV4)
            .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
            .build()
    }

    /// As [`pinned`], with ALPN entries the server ignores pushing the ClientHello past one
    /// datagram, as Firefox's is.
    fn long_hello(cert_hash: [u8; 32]) -> ClientConfig {
        let mut tls = wtransport::tls::client::build_default_tls_config(
            Arc::new(rustls::RootCertStore::empty()),
            Some(Arc::new(wtransport::tls::client::ServerHashVerification::new([
                wtransport::tls::Sha256Digest::new(cert_hash),
            ]))),
        );
        tls.alpn_protocols.extend((0..6u8).map(|i| vec![b'x' + i; 250]));
        ClientConfig::builder().with_bind_config(IpBindConfig::InAddrAnyV4).with_custom_tls(tls).build()
    }

    fn client(config: ClientConfig) -> Endpoint<endpoint_side::Client> {
        Endpoint::client(config).expect("client endpoint")
    }

    /// A bare QUIC client, for a test that dials a relay by address; `initial_rtt` sets when it
    /// first repeats its Initial.
    fn quinn_client(config: &ClientConfig, initial_rtt: Option<Duration>) -> wtransport::quinn::Endpoint {
        let mut quic = config.quic_config().clone();
        if let Some(rtt) = initial_rtt {
            let mut transport = wtransport::quinn::TransportConfig::default();
            transport.initial_rtt(rtt);
            quic.transport_config(Arc::new(transport));
        }
        let mut endpoint = wtransport::quinn::Endpoint::client("127.0.0.1:0".parse().unwrap())
            .expect("quinn client");
        endpoint.set_default_client_config(quic);
        endpoint
    }

    /// The first WebTransport session the server on `port` answers, within five seconds;
    /// `query` rides the session URL.
    async fn dial(port: u16, cert_hash: [u8; 32], query: &str) -> wtransport::Connection {
        let endpoint = client(pinned(cert_hash));
        let url = format!("https://127.0.0.1:{port}/{query}");
        for _ in 0..50 {
            match endpoint.connect(url.clone()).await {
                Ok(connection) => return connection,
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
        panic!("server never accepted a connection");
    }

    /// A WebSocket upgraded over TLS that trusts `cert_pem`, on the first TCP connection the
    /// server on `port` takes; `query` rides the upgrade's URL.
    async fn ws_dial(port: u16, cert_pem: &Path, query: &str) -> Ws {
        use rustls::pki_types::{pem::PemObject, CertificateDer, ServerName};
        let mut roots = rustls::RootCertStore::empty();
        for der in CertificateDer::pem_file_iter(cert_pem).expect("pem") {
            roots.add(der.expect("pem")).expect("trust the test cert");
        }
        let tls = tokio_rustls::TlsConnector::from(Arc::new(
            rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth(),
        ));
        let tcp = connect_tcp(port).await;
        let name = ServerName::try_from("localhost").expect("name");
        let stream = tls.connect(name, tcp).await.expect("TLS with the QUIC certificate");
        let (ws, _) = tokio_tungstenite::client_async(format!("wss://localhost:{port}/{query}"), stream)
            .await
            .expect("WebSocket upgrade");
        ws
    }

    /// A port nobody is listening on right now. Racy in principle; the alternative is a
    /// fixed port, which collides with a developer running the server.
    fn free_port() -> u16 {
        std::net::UdpSocket::bind("127.0.0.1:0")
            .and_then(|s| s.local_addr())
            .expect("free port")
            .port()
    }

    /// Until the server holds `port`: a server that never binds fails the test rather than hangs it.
    async fn until_bound(port: u16, deadline: Duration) {
        let give_up = tokio::time::Instant::now() + deadline;
        while std::net::UdpSocket::bind(("127.0.0.1", port)).is_ok() {
            assert!(tokio::time::Instant::now() < give_up, "the server never bound port {port}");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// A port free for UDP and TCP alike, for a server that also binds its WebSocket on it.
    fn free_port_for_both() -> u16 {
        loop {
            let port = free_port();
            if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
                return port;
            }
        }
    }

    /// `client` raced against `server`: a server that ends first fails the test with its own error.
    async fn against(mut server: tokio::task::JoinHandle<Result<()>>, client: impl Future<Output = ()>) {
        tokio::select! {
            ended = &mut server => panic!("the server ended: {ended:?}"),
            () = client => server.abort(),
        }
    }

    /// The first TCP connection the server's WebSocket listener takes, within five seconds.
    async fn connect_tcp(port: u16) -> tokio::net::TcpStream {
        for _ in 0..50 {
            if let Ok(tcp) = tokio::net::TcpStream::connect(("127.0.0.1", port)).await {
                return tcp;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!("server never listened on TCP port {port}");
    }

    /// A WebSocket server whose TCP port is taken fails the test with its own bind error, not a
    /// timeout of the client's.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_server_that_cannot_listen_fails_with_its_own_error() {
        let fx = Fixture::new(1);
        let port = fx.port;
        let held = std::net::TcpListener::bind(("127.0.0.1", port)).expect("hold the TCP port");
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_err(), "the hold took nothing");
        let server = tokio::spawn(run_server(ServeConfig { websocket: true, ..fx.config() }));
        let client = async move {
            let _tcp = connect_tcp(port).await;
            std::future::pending::<()>().await;
        };
        let raced = tokio::spawn(against(server, client));
        let ended = tokio::time::timeout(Duration::from_secs(5), raced).await;
        drop(held);
        let panic = ended.expect("the race outlived the server's end").expect_err("the server's end passed");
        let why = panic.into_panic();
        let why = why.downcast_ref::<String>().cloned().unwrap_or_default();
        assert!(why.contains(&format!("WebSocket listener on TCP port {port}")), "the test failed with {why:?}");
    }

    /// The wait for the server's port has a deadline: on a port nobody binds it panics, it does not spin.
    #[tokio::test]
    async fn the_wait_for_a_port_fails_rather_than_hangs() {
        let wait = tokio::spawn(until_bound(free_port(), Duration::from_millis(200)));
        let joined = tokio::time::timeout(Duration::from_secs(5), wait)
            .await
            .expect("the wait for a port has no deadline");
        assert!(joined.expect_err("a port nobody bound passed the wait").is_panic());
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

    /// Pipelined `RequestFrame`s reach the loop as `current` + `upcoming`, not one-at-a-time.
    /// `docs/adr/frame-framing-and-loop-shape.md` §6d.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn pipelined_single_asks_arrive_whole_and_in_ask_order() {
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
        })
        .await;
    }

    /// The ask in the session URL is served without the client ever writing to the control
    /// stream, an out-of-range one is ignored rather than taken, and a refusal in such a session
    /// waits for the control stream instead of being dropped. `docs/ARCHITECTURE.md`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_opening_ask_is_served_behind_the_accept() {
        for (query, want) in [("?ask=frame:3", Some(3u32)), ("?ask=frame:99", None)] {
            let fx = Fixture::new(6);
            let server = tokio::spawn(run_server(ServeConfig { opening_ask: true, ..fx.config() }));
            let connection = dial(fx.port, fx.cert_hash, query).await;

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
                        matches!(refusal, Some(FodMsg::FrameError { frame_index: 99, .. })),
                        "the refusal was {refusal:?}, not a frame_error for 99",
                    );
                }
                None => assert!(
                    media.is_err(),
                    "an out-of-range opening ask opened a media stream",
                ),
            }
            server.abort();
        }
    }

    /// Over the WebSocket the ask in the upgrade's URL is served without the client ever sending
    /// a message, and an out-of-range one is ignored rather than taken. `docs/WIRE.md` §The
    /// WebSocket mapping.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_opening_ask_rides_the_websocket_upgrade() {
        use futures_util::StreamExt;
        use tokio_tungstenite::tungstenite::Message;
        for (query, want) in [("?ask=frame:3", Some(3u32)), ("?ask=frame:99", None)] {
            let fx = Fixture::new(6);
            let server = tokio::spawn(run_server(ServeConfig {
                opening_ask: true,
                websocket: true,
                ..fx.config()
            }));
            against(server, async {
                let mut socket = ws_dial(fx.port, &fx.cert_pem, query).await;

                // Nothing is sent: the frame must arrive on the URL ask alone.
                let mut bytes = Vec::new();
                let whole = |b: &[u8]| {
                    b.len() >= 4 && b.len() >= 4 + u32::from_be_bytes(b[..4].try_into().unwrap()) as usize
                };
                let read = tokio::time::timeout(Duration::from_secs(3), async {
                    while let Some(Ok(Message::Binary(chunk))) = socket.next().await {
                        bytes.extend_from_slice(&chunk);
                        if whole(&bytes) {
                            return;
                        }
                    }
                })
                .await;
                match want {
                    Some(frame) => {
                        read.expect("no frame on the URL ask");
                        let index = u32::from_be_bytes(bytes[4..8].try_into().unwrap());
                        assert_eq!(index, frame, "the URL ask served the wrong frame");
                        assert_eq!(bytes[8..], pattern(frame), "frame {frame} came back wrong");
                    }
                    None => assert!(bytes.is_empty(), "an out-of-range opening ask was served"),
                }
            })
            .await;
        }
    }

    /// A TCP peer that never starts its TLS handshake is let go at the handshake deadline,
    /// instead of holding a task and a descriptor for ever.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_silent_websocket_peer_is_dropped_at_the_handshake_deadline() {
        use tokio::io::AsyncReadExt;
        let fx = Fixture::new(1);
        let server = tokio::spawn(run_server(ServeConfig { websocket: true, ..fx.config() }));
        against(server, async {
            let mut tcp = connect_tcp(fx.port).await;
            let mut byte = [0u8; 1];
            let closed = tokio::time::timeout(
                websocket::HANDSHAKE + Duration::from_secs(3),
                tcp.read(&mut byte),
            )
            .await;
            assert!(
                matches!(closed, Ok(Ok(0) | Err(_))),
                "the silent peer was still held past the handshake deadline: {closed:?}"
            );
        })
        .await;
    }

    /// A session opened on its URL ask is recorded like any other: an opening fill of three
    /// frames leaves three `server_frame` rows and a session row.
    #[cfg(feature = "telemetry")]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_opening_fill_is_recorded_like_any_other_session() {
        use crate::record::tap::{Live, Record, Tap};
        let fx = Fixture::new(4);
        let (tx, rows) = std::sync::mpsc::sync_channel(64);
        let sessions = Sessions {
            store: Arc::new(FrameStore::open(&fx.series).expect("open store")),
            read_mode: ReadMode::Auto,
            mode: StreamMode::Shared,
            opening_ask: true,
            stall: None,
            cwnd_ahead: None,
            taps: Arc::new(move || Some(Tap::new(1, Some(tx.clone()), &Live::default()))),
        };
        let config = fx.config();
        let identity = Identity::load_pemfiles(&config.cert_pem, &config.key_pem)
            .await
            .expect("identity");
        let (endpoint, _) = build_endpoint(&config, &identity).expect("endpoint");
        let server = tokio::spawn(async move {
            handle_incoming(endpoint.accept().await, sessions).await
        });
        let connection = dial(fx.port, fx.cert_hash, "?ask=fill:0-2").await;
        let mut media = connection.accept_uni().await.expect("accept media uni");
        for want in 0..3 {
            let (idx, _) = tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                .await
                .expect("frame never arrived");
            assert_eq!(idx, want, "the opening fill served the wrong frame");
        }
        connection.close(0u32.into(), b"done");
        tokio::time::timeout(Duration::from_secs(10), server)
            .await
            .expect("the session never ended")
            .expect("session task")
            .ok();
        let records: Vec<Record> = rows.try_iter().flatten().collect();
        let frames: Vec<u32> = records
            .iter()
            .filter_map(|r| match r {
                Record::Frame(f) => Some(f.frame_index),
                Record::Session(_) => None,
            })
            .collect();
        assert_eq!(frames, vec![0, 1, 2], "the opening fill left no rows, or the wrong ones");
        assert!(
            matches!(records.last(), Some(Record::Session(_))),
            "the session row is missing"
        );
    }

    /// With `hold_sessions` the client's dial neither completes nor fails: the handshake is done,
    /// the CONNECT is taken, and nothing answers it — the dial a client needs its own deadline
    /// for. `docs/ARCHITECTURE.md` §A dial that never settles.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_held_dial_neither_connects_nor_fails() {
        let fx = Fixture::new(1);
        let server = tokio::spawn(run_server(ServeConfig { hold_sessions: true, ..fx.config() }));
        let endpoint = client(pinned(fx.cert_hash));
        let url = format!("https://127.0.0.1:{}/", fx.port);
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
    }

    /// With `stall_after_bytes` a session's media stream carries exactly that many bytes — the
    /// last frame cut inside its envelope — and then nothing, not even a FIN: WebKit bug 319818's
    /// stall. `docs/ARCHITECTURE.md` §Recycling before the stall.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_stalled_session_sends_its_budget_and_then_nothing() {
        let frames = 4u32;
        let fx = Fixture::new(frames);
        let budget = (8 + pattern(0).len() + 8 + pattern(1).len() / 2) as u64;
        let server = tokio::spawn(run_server(ServeConfig {
            stall_after_bytes: Some(budget),
            ..fx.config()
        }));
        let connection = dial(fx.port, fx.cert_hash, "").await;
        let (mut send, _recv) =
            connection.open_bi().await.expect("open control").await.expect("control");
        write_fod_msg(&mut send, &FodMsg::StreamFrames { from: Some(0), to: Some(frames - 1) })
            .await
            .expect("ask the fill");
        let mut media = tokio::time::timeout(Duration::from_secs(5), connection.accept_uni())
            .await
            .expect("no media uni")
            .expect("accept media uni");

        let mut got = 0u64;
        let mut buf = vec![0u8; 64 * 1024];
        let ended = loop {
            match tokio::time::timeout(Duration::from_millis(1500), media.read(&mut buf)).await {
                Ok(Ok(Some(n))) => got += n as u64,
                Ok(_) => break true,
                Err(_) => break false,
            }
        };
        assert_eq!(got, budget, "the stream carried {got} bytes, not its budget of {budget}");
        assert!(!ended, "the stalled stream was ended; the bug leaves it open");
        server.abort();
    }

    /// With `send_window_follows_cwnd` an ask during a fill waits behind what the window allows —
    /// cwnd, two frames, and the frame the window cut — not behind the 1.25 MB the client's
    /// credit lets the server queue. The server hears no ACK while the client asks, so nothing
    /// written leaves the window. `docs/transport/link-conditions.md` §ASKAHEAD.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_ask_during_a_fill_waits_behind_no_more_than_the_send_window() {
        const CWND_ALLOWANCE: usize = 64 * 1024;
        let frames = 32u32;
        let fx = Fixture::new(frames);
        let server = tokio::spawn(run_server(ServeConfig { send_window_follows_cwnd: true, ..fx.config() }));
        until_bound(fx.port, Duration::from_secs(5)).await;

        // The server's datagrams are dropped while `dark`; the client's always pass.
        let front = Arc::new(tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay"));
        let relay = front.local_addr().expect("relay addr");
        let back = tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay");
        back.connect(("127.0.0.1", fx.port)).await.expect("relay upstream");
        let dark = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let darkened = dark.clone();
        let relaying = tokio::spawn(async move {
            let (mut up, mut down) = (vec![0u8; 65536], vec![0u8; 65536]);
            let mut client = None;
            loop {
                tokio::select! {
                    Ok((n, from)) = front.recv_from(&mut up) => {
                        client = Some(from);
                        back.send(&up[..n]).await.ok();
                    }
                    Ok(n) = back.recv(&mut down) => {
                        if let (false, Some(to)) = (darkened.load(std::sync::atomic::Ordering::Relaxed), client) {
                            front.send_to(&down[..n], to).await.ok();
                        }
                    }
                }
            }
        });

        let connection = client(pinned(fx.cert_hash))
            .connect(format!("https://{relay}/"))
            .await
            .expect("session");
        let (mut control, _recv) = open_control(&connection).await;
        dark.store(true, std::sync::atomic::Ordering::Relaxed);
        write_fod_msg(&mut control, &FodMsg::StreamFrames { from: None, to: None }).await.expect("fill");
        tokio::time::sleep(Duration::from_millis(300)).await;
        write_fod_msg(&mut control, &FodMsg::RequestFrame { frame: frames - 1 }).await.expect("ask");
        tokio::time::sleep(Duration::from_millis(300)).await;
        dark.store(false, std::sync::atomic::Ordering::Relaxed);

        let mut media = tokio::time::timeout(Duration::from_secs(10), connection.accept_uni())
            .await
            .expect("no media uni")
            .expect("accept media uni");
        let mut ahead = 0;
        loop {
            let (idx, codestream) = tokio::time::timeout(Duration::from_secs(10), read_envelope(&mut media))
                .await
                .expect("the ask never arrived");
            if idx == frames - 1 {
                break;
            }
            ahead += 8 + codestream.len();
        }
        let window = CWND_ALLOWANCE + 3 * (8 + pattern(frames - 1).len());
        assert!(ahead > 0, "the fill wrote nothing before the ask: the test bounded nothing");
        assert!(ahead <= window, "the ask waited behind {ahead} bytes, more than the window's {window}");
        relaying.abort();
        server.abort();
    }

    /// The server's SETTINGS leave with its handshake flight: a client that loses everything it
    /// sends after its first flight — so the server's handshake can never complete — still
    /// receives the HTTP/3 control stream, opening with SETTINGS. Without
    /// `patches/wtransport-0.7.2-settings-in-handshake.patch` it never does.
    /// `docs/ARCHITECTURE.md` §Early SETTINGS.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn settings_ride_the_handshake_flight() {
        let fx = Fixture::new(1);
        let server = tokio::spawn(run_server(fx.config()));
        until_bound(fx.port, Duration::from_secs(5)).await;
        assert_settings_before_the_handshake(fx.port, fx.cert_hash).await;
        server.abort();
    }

    /// The same holds for a server that accepts its own QUIC connections and hands each to the
    /// library through `IncomingSessionFuture::with_quic_connecting`: its SETTINGS leave with its
    /// handshake flight too. Without the patch's `with_quic_connecting` change they never do.
    /// `docs/ARCHITECTURE.md` §Early SETTINGS.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn settings_ride_the_handshake_flight_from_a_quic_connecting() {
        let fx = Fixture::new(1);
        let identity = Identity::load_pemfiles(&fx.cert_pem, &fx.key_pem).await.expect("identity");
        let config = ServerConfig::builder()
            .with_bind_address("127.0.0.1:0".parse().unwrap())
            .with_identity(identity)
            .build();
        let endpoint = wtransport::quinn::Endpoint::server(
            config.quic_config().clone(),
            "127.0.0.1:0".parse().unwrap(),
        )
        .expect("quinn server");
        let port = endpoint.local_addr().expect("server addr").port();
        let server = tokio::spawn(async move {
            let incoming = endpoint.accept().await.expect("an incoming connection");
            let connecting = incoming.accept().expect("connecting");
            let _ = wtransport::endpoint::IncomingSessionFuture::with_quic_connecting(connecting)
                .await;
        });
        assert_settings_before_the_handshake(port, fx.cert_hash).await;
        server.abort();
    }

    /// Dials the server on `port` through a relay that stops forwarding the client's datagrams
    /// once the server has answered, and asserts the server's control stream arrives anyway.
    async fn assert_settings_before_the_handshake(port: u16, cert_hash: [u8; 32]) {
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

        let endpoint = quinn_client(&pinned(cert_hash), None);
        let connection = endpoint
            .connect(relay, "localhost")
            .expect("connect")
            .await
            .expect("client side of the handshake");
        let mut control = tokio::time::timeout(Duration::from_secs(3), connection.accept_uni())
            .await
            .expect("no server stream before the server's handshake completed")
            .expect("accept uni");
        let mut head = [0u8; 2];
        control.read_exact(&mut head).await.expect("control stream head");
        assert_eq!(head, [0x00, 0x04], "not a control stream opening with SETTINGS");
    }

    /// A server whose whole first flight is lost probes every space it sent in, so its handshake
    /// flight rides the ServerHello's probe and its 0.5-RTT SETTINGS reach the client one round
    /// trip after the client's handshake completes — when an unpatched server's would. Without
    /// `patches/quinn-proto-0.11.18-probe-every-space.patch` they wait for the ACK of
    /// HANDSHAKE_DONE to be declared lost: two round trips. `docs/ARCHITECTURE.md` §What early SETTINGS cost.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_lost_first_flight_is_repeated_whole() {
        const ONE_WAY: Duration = Duration::from_millis(50);
        let fx = Fixture::new(1);
        let port = fx.port;
        let server = tokio::spawn(run_server(fx.config()));
        until_bound(port, Duration::from_secs(5)).await;

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

        // The client's own Initial retransmit would land beside the server's probe, both ~1 s;
        // racing them is not this test's claim, so the client waits 3 s before it repeats.
        let endpoint = quinn_client(&pinned(fx.cert_hash), Some(Duration::from_secs(1)));
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
    }

    /// Dials a server whose datagrams are dropped for `swallow` after its first, every datagram
    /// delayed `one_way`, with a client whose first probe comes at 300 ms, as Chromium's and
    /// Firefox's do. Returns the time to the client's handshake and, per round of client datagrams
    /// the server received, the server's bytes in the `one_way` after the round's first.
    async fn dial_with_first_answers_swallowed(
        tuning: TransportTuning,
        one_way: Duration,
        swallow: Duration,
    ) -> (Duration, Vec<usize>) {
        let fx = Fixture::new(1);
        let port = fx.port;
        let server = tokio::spawn(run_server(ServeConfig { tuning, ..fx.config() }));
        until_bound(port, Duration::from_secs(5)).await;

        let front = Arc::new(tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay"));
        let relay = front.local_addr().expect("relay addr");
        let back = Arc::new(tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay"));
        back.connect(("127.0.0.1", port)).await.expect("relay upstream");
        let delivered = Arc::new(std::sync::Mutex::new(Vec::new()));
        let answered = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (to_server, from_server) = (delivered.clone(), answered.clone());
        tokio::spawn(async move {
            let (mut up, mut down) = (vec![0u8; 65536], vec![0u8; 65536]);
            let mut client = None;
            let mut first_answer: Option<tokio::time::Instant> = None;
            loop {
                tokio::select! {
                    Ok((n, from)) = front.recv_from(&mut up) => {
                        client = Some(from);
                        let (back, d, log) = (back.clone(), up[..n].to_vec(), to_server.clone());
                        tokio::spawn(async move {
                            tokio::time::sleep(one_way).await;
                            log.lock().unwrap().push(tokio::time::Instant::now());
                            back.send(&d).await.ok();
                        });
                    }
                    Ok(n) = back.recv(&mut down) => {
                        let now = tokio::time::Instant::now();
                        from_server.lock().unwrap().push((now, n));
                        if now - *first_answer.get_or_insert(now) < swallow {
                            continue;
                        }
                        let (front, d, to) = (front.clone(), down[..n].to_vec(), client);
                        tokio::spawn(async move {
                            tokio::time::sleep(one_way).await;
                            if let Some(to) = to {
                                front.send_to(&d, to).await.ok();
                            }
                        });
                    }
                }
            }
        });

        let endpoint = quinn_client(&pinned(fx.cert_hash), Some(Duration::from_millis(100)));
        let start = std::time::Instant::now();
        let _connection = tokio::time::timeout(
            Duration::from_secs(5),
            endpoint.connect(relay, "localhost").expect("connect"),
        )
        .await
        .expect("no handshake in 5 s")
        .expect("client side of the handshake");
        let handshake = start.elapsed();
        server.abort();
        let answered = answered.lock().unwrap().clone();
        let mut rounds: Vec<tokio::time::Instant> = Vec::new();
        for &at in delivered.lock().unwrap().iter() {
            if rounds.last().is_none_or(|&last| at - last > one_way) {
                rounds.push(at);
            }
        }
        let bytes_after = rounds
            .iter()
            .map(|&at| answered.iter().filter(|(t, _)| *t >= at && *t < at + one_way).map(|(_, n)| n).sum())
            .collect();
        (handshake, bytes_after)
    }

    /// A server whose first flight is lost resends it when the client repeats its Initial, at
    /// 300 ms, not at its own probe timeout near 1 s. Without `--reply-repeated-initial` the
    /// handshake takes over a second. docs/transport/transport-conclusions.md §3, Answering a
    /// repeated Initial.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_repeated_initial_draws_the_lost_flight_at_once() {
        let tuning = TransportTuning { reply_repeated_initial: true, ..TransportTuning::default() };
        let one_way = Duration::from_millis(25);
        let (handshake, bytes_after) = dial_with_first_answers_swallowed(tuning, one_way, one_way).await;
        assert!(bytes_after.len() >= 2, "the client never repeated its Initial: {bytes_after:?}");
        assert!(bytes_after[1] >= 1200, "the repeat drew {} bytes, not the flight", bytes_after[1]);
        assert!(handshake < Duration::from_millis(700), "handshake took {handshake:?}: the flight waited for the server's PTO");
    }

    /// The reply is once a connection: with the first flight and its resend both lost, the
    /// client's second repeat draws only an ACK, and the flight waits for the server's PTO.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_second_repeated_initial_draws_only_an_ack() {
        let tuning = TransportTuning { reply_repeated_initial: true, ..TransportTuning::default() };
        let (_, bytes_after) =
            dial_with_first_answers_swallowed(tuning, Duration::from_millis(25), Duration::from_millis(500)).await;
        assert!(bytes_after.len() >= 3, "the client repeated its Initial fewer than twice: {bytes_after:?}");
        assert!(bytes_after[1] >= 1200, "the first repeat drew {} bytes, not the flight", bytes_after[1]);
        assert!(bytes_after[2] < 1200, "the second repeat drew {} bytes, more than an ACK", bytes_after[2]);
    }

    /// A client whose ClientHello spans two datagrams, the second arriving after the server has
    /// answered the first, still gets a session: the stream budget the client's transport
    /// parameters grant is there when it opens. Opened from the first datagram, as
    /// `patches/wtransport-0.7.2-settings-in-handshake.patch` did until it waited for the whole
    /// ClientHello, the server never sends SETTINGS. `docs/ARCHITECTURE.md` §Early SETTINGS.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_client_hello_in_two_datagrams_still_gets_its_session() {
        let fx = Fixture::new(1);
        let port = fx.port;
        let server = tokio::spawn(run_server(fx.config()));
        until_bound(port, Duration::from_secs(5)).await;

        // The client's second datagram is held 100 ms; every other passes at once.
        let front = Arc::new(tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay"));
        let relay = front.local_addr().expect("relay addr");
        let back = Arc::new(tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay"));
        back.connect(("127.0.0.1", port)).await.expect("relay upstream");
        tokio::spawn(async move {
            let (mut up, mut down) = (vec![0u8; 65536], vec![0u8; 65536]);
            let (mut client, mut sent) = (None, 0);
            loop {
                tokio::select! {
                    Ok((n, from)) = front.recv_from(&mut up) => {
                        client = Some(from);
                        sent += 1;
                        let (back, d) = (back.clone(), up[..n].to_vec());
                        let hold = if sent == 2 { Duration::from_millis(100) } else { Duration::ZERO };
                        tokio::spawn(async move {
                            tokio::time::sleep(hold).await;
                            back.send(&d).await.ok();
                        });
                    }
                    Ok(n) = back.recv(&mut down) => {
                        if let Some(to) = client {
                            front.send_to(&down[..n], to).await.ok();
                        }
                    }
                }
            }
        });

        let endpoint = client(long_hello(fx.cert_hash));
        tokio::time::timeout(Duration::from_secs(3), endpoint.connect(format!("https://{relay}/")))
            .await
            .expect("no session in 3 s: the server's SETTINGS never left")
            .expect("session");
        server.abort();
    }

    /// The server's half-RTT flight is at most two datagrams, its NEW_CONNECTION_IDs and the
    /// control stream in one packet, inside the four Firefox keeps before it can decrypt them
    /// (neqo's `SavedDatagrams::CAPACITY`). Written in pieces, the control stream left in up to
    /// four packets whenever quinn's driver ran beside the writer; Firefox dropped the fifth, and
    /// its loss held the fill near the initial window for seconds.
    /// docs/transport/transport-conclusions.md §3, Firefox's 6 s stall.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_half_rtt_flight_fits_what_a_client_keeps_undecrypted() {
        const DIALS: usize = 40;
        let fx = Fixture::new(1);
        let server = tokio::spawn(run_server(fx.config()));
        until_bound(fx.port, Duration::from_secs(5)).await;
        let mut flights = Vec::new();
        for _ in 0..DIALS {
            flights.push(half_rtt_datagrams(fx.port, fx.cert_hash).await);
        }
        server.abort();
        let worst = flights.iter().max().copied().unwrap_or(0);
        assert!(flights.iter().all(|&n| n > 0), "a dial saw no 1-RTT datagram in the first flight: {flights:?}");
        assert!(worst <= 2, "a half-RTT flight of {worst} datagrams carrying 1-RTT packets: {flights:?}");
    }

    /// One dial through a relay that holds the server's datagrams 50 ms, so nothing the server
    /// sends in that span answers the client: the datagrams of its first flight that carry a
    /// 1-RTT packet.
    async fn half_rtt_datagrams(port: u16, cert_hash: [u8; 32]) -> usize {
        const HOLD: Duration = Duration::from_millis(50);
        // Firefox's ClientHello spans two datagrams, the second 3.4 ms behind the first here.
        const HELLO_GAP: Duration = Duration::from_micros(3400);
        let front = Arc::new(tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay"));
        let relay = front.local_addr().expect("relay addr");
        let back = Arc::new(tokio::net::UdpSocket::bind("127.0.0.1:0").await.expect("relay"));
        back.connect(("127.0.0.1", port)).await.expect("relay upstream");
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = seen.clone();
        let relaying = tokio::spawn(async move {
            let (mut up, mut down) = (vec![0u8; 65536], vec![0u8; 65536]);
            let (mut client, mut sent) = (None, 0);
            loop {
                tokio::select! {
                    Ok((n, from)) = front.recv_from(&mut up) => {
                        client = Some(from);
                        sent += 1;
                        if sent == 2 {
                            tokio::time::sleep(HELLO_GAP).await;
                        }
                        back.send(&up[..n]).await.ok();
                    }
                    Ok(n) = back.recv(&mut down) => {
                        log.lock().unwrap().push((tokio::time::Instant::now(), carries_one_rtt(&down[..n])));
                        let (front, d, to) = (front.clone(), down[..n].to_vec(), client);
                        tokio::spawn(async move {
                            tokio::time::sleep(HOLD).await;
                            if let Some(to) = to {
                                front.send_to(&d, to).await.ok();
                            }
                        });
                    }
                }
            }
        });
        let endpoint = quinn_client(&long_hello(cert_hash), None);
        let connection = tokio::time::timeout(Duration::from_secs(5), endpoint.connect(relay, "localhost").expect("connect"))
            .await
            .expect("no handshake in 5 s")
            .expect("client side of the handshake");
        tokio::time::sleep(HOLD).await;
        connection.close(0u32.into(), b"");
        relaying.abort();
        let seen = seen.lock().unwrap().clone();
        let first = seen.first().map(|(at, _)| *at).expect("the server answered nothing");
        seen.iter().filter(|(at, one_rtt)| *at < first + HOLD && *one_rtt).count()
    }

    /// RFC 9000 §17: a datagram's packets in turn, long headers skipped by their Length, until a
    /// short header — always the last.
    fn carries_one_rtt(mut datagram: &[u8]) -> bool {
        fn varint(b: &[u8]) -> (usize, usize) {
            let len = 1 << (b[0] >> 6);
            (b[1..len].iter().fold(usize::from(b[0] & 0x3f), |v, &x| v << 8 | usize::from(x)), len)
        }
        while let Some(&first) = datagram.first() {
            if first & 0x80 == 0 {
                return true;
            }
            let mut at = 5;
            at += 1 + usize::from(datagram[at]);
            at += 1 + usize::from(datagram[at]);
            if first & 0x30 == 0 {
                let (token, n) = varint(&datagram[at..]);
                at += n + token;
            }
            let (length, n) = varint(&datagram[at..]);
            datagram = &datagram[(at + n + length).min(datagram.len())..];
        }
        false
    }

    /// A server on a series of `frames` frames, and one session on it: `body` gets its control
    /// stream and its shared media stream.
    async fn wire_test<F, Fut>(frames: u32, body: F)
    where
        F: FnOnce(SendStream, RecvStream) -> Fut,
        Fut: Future<Output = ()>,
    {
        let fx = Fixture::new(frames);
        let server = tokio::spawn(run_server(fx.config()));
        let connection = dial(fx.port, fx.cert_hash, "").await;
        let (control, _control_recv) = open_control(&connection).await;
        let media = connection.accept_uni().await.expect("accept media uni");
        body(control, media).await;
        server.abort();
    }

    /// `StreamFrames { from, to }` recites that range, nothing outside it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stream_frames_range_arrives_in_order() {
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
        })
        .await;
    }

    /// `StreamFrames {}` recites the whole series, in order, and nothing past it.
    /// `docs/adr/disk-access.md`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn empty_stream_frames_is_the_whole_series() {
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
            assert!(extra.is_err(), "fill sent a frame past the series");
        })
        .await;
    }

    /// `EndStream` after the fill has started stops it before the series ends.
    /// Does not pin the last frame delivered — QUIC may already hold one.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn end_stream_stops_a_fill_on_the_wire() {
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
        })
        .await;
    }

    /// A data request during a fill ends the fill and is then served.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn request_frame_during_fill_switches_to_on_demand() {
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
        })
        .await;
    }

    /// **The WebSocket path.** Binary messages, joined, are the shared uni stream's bytes — each
    /// frame whole, in fill order, its codestream split across messages so a client sees it move —
    /// and a refusal comes back as a text message holding FoD's JSON. `docs/ARCHITECTURE.md`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_websocket_carries_the_same_envelopes_and_refusals() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;

        let frames = 3u32;
        let fx = Fixture::new(frames);
        let server = tokio::spawn(run_server(ServeConfig { websocket: true, ..fx.config() }));
        against(server, async {
            let mut ws = ws_dial(fx.port, &fx.cert_pem, "").await;

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
        })
        .await;
    }
}
