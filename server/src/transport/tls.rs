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

