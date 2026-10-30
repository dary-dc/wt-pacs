//! The same envelopes and FoD messages over one WebSocket on TCP, beside QUIC, for a client UDP
//! cannot reach. Binary messages, joined, are the shared uni stream's bytes; a text message is one
//! FoD message's JSON. `docs/WIRE.md` §The WebSocket mapping.

use crate::transport::link::Link;
use crate::transport::server::{forward, parse_opening_ask, Sessions};
use crate::transport::wire::MAX_FOD_LEN;
use anyhow::{bail, Context, Result};
use bytes::Bytes;
use fod::{decode_fod_body, FodMsg};
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use socket2::{SockRef, TcpKeepalive};
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::server::TlsStream;
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{self, Message};
use tokio_tungstenite::WebSocketStream;
use tracing::{info, warn};

type Socket = WebSocketStream<TlsStream<TcpStream>>;

/// Codestream bytes per binary message. A browser hands a message over only whole, so this is
/// the grain at which the client sees a frame's bytes move.
const CHUNK: usize = 64 * 1024;

/// TLS and the upgrade together; a peer silent past this holds a task and a descriptor for nothing.
pub(crate) const HANDSHAKE: Duration = Duration::from_secs(10);

/// Probes after 20 s idle, 4 of them 5 s apart: a peer that vanished fails its session's read. docs/WIRE.md
const KEEPALIVE: TcpKeepalive = TcpKeepalive::new()
    .with_time(Duration::from_secs(20))
    .with_interval(Duration::from_secs(5))
    .with_retries(4);

/// An accept that fails, as on `EMFILE`, fails again at once: this pause is what keeps the loop off a core.
const ACCEPT_RETRY: Duration = Duration::from_millis(100);

/// A session's one writer, for its frames and its refusals alike; every write is on the session task.
pub(crate) struct WsWriter(SplitSink<Socket, Message>);

impl WsWriter {
    pub(crate) async fn send_frame(&mut self, head: Bytes, body: Bytes) -> Result<()> {
        let sink = &mut self.0;
        sink.feed(Message::Binary(head)).await.context("write frame")?;
        for at in (0..body.len()).step_by(CHUNK) {
            let chunk = body.slice(at..body.len().min(at + CHUNK));
            sink.feed(Message::Binary(chunk)).await.context("write frame")?;
        }
        sink.flush().await.context("write frame")
    }

    pub(crate) async fn send_fod(&mut self, msg: &FodMsg) -> Result<()> {
        let json = serde_json::to_string(msg).context("serialize FodMsg")?;
        self.0.send(Message::text(json)).await.context("write FoD")
    }

    pub(crate) async fn close(&mut self) {
        let _ = self.0.close().await;
    }
}

/// Binds TCP on the QUIC endpoint's port number, so a client derives one URL from the other,
/// unless a listener is `held` already.
pub(crate) async fn bind(
    ip: Option<IpAddr>,
    port: u16,
    held: Option<&std::net::TcpListener>,
    cert_pem: &Path,
    key_pem: &Path,
) -> Result<(TcpListener, TlsAcceptor)> {
    let any = SocketAddr::new(ip.unwrap_or(IpAddr::V6(Ipv6Addr::UNSPECIFIED)), port);
    let listener = match held {
        Some(held) => held
            .try_clone()
            .and_then(|l| l.set_nonblocking(true).and_then(|()| TcpListener::from_std(l))),
        None => match TcpListener::bind(any).await {
            Err(_) if ip.is_none() => TcpListener::bind(("0.0.0.0", port)).await,
            bound => bound,
        },
    }
    .with_context(|| format!("WebSocket listener on TCP port {port}"))?;
    Ok((listener, tls_acceptor(cert_pem, key_pem)?))
}

fn tls_acceptor(cert_pem: &Path, key_pem: &Path) -> Result<TlsAcceptor> {
    let chain = CertificateDer::pem_file_iter(cert_pem)
        .and_then(|certs| certs.collect::<Result<Vec<_>, _>>())
        .with_context(|| format!("certificates from {}", cert_pem.display()))?;
    let key = PrivateKeyDer::from_pem_file(key_pem)
        .with_context(|| format!("private key from {}", key_pem.display()))?;
    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .context("TLS config for the WebSocket listener")?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(TlsAcceptor::from(Arc::new(config)))
}

pub(super) async fn serve(listener: TcpListener, tls: TlsAcceptor, sessions: Sessions) {
    loop {
        let tcp = match accept(&listener).await {
            Ok(tcp) => tcp,
            Err(err) => {
                warn!(%err, "WebSocket accept failed");
                tokio::time::sleep(ACCEPT_RETRY).await;
                continue;
            }
        };
        let (tls, sessions) = (tls.clone(), sessions.clone());
        tokio::spawn(async move {
            if let Err(err) = session(tcp, tls, sessions).await {
                warn!(err = %format_args!("{err:#}"), "WebSocket session ended");
            }
        });
    }
}

async fn accept(listener: &TcpListener) -> std::io::Result<TcpStream> {
    let (tcp, _) = listener.accept().await?;
    tcp.set_nodelay(true)?;
    SockRef::from(&tcp).set_tcp_keepalive(&KEEPALIVE)?;
    Ok(tcp)
}

pub(super) async fn session(tcp: TcpStream, tls: TlsAcceptor, sessions: Sessions) -> Result<()> {
    let mut opening = None;
    let read_ask = |request: &Request, response: Response| {
        if sessions.opening_ask {
            opening = parse_opening_ask(&request.uri().to_string(), sessions.store.frame_count());
        }
        Ok(response)
    };
    let handshake = async {
        let tls = tls.accept(tcp).await.context("TLS handshake")?;
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_FOD_LEN))
            .max_frame_size(Some(MAX_FOD_LEN));
        tokio_tungstenite::accept_hdr_async_with_config(tls, read_ask, Some(config))
            .await
            .context("WebSocket upgrade")
    };
    let socket = tokio::time::timeout(HANDSHAKE, handshake)
        .await
        .context("WebSocket handshake deadline")??;
    let (sink, mut stream) = socket.split();
    let product = sessions.pipeline(Link::WebSocket(WsWriter(sink)));
    let closed = Arc::new(AtomicBool::new(false));
    let saw_close = Arc::clone(&closed);
    let read = |tx| async move {
        loop {
            let msg = next_fod(&mut stream).await;
            saw_close.store(matches!(msg, Ok(None)), Ordering::Relaxed);
            if forward(msg, &tx).await.is_break() {
                break;
            }
        }
    };
    // Served right behind the 101, a round trip before the client's first message could land.
    match sessions.serve(product, opening, read).await {
        Err(err) if closed.load(Ordering::Relaxed) && on_the_socket(&err) => {
            info!(err = %format_args!("{err:#}"), "WebSocket session closed by peer");
            Ok(())
        }
        result => result,
    }
}

/// A client's Close can only explain a failure on the socket, never a read from disk.
fn on_the_socket(err: &anyhow::Error) -> bool {
    err.chain().any(|e| e.downcast_ref::<tungstenite::Error>().is_some())
}

/// `None` once the client has closed the socket.
async fn next_fod(stream: &mut SplitStream<Socket>) -> Result<Option<FodMsg>> {
    loop {
        match stream.next().await {
            Some(Ok(Message::Text(json))) => return decode_fod_body(json.as_bytes()).map(Some),
            // The library answers a ping itself.
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            Some(Ok(Message::Close(_))) | None => return Ok(None),
            Some(Ok(_)) => bail!("a binary message from the client: FoD travels as text"),
            Some(Err(err)) => return Err(err).context("read the WebSocket"),
        }
    }
}

#[cfg(test)]
mod tests;
