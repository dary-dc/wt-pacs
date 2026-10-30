//! A session over raw QUIC: `docs/WIRE.md`'s control stream and envelopes, on its own ALPN.
//! `docs/WIRE.md` §The raw QUIC mapping.

use anyhow::{anyhow, bail, Context, Result};
use bytes::Bytes;
use fod::{check_fod_len, decode_fod_body, encode_fod_msg, FodMsg};
use frame_envelope::{envelope_len, FRAME_HEAD_LEN, INDEX_LEN};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::{mpsc, Semaphore};
use wtransport::quinn;
use wtransport::tls::client::{build_default_tls_config, ServerHashVerification};
use wtransport::tls::{rustls::RootCertStore, Sha256Digest};

pub const ALPN: &[u8] = b"wt-pacs/1";

/// The receive credit the client grants, in bytes; Chromium's by default. `docs/native/README.md` §8.6.
pub struct Windows {
    pub stream: u64,
    pub connection: u64,
}

impl Default for Windows {
    fn default() -> Self {
        Self { stream: 6 << 20, connection: 15 << 20 }
    }
}

pub enum Event {
    /// `at` is when the envelope's last byte was read.
    Frame { index: u32, body: Bytes, at: Instant },
    Refused { frame: u32, reason: String },
}

pub struct Session {
    _endpoint: quinn::Endpoint,
    connection: quinn::Connection,
    control: quinn::SendStream,
    events: mpsc::Receiver<Result<Event>>,
}

/// The server's `cert_sha256=`, 64 hex digits.
pub fn cert_hash(hex: &str) -> Result<[u8; 32]> {
    let bytes = (0..32).map(|i| hex.get(2 * i..2 * i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()));
    bytes.collect::<Option<Vec<u8>>>().and_then(|h| h.try_into().ok()).context("--cert-sha256 is not 64 hex digits")
}

/// `url` is `https://host:port/`, as the server's banner prints it.
pub async fn dial(url: &str, cert_sha256: [u8; 32], windows: &Windows) -> Result<Session> {
    connect(url, cert_sha256, windows, ALPN, Semaphore::MAX_PERMITS).await
}

/// As `dial`, but a stream's reader stops once `held` events wait unread, so a slow consumer reaches the wire as
/// flow control.
pub async fn dial_bounded(url: &str, cert_sha256: [u8; 32], windows: &Windows, held: usize) -> Result<Session> {
    connect(url, cert_sha256, windows, ALPN, held).await
}

async fn connect(url: &str, cert_sha256: [u8; 32], windows: &Windows, alpn: &[u8], held: usize) -> Result<Session> {
    let authority = url.strip_prefix("https://").context("the URL is not https://")?.trim_end_matches('/');
    let addr = tokio::net::lookup_host(authority).await?.next().context("no address for the URL")?;
    let host = authority.rsplit_once(':').map_or(authority, |(host, _)| host).trim_matches(['[', ']']);
    let pin = ServerHashVerification::new([Sha256Digest::new(cert_sha256)]);
    let mut tls = build_default_tls_config(Arc::new(RootCertStore::empty()), Some(Arc::new(pin)));
    tls.alpn_protocols = vec![alpn.to_vec()];
    let mut transport = quinn::TransportConfig::default();
    transport.stream_receive_window(quinn::VarInt::from_u64(windows.stream)?);
    transport.receive_window(quinn::VarInt::from_u64(windows.connection)?);
    let mut config = quinn::ClientConfig::new(Arc::new(quinn::crypto::rustls::QuicClientConfig::try_from(tls)?));
    config.transport_config(Arc::new(transport));

    let endpoint = quinn::Endpoint::client(if addr.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" }.parse()?)?;
    let connection = endpoint.connect_with(config, addr, host)?.await.context("handshake")?;
    let (control, recv) = connection.open_bi().await.context("open control bidi")?;
    let (tx, events) = mpsc::channel(held);
    tokio::spawn(refusals(recv, tx.clone()));
    tokio::spawn(media(connection.clone(), tx));
    Ok(Session { _endpoint: endpoint, connection, control, events })
}

impl Session {
    pub async fn ask(&mut self, frame: u32) -> Result<()> {
        self.send(&FodMsg::RequestFrame { frame }).await
    }

    pub async fn fill(&mut self, from: u32, to: u32) -> Result<()> {
        self.send(&FodMsg::StreamFrames { from: Some(from), to: Some(to) }).await
    }

    /// `None` once the session has ended and every frame read has been handed on.
    pub async fn next(&mut self) -> Option<Result<Event>> {
        let event = self.events.recv().await;
        if let Some(Ok(Event::Frame { index, at, .. })) = &event {
            crate::count::hop(*index);
            crate::count::stamp("stream", *at);
            crate::count::arrived(*at);
        }
        event
    }

    pub fn close(&self) {
        self.connection.close(0u32.into(), b"done");
    }

    async fn send(&mut self, msg: &FodMsg) -> Result<()> {
        self.control.write_all(&encode_fod_msg(msg)?).await.context("write FoD")
    }
}

/// Every uni the server opens, each read on its own, so a frame waits on no other stream.
async fn media(connection: quinn::Connection, tx: mpsc::Sender<Result<Event>>) {
    while let Ok(mut uni) = connection.accept_uni().await {
        let tx = tx.clone();
        tokio::spawn(async move {
            loop {
                let event = match read_envelope(&mut uni).await {
                    Ok(Some((index, body))) => {
                        crate::count::touch(index);
                        Ok(Event::Frame { index, body, at: Instant::now() })
                    }
                    Ok(None) => return,
                    Err(err) => Err(err),
                };
                let failed = event.is_err();
                if tx.send(event).await.is_err() || failed {
                    return;
                }
            }
        });
    }
}

/// The server's `frame_error`s; it sends nothing else on the control stream.
async fn refusals(mut recv: quinn::RecvStream, tx: mpsc::Sender<Result<Event>>) {
    loop {
        let event = match read_fod(&mut recv).await {
            Ok(Some(FodMsg::FrameError { frame_index, reason })) => Ok(Event::Refused { frame: frame_index, reason }),
            Ok(Some(msg)) => Err(anyhow!("the server sent {msg:?} on the control stream")),
            Ok(None) => return,
            Err(err) => Err(err),
        };
        let failed = event.is_err();
        if tx.send(event).await.is_err() || failed {
            return;
        }
    }
}

/// `None` when the stream ended between envelopes; an end inside one names its frame. `docs/CLIENTS.md` §A truncated frame is a failure.
async fn read_envelope(stream: &mut (impl AsyncRead + Unpin)) -> Result<Option<(u32, Bytes)>> {
    let mut head = [0u8; FRAME_HEAD_LEN];
    match read_up_to(stream, &mut head).await? {
        0 => return Ok(None),
        FRAME_HEAD_LEN => {}
        n => bail!("the stream ended {n} bytes into an envelope's head"),
    }
    let len = envelope_len(head[..4].try_into()?).map_err(|e| anyhow!(e))?;
    let index = u32::from_be_bytes(head[4..].try_into()?);
    let mut body = vec![0u8; len - INDEX_LEN];
    let n = read_up_to(stream, &mut body).await?;
    if n < body.len() {
        bail!("frame {index} truncated: the stream ended after {n} of its {} bytes", body.len());
    }
    Ok(Some((index, body.into())))
}

async fn read_fod(recv: &mut quinn::RecvStream) -> Result<Option<FodMsg>> {
    let mut len = [0u8; 4];
    match read_up_to(recv, &mut len).await? {
        0 => return Ok(None),
        4 => {}
        n => bail!("the control stream ended {n} bytes into a FoD length"),
    }
    let len = u32::from_le_bytes(len) as usize;
    check_fod_len(len)?;
    let mut body = vec![0u8; len];
    if read_up_to(recv, &mut body).await? < len {
        bail!("the control stream ended inside a FoD message");
    }
    decode_fod_body(&body).map(Some)
}

/// How many bytes of `buf` were filled before the stream ended.
async fn read_up_to(stream: &mut (impl AsyncRead + Unpin), buf: &mut [u8]) -> Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match stream.read(&mut buf[filled..]).await? {
            0 => break,
            n => filled += n,
        }
    }
    Ok(filled)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use clap::Parser;
    use frame_envelope::frame_head;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/us_cine_smoke/us_cine_smoke.sbnd");

    /// Envelopes then an end between them read whole and in order; an end inside the head or the
    /// codestream is an error, and inside the codestream it names the frame.
    #[tokio::test]
    async fn an_envelope_is_read_whole_or_named_as_truncated() {
        let mut wire = Vec::new();
        for (index, body) in [(7u32, &b"seven"[..]), (2, b"")] {
            wire.extend_from_slice(&frame_head(index, body.len() as u32));
            wire.extend_from_slice(body);
        }
        let mut stream = &wire[..];
        assert_eq!(read_envelope(&mut stream).await.unwrap(), Some((7, Bytes::from_static(b"seven"))));
        assert_eq!(read_envelope(&mut stream).await.unwrap(), Some((2, Bytes::new())));
        assert_eq!(read_envelope(&mut stream).await.unwrap(), None);

        let cut = read_envelope(&mut &wire[..FRAME_HEAD_LEN + 3]).await.expect_err("a cut codestream was taken");
        assert!(cut.to_string().contains("frame 7 truncated"), "{cut}");
        assert!(read_envelope(&mut &wire[..5]).await.is_err(), "a cut head was taken");
    }

    #[derive(Parser)]
    struct Server {
        #[command(flatten)]
        serve: series_server::ServeConfig,
    }

    /// The server on `series`, on a loopback port, with a fresh certificate; its URL and pin.
    pub(crate) async fn serve(dir: &Path, series: &Path, mode: &str) -> (String, [u8; 32]) {
        let _ = wtransport::tls::rustls::crypto::ring::default_provider().install_default();
        let identity = wtransport::Identity::self_signed(["localhost", "127.0.0.1"]).expect("certificate");
        let (cert, key) = (dir.join("cert.pem"), dir.join("key.pem"));
        identity.certificate_chain().store_pemfile(&cert).await.expect("cert.pem");
        identity.private_key().store_secret_pemfile(&key).await.expect("key.pem");
        let port = std::net::UdpSocket::bind("127.0.0.1:0").and_then(|s| s.local_addr()).expect("free port").port();
        let [cert, key] = [cert, key].map(|p| p.display().to_string());
        let series = series.display().to_string();
        let args = ["s", "--series", &series, "--port", &port.to_string(), "--bind", "127.0.0.1"];
        let args = [&args[..], &["--cert-pem", &cert, "--key-pem", &key, "--stream-mode", mode]].concat();
        let config = Server::parse_from(args).serve;
        tokio::spawn(series_server::run_server(config, std::future::pending()));
        let hash = *identity.certificate_chain().as_slice()[0].hash().as_ref();
        (format!("https://127.0.0.1:{port}/"), hash)
    }

    pub(crate) fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("native-client-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        dir
    }

    fn bundle_frames() -> Vec<Vec<u8>> {
        use std::os::unix::fs::FileExt;
        let file = std::fs::File::open(FIXTURE).expect("fixture");
        let layout = series_bundle::read_layout(&file).expect("layout");
        let read = |&(offset, len): &(u64, u32)| {
            let mut frame = vec![0; len as usize];
            file.read_exact_at(&mut frame, offset).expect("frame");
            frame
        };
        layout.index.iter().map(read).collect()
    }

    /// What each client is sent, one at a time: a fill of the whole series, then asks out of
    /// order; and how many frames each brings.
    fn phases() -> [(FodMsg, usize); 4] {
        let ask = |frame| (FodMsg::RequestFrame { frame }, 1);
        [(FodMsg::StreamFrames { from: Some(0), to: Some(2) }, 3), ask(2), ask(0), ask(1)]
    }

    /// `(index, codestream)` in phase order; per-frame streams may land in any order within a fill.
    async fn native_frames(url: &str, hash: [u8; 32]) -> Vec<(u32, Vec<u8>)> {
        let windows = Windows::default();
        let mut session = until_up(|| dial(url, hash, &windows)).await;
        let mut got = Vec::new();
        for (msg, frames) in phases() {
            session.send(&msg).await.expect("FoD");
            let mut phase = Vec::new();
            while phase.len() < frames {
                phase.push(next_frame(&mut session).await);
            }
            phase.sort();
            got.extend(phase);
        }
        session.ask(99).await.expect("ask");
        let refused = tokio::time::timeout(Duration::from_secs(10), session.next()).await.expect("no refusal");
        assert!(matches!(refused, Some(Ok(Event::Refused { frame: 99, .. }))), "an out-of-range ask was not refused by name");
        session.close();
        got
    }

    async fn next_frame(session: &mut Session) -> (u32, Vec<u8>) {
        match tokio::time::timeout(Duration::from_secs(10), session.next()).await.expect("a frame stalled") {
            Some(Ok(Event::Frame { index, body, .. })) => (index, body.to_vec()),
            Some(Ok(Event::Refused { frame, reason })) => panic!("frame {frame} refused: {reason}"),
            Some(Err(err)) => panic!("{err:#}"),
            None => panic!("the session ended"),
        }
    }

    /// The same phases over a WebTransport session, its unis read in the order the server opened them.
    async fn webtransport_frames(url: &str, hash: [u8; 32]) -> Vec<(u32, Vec<u8>)> {
        use wtransport::{ClientConfig, Endpoint};
        let config = ClientConfig::builder()
            .with_bind_config(wtransport::config::IpBindConfig::InAddrAnyV4)
            .with_server_certificate_hashes([Sha256Digest::new(hash)])
            .build();
        let endpoint = Endpoint::client(config).expect("client");
        let connection = until_up(|| endpoint.connect(url)).await;
        let (mut control, _recv) = connection.open_bi().await.expect("bi").await.expect("bi ready");
        let (mut got, mut uni) = (Vec::new(), None);
        for (msg, frames) in phases() {
            control.write_all(&encode_fod_msg(&msg).unwrap()).await.expect("FoD");
            let mut phase = Vec::new();
            while phase.len() < frames {
                let stream = match &mut uni {
                    Some(stream) => stream,
                    None => uni.insert(connection.accept_uni().await.expect("uni")),
                };
                match read_envelope(stream).await.expect("envelope") {
                    Some((index, body)) => phase.push((index, body.to_vec())),
                    None => uni = None,
                }
            }
            phase.sort();
            got.extend(phase);
        }
        connection.close(0u32.into(), b"done");
        got
    }

    pub(crate) async fn until_up<T, E: std::fmt::Debug, F: std::future::Future<Output = Result<T, E>>>(dial: impl Fn() -> F) -> T {
        for _ in 0..50 {
            match dial().await {
                Ok(up) => return up,
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
        panic!("the server never answered");
    }

    /// **The two ALPNs get the same bytes.** On the committed fixture, in both stream modes, a
    /// fill and out-of-order asks reach the native client over raw QUIC exactly as they reach a
    /// WebTransport client from the same server, each frame byte-identical to the bundle's; an
    /// out-of-range ask is refused by name. `docs/native/README.md` §8.5.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_native_client_gets_webtransports_bytes() {
        let bundle = bundle_frames();
        for mode in ["shared", "per-frame"] {
            let dir = temp_dir(mode);
            let (url, hash) = serve(&dir, Path::new(FIXTURE), mode).await;
            let native = native_frames(&url, hash).await;
            let webtransport = webtransport_frames(&url, hash).await;
            std::fs::remove_dir_all(&dir).ok();
            assert_eq!(native, webtransport, "{mode}: the native client got other bytes than WebTransport");
            let order: Vec<u32> = native.iter().map(|(index, _)| *index).collect();
            assert_eq!(order, [0, 1, 2, 2, 0, 1], "{mode}: not the frames asked");
            for (index, body) in &native {
                assert_eq!(body, &bundle[*index as usize], "{mode}: frame {index} is not the bundle's");
            }
        }
    }

    /// A client offering an ALPN the server does not is refused in the handshake with
    /// `no_application_protocol`, 0x178 (RFC 9001 §8.1). `docs/WIRE.md` §The raw QUIC mapping.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_unknown_alpn_is_refused_in_the_handshake() {
        let dir = temp_dir("alpn");
        let (url, hash) = serve(&dir, Path::new(FIXTURE), "shared").await;
        let windows = Windows::default();
        until_up(|| dial(&url, hash, &windows)).await.close();
        let refused = connect(&url, hash, &windows, b"wt-pacs/0", 1).await.err().expect("an unknown ALPN was served");
        std::fs::remove_dir_all(&dir).ok();
        let code = refused.chain().find_map(|e| match e.downcast_ref() {
            Some(quinn::ConnectionError::ConnectionClosed(close)) => Some(u64::from(close.error_code)),
            _ => None,
        });
        assert_eq!(code, Some(0x178), "refused as {refused:#}");
    }
}
