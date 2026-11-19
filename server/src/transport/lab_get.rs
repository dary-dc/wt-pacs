//! Lab only: the series' frames by HTTP GET, for the transport comparison. HTTP/3 on a quinn endpoint of
//! its own with the session's transport config, HTTP/2 over TLS on TCP, both on `--lab-get-port`. A body is
//! envelopes as the shared stream carries them. docs/transport/evidence/stacks.md §5.6, lab/transport-arms/README.md

use crate::media::frame_store::FrameStore;
use crate::media::read_path::{FillReader, ReadMode, TileReader, TILE_SLOTS};
use crate::transport::tuning::TransportTuning;
use anyhow::{Context, Result};
use bytes::{Buf, Bytes};
use frame_envelope::frame_head;
use http::{Response, StatusCode};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use socket2::SockRef;
use std::sync::{Arc, OnceLock};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tracing::{info, warn};
use wtransport::{quinn, Identity};

#[derive(clap::Args, Clone, Debug, Default, PartialEq)]
pub struct LabGet {
    /// Lab only: serve `GET /frames/K` and `/frames/K-N` by HTTP/3 (UDP) and HTTP/2 (TCP) on this port.
    #[arg(long = "lab-get-port", value_name = "PORT")]
    pub port: Option<u16>,
    /// Lab only: files served beside the frames, so a page's origin can be the frame server's.
    #[arg(long = "lab-get-static", value_name = "DIR")]
    pub static_dir: Option<PathBuf>,
    /// Lab only, a mutant: every body leaves this frame out.
    #[arg(long = "lab-get-drop", value_name = "FRAME")]
    pub drop: Option<u32>,
    /// Lab only: the congestion controller of every TCP socket accepted, the GET path's HTTP/2 and the WebSocket's.
    #[arg(long = "lab-tcp-congestion", value_name = "NAME")]
    pub tcp_congestion: Option<String>,
}

static TCP_CONGESTION: OnceLock<String> = OnceLock::new();

/// Gives an accepted socket `--lab-tcp-congestion`'s controller, if one is named.
pub(crate) fn set_congestion(tcp: &TcpStream) -> std::io::Result<()> {
    match TCP_CONGESTION.get() {
        Some(name) => SockRef::from(tcp).set_tcp_congestion(name.as_bytes()),
        None => Ok(()),
    }
}

/// What one GET asks for.
#[derive(Debug, PartialEq)]
enum Route {
    Frame(u32),
    /// Both ends included.
    Range(u32, u32),
    File(PathBuf),
}

fn route(path: &str, frames: u32) -> Option<Route> {
    let path = path.split('?').next().unwrap_or("");
    if let Some(name) = path.strip_prefix("/frames/") {
        let frame = |s: &str| s.parse::<u32>().ok().filter(|&f| f < frames);
        return match name.split_once('-') {
            Some((from, to)) => Some(Route::Range(frame(from)?, frame(to)?)).filter(|r| matches!(r, Route::Range(a, b) if a <= b)),
            None => Some(Route::Frame(frame(name)?)),
        };
    }
    let rel = Path::new(path.trim_start_matches('/'));
    rel.components().all(|c| matches!(c, Component::Normal(_))).then(|| Route::File(rel.to_path_buf()))
}

#[derive(Clone)]
struct Served {
    store: Arc<FrameStore>,
    static_dir: Option<PathBuf>,
    drop: Option<u32>,
}

/// Binds both listeners and serves until the process ends.
pub(crate) async fn spawn(lab: &LabGet, tuning: &TransportTuning, identity: &Identity, cert_pem: &Path, key_pem: &Path, store: Arc<FrameStore>) -> Result<()> {
    if let Some(name) = &lab.tcp_congestion {
        // Refused here, at start, rather than on each accept: the kernel may not have it, or may not allow it.
        socket2::Socket::new(socket2::Domain::IPV4, socket2::Type::STREAM, None)?
            .set_tcp_congestion(name.as_bytes())
            .with_context(|| format!("--lab-tcp-congestion {name}"))?;
        TCP_CONGESTION.set(name.clone()).ok();
        warn!(congestion = %name, "lab: every accepted TCP socket runs this congestion controller");
    }
    let Some(port) = lab.port else { return Ok(()) };
    let served = Served { store, static_dir: lab.static_dir.clone(), drop: lab.drop };
    let addr = SocketAddr::new(Ipv4Addr::UNSPECIFIED.into(), port);
    let mut tls = wtransport::tls::server::build_default_tls_config(identity.clone_identity());
    tls.alpn_protocols = vec![b"h3".to_vec()];
    let mut quic = quinn::ServerConfig::with_crypto(Arc::new(quinn::crypto::rustls::QuicServerConfig::try_from(tls)?));
    quic.transport_config(Arc::new(tuning.to_transport_config()?));
    let endpoint = quinn::Endpoint::server(quic, addr).with_context(|| format!("lab GET: HTTP/3 on UDP {port}"))?;
    let tcp = TcpListener::bind(addr).await.with_context(|| format!("lab GET: HTTP/2 on TCP {port}"))?;
    let acceptor = h2_acceptor(cert_pem, key_pem)?;
    warn!(port, drop = ?lab.drop, "lab GET path: HTTP/3 and HTTP/2 on this port; a lab flag, not a deployment one");
    tokio::spawn(serve_h3(endpoint, served.clone()));
    tokio::spawn(serve_h2(tcp, acceptor, served));
    Ok(())
}

fn h2_acceptor(cert_pem: &Path, key_pem: &Path) -> Result<TlsAcceptor> {
    let chain = CertificateDer::pem_file_iter(cert_pem).and_then(|c| c.collect::<Result<Vec<_>, _>>()).context("certificates")?;
    let key = PrivateKeyDer::from_pem_file(key_pem).context("private key")?;
    let mut config = rustls::ServerConfig::builder_with_protocol_versions(&[&rustls::version::TLS13])
        .with_no_client_auth()
        .with_single_cert(chain, key)?;
    config.alpn_protocols = vec![b"h2".to_vec()];
    Ok(TlsAcceptor::from(Arc::new(config)))
}

async fn serve_h3(endpoint: quinn::Endpoint, served: Served) {
    while let Some(incoming) = endpoint.accept().await {
        let served = served.clone();
        tokio::spawn(async move {
            if let Err(err) = h3_connection(incoming, served).await {
                info!(err = %format_args!("{err:#}"), "lab GET: HTTP/3 connection ended");
            }
        });
    }
}

async fn h3_connection(incoming: quinn::Incoming, served: Served) -> Result<()> {
    let conn = incoming.await.context("QUIC handshake")?;
    let mut h3 = h3::server::Connection::<_, Bytes>::new(h3_quinn::Connection::new(conn)).await?;
    while let Some(resolver) = h3.accept().await? {
        let served = served.clone();
        tokio::spawn(async move {
            let Ok((req, mut stream)) = resolver.resolve_request().await else { return };
            let mut sink = Sink::H3(&mut stream);
            match respond(req.uri().path(), &served, &mut sink).await {
                Ok(()) => drop(stream.finish().await),
                Err(err) => info!(err = %format_args!("{err:#}"), "lab GET: HTTP/3 response cut"),
            }
        });
    }
    Ok(())
}

async fn serve_h2(listener: TcpListener, acceptor: TlsAcceptor, served: Served) {
    loop {
        let Ok((tcp, _)) = listener.accept().await else { continue };
        let _ = tcp.set_nodelay(true);
        if let Err(err) = set_congestion(&tcp) {
            warn!(%err, "lab GET: the congestion controller was refused; connection dropped");
            continue;
        }
        let (acceptor, served) = (acceptor.clone(), served.clone());
        tokio::spawn(async move {
            if let Err(err) = h2_connection(tcp, acceptor, served).await {
                info!(err = %format_args!("{err:#}"), "lab GET: HTTP/2 connection ended");
            }
        });
    }
}

async fn h2_connection(tcp: TcpStream, acceptor: TlsAcceptor, served: Served) -> Result<()> {
    let tls = acceptor.accept(tcp).await.context("TLS handshake")?;
    let mut conn = h2::server::handshake(tls).await?;
    while let Some(next) = conn.accept().await {
        let (req, mut respond_to) = next?;
        let served = served.clone();
        tokio::spawn(async move {
            let mut sink = Sink::H2(&mut respond_to, None);
            match respond(req.uri().path(), &served, &mut sink).await {
                Ok(()) => {
                    if let Sink::H2(_, Some(send)) = &mut sink {
                        drop(send.send_data(Bytes::new(), true));
                    }
                }
                Err(err) => info!(err = %format_args!("{err:#}"), "lab GET: HTTP/2 response cut"),
            }
        });
    }
    Ok(())
}

/// Where one response goes: an HTTP/3 request stream, or an HTTP/2 stream once its head is sent.
enum Sink<'a> {
    H3(&'a mut h3::server::RequestStream<h3_quinn::BidiStream<Bytes>, Bytes>),
    H2(&'a mut h2::server::SendResponse<Bytes>, Option<h2::SendStream<Bytes>>),
}

impl Sink<'_> {
    async fn head(&mut self, response: Response<()>) -> Result<()> {
        match self {
            Sink::H3(stream) => Ok(stream.send_response(response).await?),
            Sink::H2(respond, send) => Ok(*send = Some(respond.send_response(response, false)?)),
        }
    }

    /// HTTP/2 writes as the peer's flow control grants, so a body is read from disk no faster than it leaves.
    async fn data(&mut self, mut chunk: Bytes) -> Result<()> {
        match self {
            Sink::H3(stream) => Ok(stream.send_data(chunk).await?),
            Sink::H2(_, send) => {
                let send = send.as_mut().context("no head sent")?;
                while chunk.has_remaining() {
                    send.reserve_capacity(chunk.len());
                    let granted = std::future::poll_fn(|cx| send.poll_capacity(cx)).await.context("stream reset")??;
                    send.send_data(chunk.split_to(granted.min(chunk.len())), false)?;
                }
                Ok(())
            }
        }
    }
}

/// One response: the head, then the body envelope by envelope, read as the WebTransport path reads.
async fn respond(path: &str, served: &Served, sink: &mut Sink<'_>) -> Result<()> {
    let store = &served.store;
    let found = route(path, store.frame_count());
    let file = match &found {
        Some(Route::File(rel)) => served.static_dir.as_ref().and_then(|d| std::fs::read(d.join(rel)).ok()),
        _ => None,
    };
    let status = match (&found, &file) {
        (Some(Route::File(_)), None) | (None, _) => StatusCode::NOT_FOUND,
        _ => StatusCode::OK,
    };
    let kind = match &found {
        Some(Route::File(rel)) => content_type(rel),
        _ => "application/octet-stream",
    };
    let response = Response::builder()
        .status(status)
        .header("content-type", kind)
        .header("cache-control", "no-store")
        .header("access-control-allow-origin", "*")
        // Without it a cross-origin page's `nextHopProtocol` reads empty, and the arm's protocol goes unchecked.
        .header("timing-allow-origin", "*")
        // A static page here is cross-origin isolated, as the dev host's are: the downloader writes pixels into shared memory.
        .header("cross-origin-opener-policy", "same-origin")
        .header("cross-origin-embedder-policy", "require-corp")
        .header("cross-origin-resource-policy", "cross-origin")
        .body(())?;
    sink.head(response).await?;
    let frames: Vec<u32> = match found {
        Some(Route::Frame(f)) => vec![f],
        Some(Route::Range(from, to)) => (from..=to).collect(),
        _ => {
            if let Some(body) = file {
                sink.data(Bytes::from(body)).await?;
            }
            return Ok(());
        }
    };
    let frames: Vec<u32> = frames.into_iter().filter(|&f| Some(f) != served.drop).collect();
    let mut fill = (frames.len() > 1).then(|| FillReader::new(Arc::clone(store)));
    let mut tile = TileReader::new(ReadMode::Auto, Arc::clone(store), TILE_SLOTS);
    for (at, &frame) in frames.iter().enumerate() {
        let span = store.frame_span(frame);
        let body = match &mut fill {
            Some(fill) => fill.read(span, frames.get(at + 1).map(|&n| store.frame_span(n))).await?,
            None => tile.read(span, &[]).await?,
        };
        sink.data(Bytes::copy_from_slice(&frame_head(frame, body.len() as u32))).await?;
        sink.data(body).await?;
    }
    Ok(())
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript",
        Some("wasm") => "application/wasm",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A frame and a range are taken only whole and in range; a path that climbs out of the static root never is.
    #[test]
    fn routes_are_taken_whole_and_in_range() {
        assert_eq!(route("/frames/3", 10), Some(Route::Frame(3)));
        assert_eq!(route("/frames/2-9?x=1", 10), Some(Route::Range(2, 9)));
        assert_eq!(route("/frames/10", 10), None);
        assert_eq!(route("/frames/5-4", 10), None);
        assert_eq!(route("/frames/5-10", 10), None);
        assert_eq!(route("/frames/x", 10), None);
        assert_eq!(route("/lab/a.html", 10), Some(Route::File("lab/a.html".into())));
        assert_eq!(route("/../etc/passwd", 10), None);
    }

    /// An accepted socket runs the controller `--lab-tcp-congestion` names (reno: never a kernel's default here).
    #[tokio::test]
    async fn an_accepted_socket_takes_the_named_controller() {
        TCP_CONGESTION.set("reno".into()).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let _client = TcpStream::connect(listener.local_addr().unwrap()).await.unwrap();
        let (tcp, _) = listener.accept().await.unwrap();
        set_congestion(&tcp).unwrap();
        let name = SockRef::from(&tcp).tcp_congestion().unwrap();
        assert_eq!(String::from_utf8_lossy(&name).trim_end_matches('\0'), "reno");
    }
}
