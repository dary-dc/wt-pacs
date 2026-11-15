//! The TCP listener: HTTP/1.1 over TLS on hyper, in front of the one handler.
use crate::tls::AllowList;
use crate::upload::{Carrier, Content};
use bytes::Bytes;
use hyper::body::{Body, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioIo, TokioTimer};
use rustls::ServerConfig;
use std::convert::Infallible;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;
use tracing::{debug, warn};

const HANDSHAKE: Duration = Duration::from_secs(30);

struct HyperContent(Incoming);

impl Content for HyperContent {
    async fn chunk(&mut self) -> Option<io::Result<Bytes>> {
        loop {
            let frame = std::future::poll_fn(|cx| Pin::new(&mut self.0).poll_frame(cx)).await?;
            match frame.map_err(io::Error::other) {
                Ok(frame) => match frame.into_data() {
                    Ok(data) => return Some(Ok(data)),
                    Err(_trailers) => continue,
                },
                Err(err) => return Some(Err(err)),
            }
        }
    }
}

pub async fn serve(
    listener: TcpListener,
    mut tls: ServerConfig,
    allow: Arc<AllowList>,
    carrier: Arc<Carrier>,
) {
    tls.alpn_protocols = vec![b"http/1.1".to_vec()];
    let acceptor = TlsAcceptor::from(Arc::new(tls));
    loop {
        let tcp = match listener.accept().await {
            Ok((tcp, _)) => tcp,
            Err(err) => {
                warn!(%err, "TCP accept failed");
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let (acceptor, allow, carrier) = (acceptor.clone(), allow.clone(), carrier.clone());
        tokio::spawn(async move {
            let stream = match tokio::time::timeout(HANDSHAKE, acceptor.accept(tcp)).await {
                Ok(Ok(stream)) => stream,
                Ok(Err(err)) => return debug!(%err, "TLS handshake refused"),
                Err(_) => return debug!("TLS handshake timed out"),
            };
            let certificate = stream
                .get_ref()
                .1
                .peer_certificates()
                .and_then(|chain| chain.first());
            let Some(site) = certificate
                .and_then(|cert| allow.site_of(cert))
                .map(str::to_string)
            else {
                return;
            };
            let service = service_fn(move |request: hyper::Request<Incoming>| {
                let (carrier, site) = (carrier.clone(), site.clone());
                async move {
                    let (parts, body) = request.into_parts();
                    Ok::<_, Infallible>(carrier.handle(&site, parts, HyperContent(body)).await)
                }
            });
            let served = http1::Builder::new()
                .timer(TokioTimer::new())
                .header_read_timeout(HANDSHAKE)
                .serve_connection(TokioIo::new(stream), service)
                .await;
            if let Err(err) = served {
                debug!(%err, "connection ended");
            }
        });
    }
}
