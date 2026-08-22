//! WebTransport-compatible self-signed cert (dev).

use anyhow::{Context, Result};
use rustls::pki_types;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use time::Duration;

struct Inner {
    cert_der: pki_types::CertificateDer<'static>,
    key_der: pki_types::PrivateKeyDer<'static>,
    sha256_hex: String,
}

#[derive(Clone)]
pub struct WebTransportCert {
    inner: Arc<Inner>,
}

impl WebTransportCert {
    pub fn cert_der(&self) -> &pki_types::CertificateDer<'static> {
        &self.inner.cert_der
    }

    pub fn key_der(&self) -> &pki_types::PrivateKeyDer<'static> {
        &self.inner.key_der
    }

    pub fn sha256_hex(&self) -> &str {
        &self.inner.sha256_hex
    }
}

pub fn load_pem_cert(cert_pem: &str, key_pem: &str) -> Result<WebTransportCert> {
    let cert_der = rustls_pemfile::certs(&mut cert_pem.as_bytes())
        .next()
        .transpose()
        .context("read cert pem")?
        .ok_or_else(|| anyhow::anyhow!("empty cert pem"))?;
    let key_der = rustls_pemfile::private_key(&mut key_pem.as_bytes())
        .context("read key pem")?
        .ok_or_else(|| anyhow::anyhow!("empty key pem"))?;

    let mut hasher = Sha256::new();
    hasher.update(&cert_der);
    let sha256_hex = format!("{:x}", hasher.finalize());

    Ok(WebTransportCert {
        inner: Arc::new(Inner {
            cert_der,
            key_der,
            sha256_hex,
        }),
    })
}

pub fn generate_localhost_cert() -> Result<WebTransportCert> {
    use rcgen::{CertificateParams, DnType, SanType};
    use std::net::IpAddr;

    const COMMON_NAME: &str = "localhost";
    let now = time::OffsetDateTime::now_utc();

    let mut dname = rcgen::DistinguishedName::new();
    dname.push(DnType::CommonName, COMMON_NAME);

    let mut params = CertificateParams::new(vec![COMMON_NAME.to_string()])?;
    params.distinguished_name = dname;
    params.subject_alt_names = vec![
        SanType::DnsName(COMMON_NAME.try_into().context("dns san")?),
        SanType::IpAddress(IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)),
    ];
    params.not_before = now
        .checked_sub(Duration::days(2))
        .context("not_before underflow")?;
    params.not_after = now
        .checked_add(Duration::days(14))
        .context("not_after overflow")?;

    let key_pair = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256)?;
    let cert = params.self_signed(&key_pair)?;

    let cert_der = cert.der().clone();
    let key_der = pki_types::PrivatePkcs8KeyDer::from(key_pair.serialize_der()).into();

    let mut hasher = Sha256::new();
    hasher.update(&cert_der);
