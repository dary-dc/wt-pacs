//! One fill of a whole series through a native WebTransport stack, and the client's CPU over it: receive cost
//! per MB. Stacks: `wtransport` (wtransport's client) and `wtq` (web-transport-quinn); `--no-gro` turns
//! `UDP_GRO` off on the client's socket once the stack has set it up. Frames are checked after the clock stops,
//! by SHA-256 against `--digests`. lab/recv-cost/README.md
//!
//! usage: recv_cost --url https://127.0.0.1:4433/ --stack wtransport|wtq [--no-gro] --digests FILE
use anyhow::{ensure, Context, Result};
use clap::{Parser, ValueEnum};
use fod::{encode_fod_msg, FodMsg};
use std::net::UdpSocket;
use std::os::fd::{AsRawFd, RawFd};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt};
/// The largest envelope a client reads (docs/WIRE.md §The envelope).
const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

#[derive(Clone, Copy, ValueEnum)]
enum Stack {
    Wtransport,
    Wtq,
}

#[derive(Parser)]
struct Args {
    #[arg(long)]
    url: String,
    #[arg(long, value_enum)]
    stack: Stack,
    #[arg(long)]
    no_gro: bool,
    /// One SHA-256 per line, frame 0 first, written when the series was made.
    #[arg(long)]
    digests: std::path::PathBuf,
    #[arg(long, default_value_t = 600_000)]
    timeout_ms: u64,
}

/// ns on CPU over this process's threads, from schedstat.
fn cpu_ns() -> Result<u64> {
    let mut ns = 0;
    for task in std::fs::read_dir("/proc/self/task")? {
        if let Ok(text) = std::fs::read_to_string(task?.path().join("schedstat")) {
            ns += text.split_whitespace().next().context("schedstat")?.parse::<u64>()?;
        }
    }
    Ok(ns)
}

fn gro(fd: RawFd) -> Result<i32> {
    let mut on: libc::c_int = 0;
    let mut len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: `fd` is the open socket the stack owns for the life of `main`; `on` and `len` outlive the call.
    let rc = unsafe { libc::getsockopt(fd, libc::SOL_UDP, libc::UDP_GRO, (&mut on as *mut libc::c_int).cast(), &mut len) };
    ensure!(rc == 0, "getsockopt(UDP_GRO): {}", std::io::Error::last_os_error());
    Ok(on)
}

fn gro_off(fd: RawFd) -> Result<()> {
    let off: libc::c_int = 0;
    // SAFETY: as in `gro`; the option value is a c_int the call only reads.
    let rc = unsafe {
        libc::setsockopt(fd, libc::SOL_UDP, libc::UDP_GRO, (&off as *const libc::c_int).cast(),
            std::mem::size_of::<libc::c_int>() as libc::socklen_t)
    };
    ensure!(rc == 0, "setsockopt(UDP_GRO, 0): {}", std::io::Error::last_os_error());
    Ok(())
}

#[derive(Debug)]
struct AcceptAny(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for AcceptAny {
    fn verify_server_cert(&self, _: &rustls::pki_types::CertificateDer<'_>, _: &[rustls::pki_types::CertificateDer<'_>],
        _: &rustls::pki_types::ServerName<'_>, _: &[u8], _: rustls::pki_types::UnixTime)
        -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &rustls::pki_types::CertificateDer<'_>, d: &rustls::DigitallySignedStruct)
        -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, m: &[u8], c: &rustls::pki_types::CertificateDer<'_>, d: &rustls::DigitallySignedStruct)
        -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// Frames off the shared media stream until `count` have arrived: (index, body) in arrival order.
async fn read_frames(mut uni: impl AsyncRead + Unpin, count: usize) -> Result<Vec<(u32, Vec<u8>)>> {
    let mut frames = Vec::with_capacity(count);
    while frames.len() < count {
        let n = uni.read_u32().await.context("stream ended between frames")? as usize;
        ensure!(n > 4 && n <= MAX_FRAME_LEN, "invalid frame length {n}");
        let mut payload = vec![0u8; n];
        uni.read_exact(&mut payload).await.context("stream ended mid-envelope")?;
        let (index, body) = frame_envelope::unwrap(&payload).map_err(anyhow::Error::msg)?;
        frames.push((index, body.to_vec()));
    }
    Ok(frames)
}

struct Fill {
    frames: Vec<(u32, Vec<u8>)>,
    ms: f64,
    cpu_ns: u64,
    gro: i32,
}

async fn fill_wtransport(args: &Args, count: usize) -> Result<Fill> {
    use wtransport::{ClientConfig, Endpoint};
    let socket = UdpSocket::bind("127.0.0.1:0")?;
    let fd = socket.as_raw_fd();
    let endpoint = Endpoint::client(ClientConfig::builder().with_bind_socket(socket).with_no_cert_validation().build())?;
    if args.no_gro {
        gro_off(fd)?;
    }
    let connection = endpoint.connect(&args.url).await.context("connect")?;
    let (mut control, _recv) = connection.open_bi().await?.await?;
    let (cpu0, t0) = (cpu_ns()?, Instant::now());
    control.write_all(&encode_fod_msg(&FodMsg::StreamFrames { from: None, to: None })?).await?;
    let uni = connection.accept_uni().await?;
    let frames = read_frames(uni, count).await?;
    let (ms, cpu_ns) = (t0.elapsed().as_secs_f64() * 1e3, cpu_ns()? - cpu0);
    connection.close(0u32.into(), b"done");
    Ok(Fill { frames, ms, cpu_ns, gro: gro(fd)? })
}

async fn fill_wtq(args: &Args, count: usize) -> Result<Fill> {
    use web_transport_quinn::quinn;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut crypto = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAny(provider)))
        .with_no_client_auth();
    crypto.alpn_protocols = vec![web_transport_quinn::ALPN.as_bytes().to_vec()];
    let config = quinn::ClientConfig::new(Arc::new(quinn::crypto::rustls::QuicClientConfig::try_from(crypto)?));
    let socket = UdpSocket::bind("127.0.0.1:0")?;
    let fd = socket.as_raw_fd();
    let endpoint = quinn::Endpoint::new(quinn::EndpointConfig::default(), None, socket, Arc::new(quinn::TokioRuntime))?;
    if args.no_gro {
        gro_off(fd)?;
    }
    let client = web_transport_quinn::Client::new(endpoint, config);
    let session = client.connect(url::Url::parse(&args.url)?).await.context("connect")?;
    let (mut control, _recv) = session.open_bi().await?;
    let (cpu0, t0) = (cpu_ns()?, Instant::now());
    control.write_all(&encode_fod_msg(&FodMsg::StreamFrames { from: None, to: None })?).await?;
    let uni = session.accept_uni().await?;
    let frames = read_frames(uni, count).await?;
    let (ms, cpu_ns) = (t0.elapsed().as_secs_f64() * 1e3, cpu_ns()? - cpu0);
    session.close(0, b"done");
    Ok(Fill { frames, ms, cpu_ns, gro: gro(fd)? })
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;
    let digests: Vec<String> = std::fs::read_to_string(&args.digests)?.lines().map(str::to_owned).collect();
    let deadline = Duration::from_millis(args.timeout_ms);
    let fill = match args.stack {
        Stack::Wtransport => tokio::time::timeout(deadline, fill_wtransport(&args, digests.len())).await,
        Stack::Wtq => tokio::time::timeout(deadline, fill_wtq(&args, digests.len())).await,
    }
    .context("fill timed out")??;
    let mut seen = vec![false; digests.len()];
    let (mut exact, mut bytes) = (0usize, 0u64);
    for (index, body) in &fill.frames {
        let i = *index as usize;
        ensure!(i < seen.len() && !seen[i], "frame {index} unexpected or repeated");
        seen[i] = true;
        bytes += body.len() as u64 + 8;
        let hex: String = ring::digest::digest(&ring::digest::SHA256, body).as_ref().iter().map(|b| format!("{b:02x}")).collect();
        exact += (hex == digests[i]) as usize;
    }
    println!(
        "{{\"frames\":{},\"exact\":{},\"bytes\":{},\"fill_ms\":{:.1},\"client_cpu_ms\":{:.1},\"gro\":{}}}",
        fill.frames.len(), exact, bytes, fill.ms, fill.cpu_ns as f64 / 1e6, fill.gro,
    );
    Ok(())
}
