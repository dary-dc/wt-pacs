//! Mutual TLS: each PCS presents its own certificate, enrolled for one site by its SHA-256 in
//! the allow list. docs/ingest/link.md §12.3.
use anyhow::{bail, Context, Result};
use rustls::client::danger::HandshakeSignatureValid;
use rustls::crypto::{ring, verify_tls13_signature, WebPkiSupportedAlgorithms};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{
    CertificateError, DigitallySignedStruct, DistinguishedName, Error, ServerConfig,
    SignatureScheme,
};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

/// Certificate SHA-256 (lowercase hex) to site.
#[derive(Debug)]
pub struct AllowList(HashMap<String, String>);

impl AllowList {
    /// One `<site> <sha256-hex>` per line; `#` starts a comment.
    pub fn parse(text: &str) -> Result<AllowList> {
        let mut sites = HashMap::new();
        for (number, line) in text.lines().enumerate() {
            let line = line.split('#').next().unwrap_or_default().trim();
            if line.is_empty() {
                continue;
            }
            let fields: Vec<&str> = line.split_whitespace().collect();
            let [site, fingerprint] = fields[..] else {
                bail!("line {}: `<site> <sha256-hex>`", number + 1)
            };
            let fingerprint = fingerprint.to_ascii_lowercase();
            if fingerprint.len() != 64 || !fingerprint.bytes().all(|b| b.is_ascii_hexdigit()) {
                bail!(
                    "line {}: a certificate's SHA-256 is 64 hex digits",
                    number + 1
                );
            }
            sites.insert(fingerprint, site.to_string());
        }
        Ok(AllowList(sites))
    }

    pub fn site_of(&self, certificate: &CertificateDer) -> Option<&str> {
        self.0.get(&fingerprint(certificate)).map(String::as_str)
    }
}

pub fn fingerprint(certificate: &CertificateDer) -> String {
    let digest = ::ring::digest::digest(&::ring::digest::SHA256, certificate.as_ref());
    digest.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// TLS 1.3 only; a handshake without an enrolled client certificate fails before any request.
pub fn server_config(
    cert_pem: &Path,
    key_pem: &Path,
    allow: Arc<AllowList>,
) -> Result<ServerConfig> {
    let chain = CertificateDer::pem_file_iter(cert_pem)
        .and_then(|certs| certs.collect::<Result<Vec<_>, _>>())
        .with_context(|| format!("certificates from {}", cert_pem.display()))?;
    let key = PrivateKeyDer::from_pem_file(key_pem)
        .with_context(|| format!("private key from {}", key_pem.display()))?;
    let provider = Arc::new(ring::default_provider());
    let algorithms = provider.signature_verification_algorithms;
    ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_client_cert_verifier(Arc::new(Enrolled { allow, algorithms }))
        .with_single_cert(chain, key)
        .context("TLS config")
}

#[derive(Debug)]
struct Enrolled {
    allow: Arc<AllowList>,
    algorithms: WebPkiSupportedAlgorithms,
}

/// Trust is the pin alone: no chain, no expiry; revoking a PCS is deleting its line.
impl ClientCertVerifier for Enrolled {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }

    fn verify_client_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: UnixTime,
    ) -> Result<ClientCertVerified, Error> {
        match self.allow.site_of(end_entity) {
            Some(_) => Ok(ClientCertVerified::assertion()),
            None => Err(Error::InvalidCertificate(
                CertificateError::ApplicationVerificationFailure,
            )),
        }
    }

    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        Err(Error::General("TLS 1.2 is not offered".into()))
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        verify_tls13_signature(message, cert, dss, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The allow list keys on the fingerprint whatever its case, and refuses a malformed line.
    #[test]
    fn allow_list_lines() {
        let fp = "AB".repeat(32);
        let list = AllowList::parse(&format!("# sites\nsite-a {fp}  # the first PCS\n\n")).unwrap();
        assert_eq!(
            list.0.get(&fp.to_ascii_lowercase()).map(String::as_str),
            Some("site-a")
        );
        assert!(AllowList::parse("site-a abc").is_err());
        assert!(AllowList::parse(&format!("site-a {fp} extra")).is_err());
    }

    /// The handshake's own check: an enrolled certificate passes, any other fails. The listener
    /// also drops a connection whose certificate maps to no site, so this test is the one that
    /// sees the verifier alone.
    #[test]
    fn the_verifier_refuses_a_stranger() {
        let enrolled = rcgen::generate_simple_self_signed(vec!["pcs-a".into()])
            .unwrap()
            .cert;
        let stranger = rcgen::generate_simple_self_signed(vec!["pcs-a".into()])
            .unwrap()
            .cert;
        let allow = AllowList::parse(&format!("site-a {}", fingerprint(enrolled.der()))).unwrap();
        let verifier = Enrolled {
            allow: Arc::new(allow),
            algorithms: ring::default_provider().signature_verification_algorithms,
        };
        assert!(verifier
            .verify_client_cert(enrolled.der(), &[], UnixTime::now())
            .is_ok());
        assert!(verifier
            .verify_client_cert(stranger.der(), &[], UnixTime::now())
            .is_err());
        assert!(verifier.client_auth_mandatory());
    }
}
