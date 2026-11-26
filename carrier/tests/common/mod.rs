//! A carrier on loopback with three client identities, and a bare HTTP/1.1 client that can stop
//! anywhere in a request.
#![allow(dead_code)]
use carrier::handoff::Root;
use carrier::tls::{self, fingerprint, AllowList};
use carrier::upload::{Carrier, Limits};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use tokio_rustls::TlsConnector;

pub const NAME: &str = "U1.1.0123456789abcdef.tar";

pub struct Identity {
    pub cert: CertificateDer<'static>,
    pub key: PrivateKeyDer<'static>,
    pub cert_pem: PathBuf,
    pub key_pem: PathBuf,
}

pub struct Setup {
    pub dir: PathBuf,
    pub root: Root,
    pub addr: SocketAddr,
    pub server_pem: PathBuf,
    pub site_a: Identity,
    pub site_b: Identity,
    pub stranger: Identity,
    pub tls: rustls::ServerConfig,
    pub allow: Arc<AllowList>,
    pub carrier: Arc<Carrier>,
}

fn identity(dir: &Path, label: &str, names: Vec<String>) -> Identity {
    let generated = rcgen::generate_simple_self_signed(names).unwrap();
    let (cert_pem, key_pem) = (
        dir.join(format!("{label}.pem")),
        dir.join(format!("{label}.key")),
    );
    std::fs::write(&cert_pem, generated.cert.pem()).unwrap();
    std::fs::write(&key_pem, generated.key_pair.serialize_pem()).unwrap();
    Identity {
        cert: generated.cert.der().clone(),
        key: PrivateKeyDer::try_from(generated.key_pair.serialize_der()).unwrap(),
        cert_pem,
        key_pem,
    }
}

impl Setup {
    pub async fn start(label: &str, stall: Duration) -> Setup {
        let dir = std::env::temp_dir().join(format!("carrier-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let server = identity(&dir, "server", vec!["localhost".into(), "127.0.0.1".into()]);
        let site_a = identity(&dir, "site-a", vec!["pcs-a".into()]);
        let site_b = identity(&dir, "site-b", vec!["pcs-b".into()]);
        let stranger = identity(&dir, "stranger", vec!["pcs-x".into()]);
        let list = format!(
            "site-a {}\nsite-b {}\n",
            fingerprint(&site_a.cert),
            fingerprint(&site_b.cert)
        );
        let allow = Arc::new(AllowList::parse(&list).unwrap());
        let tls = tls::server_config(&server.cert_pem, &server.key_pem, allow.clone()).unwrap();
        let limits = Limits {
            max_size: 1 << 30,
            stall,
        };
        let carrier = Arc::new(Carrier::new(Root::open(&dir.join("root")).unwrap(), limits));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(carrier::tcp::serve(
            listener,
            tls.clone(),
            allow.clone(),
            carrier.clone(),
        ));
        let root = Root::open(&dir.join("root")).unwrap();
        Setup {
            root,
            addr,
            server_pem: server.cert_pem,
            site_a,
            site_b,
            stranger,
            tls,
            allow,
            carrier,
            dir,
        }
    }

    pub fn name(&self) -> carrier::handoff::PackageName {
        carrier::handoff::PackageName::parse(NAME).unwrap()
    }
}

#[derive(Debug)]
pub struct AnyServer;

impl ServerCertVerifier for AnyServer {
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
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub fn client_config(who: Option<&Identity>, alpn: &[u8]) -> rustls::ClientConfig {
    let builder = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_protocol_versions(&[&rustls::version::TLS13])
    .unwrap()
    .dangerous()
    .with_custom_certificate_verifier(Arc::new(AnyServer));
    let mut config = match who {
        Some(who) => builder
            .with_client_auth_cert(vec![who.cert.clone()], who.key.clone_key())
            .unwrap(),
        None => builder.with_no_client_auth(),
    };
    config.alpn_protocols = vec![alpn.to_vec()];
    config
}

pub async fn connect(
    addr: SocketAddr,
    who: Option<&Identity>,
) -> std::io::Result<TlsStream<TcpStream>> {
    let connector = TlsConnector::from(Arc::new(client_config(who, b"http/1.1")));
    let tcp = TcpStream::connect(addr).await?;
    connector
        .connect(ServerName::try_from("localhost").unwrap(), tcp)
        .await
}

#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Reply {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// Writes the head of a request declaring `length` bytes of content, and `sent` of them.
pub async fn begin(
    stream: &mut TlsStream<TcpStream>,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    length: usize,
    sent: &[u8],
) {
    let mut head = format!("{method} {path} HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str(&format!("content-length: {length}\r\n\r\n"));
    stream.write_all(head.as_bytes()).await.unwrap();
    stream.write_all(sent).await.unwrap();
    stream.flush().await.unwrap();
}

pub async fn finish(mut stream: TlsStream<TcpStream>) -> std::io::Result<Reply> {
    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .await
        .or_else(|err| match raw.is_empty() {
            true => Err(err),
            false => Ok(0),
        })?;
    let text = String::from_utf8_lossy(&raw).to_string();
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or(std::io::ErrorKind::UnexpectedEof)?;
    let mut lines = head.lines();
    let status = lines
        .next()
        .unwrap()
        .split(' ')
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    Ok(Reply {
        status,
        headers,
        body: body.to_string(),
    })
}

pub async fn request(
    addr: SocketAddr,
    who: &Identity,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Reply {
    let mut stream = connect(addr, Some(who)).await.unwrap();
    begin(&mut stream, method, path, headers, body.len(), body).await;
    finish(stream).await.unwrap()
}

pub const DRAFT: (&str, &str) = ("upload-draft-interop-version", "10");

/// The careful creation: an empty `POST` that returns the upload's address.
pub async fn create(setup: &Setup, who: &Identity, name: &str, length: usize) -> Reply {
    let length = length.to_string();
    let headers = [
        DRAFT,
        ("upload-complete", "?0"),
        ("upload-length", length.as_str()),
    ];
    request(
        setup.addr,
        who,
        "POST",
        &format!("/packages/{name}"),
        &headers,
        b"",
    )
    .await
}

pub async fn patch(
    setup: &Setup,
    who: &Identity,
    location: &str,
    offset: usize,
    bytes: &[u8],
    complete: bool,
) -> Reply {
    let offset = offset.to_string();
    let headers = [
        DRAFT,
        ("content-type", "application/partial-upload"),
        ("upload-offset", offset.as_str()),
        ("upload-complete", if complete { "?1" } else { "?0" }),
    ];
    request(setup.addr, who, "PATCH", location, &headers, bytes).await
}

pub async fn one_shot(setup: &Setup, who: &Identity, name: &str, bytes: &[u8]) -> Reply {
    let headers = [DRAFT, ("upload-complete", "?1")];
    request(
        setup.addr,
        who,
        "POST",
        &format!("/packages/{name}"),
        &headers,
        bytes,
    )
    .await
}

pub async fn get(setup: &Setup, who: &Identity, path: &str) -> Reply {
    request(setup.addr, who, "GET", path, &[], b"").await
}

pub fn package(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i * 7 + i / 251) as u8).collect()
}

/// Polls until `cond` holds, or panics after 10 s.
pub async fn eventually(what: &str, mut cond: impl FnMut() -> bool) {
    for _ in 0..1000 {
        if cond() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("never: {what}");
}
