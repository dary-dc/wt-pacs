//! hyperium's h3 over quinn, against the server: one HTTP/3 GET on a fresh connection. Prints one
//! JSON line: ms from the dial to the handshake, and what the GET got. lab/other-clients/README.md
//!
//! usage: h3-get https://127.0.0.1:PORT/
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug)]
struct AnyCert;

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
        rustls::crypto::ring::default_provider().signature_verification_algorithms.supported_schemes()
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let url: http::Uri = std::env::args().nth(1).ok_or("usage: h3-get URL")?.parse()?;
    let addr = format!("{}:{}", url.host().ok_or("no host")?, url.port_u16().unwrap_or(443)).parse()?;
    let mut tls = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AnyCert))
        .with_no_client_auth();
    tls.alpn_protocols = vec![b"h3".to_vec()];
    let mut endpoint = quinn::Endpoint::client("0.0.0.0:0".parse()?)?;
    endpoint.set_default_client_config(quinn::ClientConfig::new(Arc::new(
        quinn::crypto::rustls::QuicClientConfig::try_from(tls)?,
    )));

    let t0 = Instant::now();
    let conn = endpoint.connect(addr, "localhost")?.await?;
    let handshake = t0.elapsed().as_secs_f64() * 1000.0;
    let (mut driver, mut send) = h3::client::new(h3_quinn::Connection::new(conn)).await?;
    let drive = tokio::spawn(async move { driver.wait_idle().await });
    let got = async {
        let mut stream = send.send_request(http::Request::get(url).body(())?).await?;
        stream.finish().await?;
        Ok::<_, Box<dyn std::error::Error>>(stream.recv_response().await?.status().as_u16().to_string())
    }
    .await
    .unwrap_or_else(|e| e.to_string());
    println!("{{\"handshake\": {handshake:.1}, \"get\": {got:?}}}");
    drive.abort();
    endpoint.close(0u32.into(), b"done");
    Ok(())
}
