//! The QUIC listener, experimental: HTTP/3 on h3 0.0.8 and h3-quinn 0.0.10, in front of the same
//! handler as TCP. docs/ingest/link.md §12.4 says why it is labelled so.
use crate::tls::AllowList;
use crate::upload::{Carrier, Content};
use anyhow::{Context, Result};
use bytes::{Buf, Bytes};
use h3::server::RequestStream;
use quinn::crypto::rustls::QuicServerConfig;
use rustls::pki_types::CertificateDer;
use rustls::ServerConfig;
use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::debug;

type Stream = RequestStream<h3_quinn::BidiStream<Bytes>, Bytes>;

struct H3Content<'a>(&'a mut Stream);

impl Content for H3Content<'_> {
    async fn chunk(&mut self) -> Option<io::Result<Bytes>> {
        match self.0.recv_data().await {
            Ok(Some(mut data)) => Some(Ok(data.copy_to_bytes(data.remaining()))),
            Ok(None) => None,
            Err(err) => Some(Err(io::Error::other(err))),
        }
    }
}

pub fn bind(addr: SocketAddr, mut tls: ServerConfig) -> Result<quinn::Endpoint> {
    tls.alpn_protocols = vec![b"h3".to_vec()];
    let crypto = QuicServerConfig::try_from(tls).context("QUIC TLS config")?;
    quinn::Endpoint::server(quinn::ServerConfig::with_crypto(Arc::new(crypto)), addr)
        .with_context(|| format!("QUIC listener on {addr}"))
}

pub async fn serve(endpoint: quinn::Endpoint, allow: Arc<AllowList>, carrier: Arc<Carrier>) {
    while let Some(incoming) = endpoint.accept().await {
        let (allow, carrier) = (allow.clone(), carrier.clone());
        tokio::spawn(async move {
            if let Err(err) = connection(incoming, &allow, carrier).await {
                debug!(err = %format_args!("{err:#}"), "HTTP/3 connection ended");
            }
        });
    }
}

async fn connection(
    incoming: quinn::Incoming,
    allow: &AllowList,
    carrier: Arc<Carrier>,
) -> Result<()> {
    let connection = incoming.await?;
    let chain = connection
        .peer_identity()
        .and_then(|id| id.downcast::<Vec<CertificateDer<'static>>>().ok());
    let site = chain
        .as_ref()
        .and_then(|chain| chain.first())
        .and_then(|cert| allow.site_of(cert));
    let site = site.context("no enrolled certificate")?.to_string();
    let mut h3 =
        h3::server::Connection::<_, Bytes>::new(h3_quinn::Connection::new(connection)).await?;
    while let Some(resolver) = h3.accept().await? {
        let (carrier, site) = (carrier.clone(), site.clone());
        tokio::spawn(async move {
            let Ok((request, mut stream)) = resolver.resolve_request().await else {
                return;
            };
            let (parts, ()) = request.into_parts();
            let response = carrier.handle(&site, parts, H3Content(&mut stream)).await;
            let (parts, body) = response.into_parts();
            let sent = async {
                stream
                    .send_response(http::Response::from_parts(parts, ()))
                    .await?;
                if !body.is_empty() {
                    stream.send_data(Bytes::from(body)).await?;
                }
                stream.finish().await
            };
            if let Err(err) = sent.await {
                debug!(%err, "HTTP/3 response not sent");
            }
        });
    }
    Ok(())
}
