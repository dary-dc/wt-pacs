//! The default build's quinn sends at most 24 datagrams a `sendmsg`:
//! docs/transport/transport-conclusions.md §4.

use std::fmt;
use std::io;
use std::net::{Ipv4Addr, SocketAddr};
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};

use wtransport::quinn::{self, udp, AsyncUdpSocket, Runtime, TokioRuntime, UdpPoller};

/// Offers 64 segments a send, as Linux's GSO does, sends each segment alone so the kernel's own
/// limit cannot cap the batch, and keeps the largest batch quinn asked for.
struct WidestBatch {
    inner: Arc<dyn AsyncUdpSocket>,
    widest: Arc<AtomicUsize>,
}

impl fmt::Debug for WidestBatch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("WidestBatch")
    }
}

impl AsyncUdpSocket for WidestBatch {
    fn create_io_poller(self: Arc<Self>) -> Pin<Box<dyn UdpPoller>> {
        self.inner.clone().create_io_poller()
    }

    fn try_send(&self, transmit: &udp::Transmit) -> io::Result<()> {
        let size = transmit.segment_size.unwrap_or(transmit.contents.len());
        let segments: Vec<&[u8]> = transmit.contents.chunks(size).collect();
        for segment in &segments {
            let one = udp::Transmit { contents: segment, segment_size: None, ..*transmit };
            while let Err(e) = self.inner.try_send(&one) {
                if e.kind() != io::ErrorKind::WouldBlock {
                    return Err(e);
                }
                std::thread::yield_now();
            }
        }
        self.widest.fetch_max(segments.len(), Ordering::Relaxed);
        Ok(())
    }

    fn poll_recv(
        &self,
        cx: &mut Context,
        bufs: &mut [io::IoSliceMut<'_>],
        meta: &mut [udp::RecvMeta],
    ) -> Poll<io::Result<usize>> {
        self.inner.poll_recv(cx, bufs, meta)
    }

    fn local_addr(&self) -> io::Result<SocketAddr> {
        self.inner.local_addr()
    }

    fn max_transmit_segments(&self) -> usize {
        64
    }

    fn max_receive_segments(&self) -> usize {
        self.inner.max_receive_segments()
    }

    fn may_fragment(&self) -> bool {
        self.inner.may_fragment()
    }
}

/// The largest batch quinn hands its socket while sending `bytes` on one stream over loopback.
async fn widest_batch(bytes: usize) -> usize {
    let _ = quinn::rustls::crypto::ring::default_provider().install_default();
    let key = rcgen::KeyPair::generate().expect("key");
    let cert = rcgen::CertificateParams::new(vec!["localhost".into()])
        .expect("params")
        .self_signed(&key)
        .expect("cert");
    let cert_der = quinn::rustls::pki_types::CertificateDer::from(cert.der().to_vec());
    let key_der = quinn::rustls::pki_types::PrivateKeyDer::try_from(key.serialize_der()).expect("key der");
    let server_config =
        quinn::ServerConfig::with_single_cert(vec![cert_der.clone()], key_der).expect("server config");

    let std_socket = std::net::UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
    let widest = Arc::new(AtomicUsize::new(0));
    let socket = WidestBatch {
        inner: TokioRuntime.wrap_udp_socket(std_socket).expect("wrap"),
        widest: widest.clone(),
    };
    let server = quinn::Endpoint::new_with_abstract_socket(
        quinn::EndpointConfig::default(),
        Some(server_config),
        Arc::new(socket),
        Arc::new(TokioRuntime),
    )
    .expect("server endpoint");
    let server_addr = server.local_addr().expect("server addr");

    let mut roots = quinn::rustls::RootCertStore::empty();
    roots.add(cert_der).expect("root");
    let mut client = quinn::Endpoint::client((Ipv4Addr::LOCALHOST, 0).into()).expect("client");
    client.set_default_client_config(quinn::ClientConfig::with_root_certificates(Arc::new(roots)).expect("client config"));

    let send = tokio::spawn(async move {
        let connection = server.accept().await.expect("incoming").await.expect("server handshake");
        let mut stream = connection.open_uni().await.expect("open uni");
        stream.write_all(&vec![0x5a; bytes]).await.expect("write");
        stream.finish().expect("finish");
        connection.closed().await;
    });
    let connection = client.connect(server_addr, "localhost").expect("connect").await.expect("client handshake");
    let mut stream = connection.accept_uni().await.expect("accept uni");
    let received = stream.read_to_end(bytes).await.expect("read");
    assert_eq!(received.len(), bytes);
    connection.close(0u32.into(), b"");
    send.await.expect("sender");
    widest.load(Ordering::Relaxed)
}

/// Offered 64 segments, the default build's quinn batches 24 datagrams a `sendmsg` and never more:
/// stock quinn 0.11.11 stops at 10, and the patch's ceiling unchanged would reach 45.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_default_build_sends_24_datagrams_a_sendmsg() {
    assert_eq!(widest_batch(8 << 20).await, 24);
}
