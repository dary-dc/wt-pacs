//! One metadata-only package per fresh connection, timed from the dial to the PACS's 201: HTTP/1.1 over TLS 1.3
//! over the kernel's TCP, or HTTP/3 over quinn. lab/metadata-store/README.md §Updates on the link
//!
//! usage: update-link serve ADDR             TCP and UDP on the same port; replies 201 once the whole body is read
//!        update-link send ADDR PLAN         PLAN: "tcp|quic FILE" per line; one JSON line per transfer
use bytes::Buf;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{DigitallySignedStruct, DistinguishedName, SignatureScheme};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

type Error = Box<dyn std::error::Error + Send + Sync>;

const PAUSE: Duration = Duration::from_millis(300);

/// Both ends present a certificate and accept any: the bytes of mutual TLS are on the wire, trust is not measured.
#[derive(Debug)]
struct AnyCert;

fn schemes() -> Vec<SignatureScheme> {
    rustls::crypto::ring::default_provider()
        .signature_verification_algorithms
        .supported_schemes()
}

impl ServerCertVerifier for AnyCert {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        schemes()
    }
}

impl ClientCertVerifier for AnyCert {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }
    fn verify_client_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: UnixTime,
    ) -> Result<ClientCertVerified, rustls::Error> {
        Ok(ClientCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        schemes()
    }
}

fn identity(name: &str) -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>), Error> {
    let cert = rcgen::generate_simple_self_signed(vec![name.to_string()])?;
    let key = PrivatePkcs8KeyDer::from(cert.key_pair.serialize_der());
    Ok((vec![cert.cert.der().clone()], key.into()))
}

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn server_tls(alpn: &[u8]) -> Result<rustls::ServerConfig, Error> {
    let (chain, key) = identity("pacs")?;
    let mut tls = rustls::ServerConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_client_cert_verifier(Arc::new(AnyCert))
        .with_single_cert(chain, key)?;
    tls.alpn_protocols = vec![alpn.to_vec()];
    Ok(tls)
}

fn client_tls(alpn: &[u8]) -> Result<rustls::ClientConfig, Error> {
    let (chain, key) = identity("pcs")?;
    let mut tls = rustls::ClientConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AnyCert))
        .with_client_auth_cert(chain, key)?;
    tls.alpn_protocols = vec![alpn.to_vec()];
    tls.resumption = rustls::client::Resumption::disabled();
    Ok(tls)
}

/// The creation request of draft-ietf-httpbis-resumable-upload-14 §6, the whole package in it.
fn request_head(name: &str, len: usize) -> String {
    format!(
        "POST /uploads/{name} HTTP/1.1\r\nHost: pacs\r\nContent-Type: application/x-tar\r\nContent-Length: {len}\r\n\
         Upload-Complete: ?1\r\nUpload-Length: {len}\r\nIf-None-Match: *\r\n\r\n"
    )
}

fn content_length(head: &str) -> Option<usize> {
    head.lines()
        .find_map(|l| l.strip_prefix("Content-Length: "))
        .and_then(|v| v.trim().parse().ok())
}

async fn serve_tcp(
    stream: tokio::net::TcpStream,
    acceptor: tokio_rustls::TlsAcceptor,
) -> Result<(), Error> {
    let mut tls = acceptor.accept(stream).await?;
    let mut buf = Vec::new();
    let mut chunk = vec![0u8; 64 * 1024];
    let (head_end, len) = loop {
        let n = tls.read(&mut chunk).await?;
        if n == 0 {
            return Err("closed before the head".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let len = content_length(std::str::from_utf8(&buf[..i])?).ok_or("no Content-Length")?;
            break (i + 4, len);
        }
    };
    let mut got = buf.len() - head_end;
    while got < len {
        let n = tls.read(&mut chunk).await?;
        if n == 0 {
            return Err("closed before the body's end".into());
        }
        got += n;
    }
    let reply = format!("HTTP/1.1 201 Created\r\nUpload-Offset: {got}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    tls.write_all(reply.as_bytes()).await?;
    tls.shutdown().await?;
    Ok(())
}

async fn serve_quic(incoming: quinn::Incoming) -> Result<(), Error> {
    let conn = h3_quinn::Connection::new(incoming.await?);
    let mut h3: h3::server::Connection<_, bytes::Bytes> = h3::server::Connection::new(conn).await?;
    while let Some(resolver) = h3.accept().await? {
        let (_, mut stream) = resolver.resolve_request().await?;
        let mut got = 0;
        while let Some(data) = stream.recv_data().await? {
            got += data.remaining();
        }
        let reply = http::Response::builder()
            .status(201)
            .header("upload-offset", got)
            .body(())?;
        stream.send_response(reply).await?;
        stream.finish().await?;
    }
    Ok(())
}

async fn serve(addr: SocketAddr) -> Result<(), Error> {
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server_tls(b"http/1.1")?));
    let tcp = tokio::net::TcpListener::bind(addr).await?;
    let mut quic = quinn::ServerConfig::with_crypto(Arc::new(
        quinn::crypto::rustls::QuicServerConfig::try_from(server_tls(b"h3")?)?,
    ));
    let mut transport = quinn::TransportConfig::default();
    transport.stream_receive_window(quinn::VarInt::from_u32(16 << 20));
    quic.transport_config(Arc::new(transport));
    let endpoint = quinn::Endpoint::server(quic, addr)?;
    tokio::spawn(async move {
        while let Some(incoming) = endpoint.accept().await {
            tokio::spawn(async move {
                if let Err(e) = serve_quic(incoming).await {
                    eprintln!("quic: {e}");
                }
            });
        }
    });
    loop {
        let (stream, _) = tcp.accept().await?;
        let acceptor = acceptor.clone();
        tokio::spawn(async move {
            if let Err(e) = serve_tcp(stream, acceptor).await {
                eprintln!("tcp: {e}");
            }
        });
    }
}

/// The reply's status and the body bytes the PACS says it read.
type Reply = (u16, usize);

async fn send_tcp(
    addr: SocketAddr,
    tls: Arc<rustls::ClientConfig>,
    name: &str,
    body: &[u8],
) -> Result<Reply, Error> {
    let connector = tokio_rustls::TlsConnector::from(tls);
    let stream = tokio::net::TcpStream::connect(addr).await?;
    stream.set_nodelay(true)?;
    let mut tls = connector
        .connect(ServerName::try_from("pacs")?, stream)
        .await?;
    let mut request = request_head(name, body.len()).into_bytes();
    request.extend_from_slice(body);
    tls.write_all(&request).await?;
    tls.flush().await?;
    let mut reply = Vec::new();
    tls.read_to_end(&mut reply).await.ok();
    let reply = std::str::from_utf8(&reply)?;
    let status = reply.get(9..12).ok_or("no status")?.parse()?;
    let offset = reply
        .lines()
        .find_map(|l| l.strip_prefix("Upload-Offset: "))
        .ok_or("no offset")?
        .parse()?;
    Ok((status, offset))
}

async fn send_quic(
    addr: SocketAddr,
    tls: quinn::ClientConfig,
    name: &str,
    body: &[u8],
) -> Result<Reply, Error> {
    let mut endpoint = quinn::Endpoint::client("0.0.0.0:0".parse()?)?;
    endpoint.set_default_client_config(tls);
    let conn = endpoint.connect(addr, "pacs")?.await?;
    let (mut driver, mut send) = h3::client::new(h3_quinn::Connection::new(conn)).await?;
    let drive = tokio::spawn(async move { driver.wait_idle().await });
    let request = http::Request::post(format!("https://pacs/uploads/{name}"))
        .header("content-type", "application/x-tar")
        .header("upload-complete", "?1")
        .header("upload-length", body.len())
        .header("if-none-match", "*")
        .body(())?;
    let mut stream = send.send_request(request).await?;
    stream
        .send_data(bytes::Bytes::copy_from_slice(body))
        .await?;
    stream.finish().await?;
    let reply = stream.recv_response().await?;
    let offset = reply
        .headers()
        .get("upload-offset")
        .ok_or("no offset")?
        .to_str()?
        .parse()?;
    drive.abort();
    endpoint.close(0u32.into(), b"done");
    Ok((reply.status().as_u16(), offset))
}

fn quic_tls() -> Result<quinn::ClientConfig, Error> {
    let tls = quinn::crypto::rustls::QuicClientConfig::try_from(client_tls(b"h3")?)?;
    Ok(quinn::ClientConfig::new(Arc::new(tls)))
}

async fn send(addr: SocketAddr, plan: &str) -> Result<(), Error> {
    let (tcp_tls, quic_tls) = (Arc::new(client_tls(b"http/1.1")?), quic_tls()?);
    for line in tokio::fs::read_to_string(plan).await?.lines() {
        let (protocol, file) = line
            .split_once(' ')
            .ok_or("a plan line is \"tcp|quic FILE\"")?;
        let body = tokio::fs::read(file).await?;
        let name = file.rsplit('/').next().unwrap_or(file);
        tokio::time::sleep(PAUSE).await;
        let t0 = Instant::now();
        let status = match protocol {
            "tcp" => send_tcp(addr, tcp_tls.clone(), name, &body).await,
            _ => send_quic(addr, quic_tls.clone(), name, &body).await,
        };
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        let status = match status {
            Ok((201, n)) if n == body.len() => "201".to_string(),
            Ok((s, n)) => format!("{s}, {n} of {} bytes read", body.len()),
            Err(e) => format!("{e:?}"),
        };
        println!("{{\"protocol\": {protocol:?}, \"file\": {file:?}, \"bytes\": {}, \"ms\": {ms:.2}, \"status\": {status:?}}}", body.len());
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let args: Vec<String> = std::env::args().collect();
    match (args.get(1).map(String::as_str), args.get(2)) {
        (Some("serve"), Some(addr)) => serve(addr.parse()?).await,
        (Some("send"), Some(addr)) => {
            send(addr.parse()?, args.get(3).ok_or("send ADDR PLAN")?).await
        }
        _ => Err("usage: update-link serve ADDR | send ADDR PLAN".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The head names the body's length twice, as the draft's creation request does, and the server reads it back.
    #[test]
    fn the_request_head_carries_the_body_length() {
        let head = request_head("u.tar", 1234);
        assert!(head.contains("Upload-Complete: ?1\r\n"));
        assert_eq!(content_length(&head), Some(1234));
        assert!(head.ends_with("\r\n\r\n"));
    }

    /// Both stacks deliver the whole body, and the server answers 201 having read every byte, over loopback.
    #[tokio::test(flavor = "multi_thread")]
    async fn both_protocols_carry_a_package_to_a_201() {
        let addr: SocketAddr = "127.0.0.1:47391".parse().unwrap();
        tokio::spawn(serve(addr));
        tokio::time::sleep(Duration::from_millis(200)).await;
        let body = vec![7u8; 300_000];
        let tcp = Arc::new(client_tls(b"http/1.1").unwrap());
        assert_eq!(
            send_tcp(addr, tcp, "t.tar", &body).await.unwrap(),
            (201, body.len())
        );
        assert_eq!(
            send_quic(addr, quic_tls().unwrap(), "q.tar", &body)
                .await
                .unwrap(),
            (201, body.len())
        );
    }
}
