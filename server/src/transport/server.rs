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
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tracing::{info, warn};
use wtransport::config::IpBindConfig;
use wtransport::endpoint::endpoint_side;
use wtransport::stream::RecvStream;
use wtransport::{Endpoint, Identity, ServerConfig, VarInt};

#[cfg(feature = "lab-levers")]
use crate::transport::lab_levers::{self, LabLevers, SessionLevers};
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
    /// How frames reach the client: `shared` or `per-frame`.
    #[arg(long = "stream-mode", value_name = "STREAM_MODE", value_enum, default_value_t = StreamMode::Shared)]
    pub mode: StreamMode,
    /// Bind address for the QUIC endpoint. Default: dual-stack `[::]`, falling back to `0.0.0.0`
    /// when the host has no IPv6.
    #[arg(long)]
    pub bind: Option<IpAddr>,
    #[command(flatten)]
    pub tuning: TransportTuning,
    /// Honour `?ask=frame:N` / `?ask=fill:A-B` in the session URL; `--opening-ask false` turns it off. docs/ARCHITECTURE.md
    #[arg(long, default_value_t = true, num_args = 0..=1, default_missing_value = "true", action = clap::ArgAction::Set)]
    pub opening_ask: bool,
    /// Also serve the same envelopes over a WebSocket, TCP on `--port`. docs/WIRE.md §The WebSocket mapping
    #[arg(long, default_value_t = false)]
    pub websocket: bool,
    #[cfg(feature = "lab-levers")]
    #[command(flatten)]
    pub lab: LabLevers,
}

/// `H3_NO_ERROR`, HTTP/3's code for a graceful close.
const STOPPING: VarInt = VarInt::from_u32(0x100);

/// Serves until `stop`, then closes every session with `STOPPING` and waits up to 250 ms for them. deploy/README.md
pub async fn run_server(config: ServeConfig, stop: impl Future<Output = ()>) -> Result<()> {
    #[cfg(feature = "lab-levers")]
    let config = lab_levers::apply(config);
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

    let store = FrameStore::open(&config.series_path).context("open series")?;
    #[cfg(feature = "lab-levers")]
    let store = config.lab.forcing_misses(store);
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
    #[cfg(feature = "lab-levers")]
    let hold = config.lab.hold_sessions;
    let mut stop = std::pin::pin!(stop);
    loop {
        let incoming = tokio::select! {
            incoming = endpoint.accept() => incoming,
            () = &mut stop => break,
        };
        let sessions = sessions.clone();
        tokio::spawn(async move {
            #[cfg(feature = "lab-levers")]
            if hold {
                return lab_levers::hold_session(incoming).await;
            }
            if let Err(err) = handle_incoming(incoming, sessions).await {
                warn!(err = %format_args!("{err:#}"), "session ended");
            }
        });
    }
    endpoint.close(STOPPING, b"server stopping");
    let _ = tokio::time::timeout(Duration::from_millis(250), endpoint.wait_idle()).await;
    Ok(())
}

/// What every session is served with, fixed at start.
#[derive(Clone)]
pub(super) struct Sessions {
    pub(super) store: Arc<FrameStore>,
    read_mode: ReadMode,
    pub(super) mode: StreamMode,
    pub(super) opening_ask: bool,
    #[cfg(feature = "lab-levers")]
    pub(super) lab: SessionLevers,
    #[cfg(feature = "telemetry")]
    taps: Arc<dyn Fn() -> Option<Tap> + Send + Sync>,
}

impl Sessions {
    fn new(config: &ServeConfig, store: Arc<FrameStore>) -> Self {
        let read_mode = ReadMode::parse(std::env::var("WTPACS_READ_PATH").ok().as_deref())
            .unwrap_or_else(|err| {
                warn!("{err}; using auto");
                ReadMode::Auto
            });
        Sessions {
            #[cfg(feature = "lab-levers")]
            lab: config.lab.session_levers(&store),
            store,
            read_mode,
            mode: config.mode,
            opening_ask: config.opening_ask,
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

    let link = |control| Link::quic(&sessions, connection.clone(), control);
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
mod tests;
