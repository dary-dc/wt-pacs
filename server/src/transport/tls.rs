//! WebTransport-compatible self-signed cert (dev).

use anyhow::{Context, Result};
use rustls::pki_types;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use time::Duration;

struct Inner {
    cert_der: pki_types::CertificateDer<'static>,
    key_der: pki_types::PrivateKeyDer<'static>,
