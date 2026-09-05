//! The send path over a real QUIC stack, so the copy into the connection can be priced.
//!
//! `docs/disk-access/RERUN.md` lists "no live end-to-end run" as a limitation: the product
//! binds IPv6 and the validation container has none. This binds quinn — the stack
//! wtransport is built on — to IPv4 loopback instead, which needs no product change and
//! exercises the same `SendStream`.
//!
//! What it separates: `write_all(&[u8])` reaches `ByteSlice::pop_chunk`, which does
//! `Bytes::from(data[..limit].to_owned())` — an allocation and a copy of every byte, on top
//! of the kernel's copy into our window. `write_chunk(Bytes)` reaches
//! `BytesArray::pop_chunk`, which is `split_to` — a refcount bump. Same bytes on the wire,
//! same reads from the page cache; the only difference is who owns the buffer.
//!
//! Server and client are separate processes so `getrusage(RUSAGE_SELF)` on the parent is
//! the server's CPU alone.

use anyhow::{Context, Result};
use bytes::{Bytes, BytesMut};
use exact_server::media::frame_store::FrameStore;
use quinn::{Endpoint, SendStream, ServerConfig, TransportConfig, VarInt};
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How the frame's bytes reach quinn.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// The product today: read into a reused `Vec`, `write_all` the window.
    WriteAll,
    /// Read into a `BytesMut` arena, hand quinn the owned window.
    WriteChunk,
    /// Product read pattern, but head+window submitted together as two chunks.
    WriteChunkVectored,
    /// The product's `FrameCache` with a budget in MiB (`cache:<mb>`): admission on the
    /// second ask, LRU eviction, background fill — the shipped code, not a lab model.
    Cache(usize),
    /// No disk path at all: frames already in memory as `Bytes`, sent by refcount bump.
    /// Not a shippable arm (a study can exceed RAM) — it is the floor that says how much
    /// of a frame's server cost any disk-access decision can reach.
    Preloaded,
}

impl Mode {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "write_all" => Some(Self::WriteAll),
            "write_chunk" => Some(Self::WriteChunk),
            "write_chunk_vectored" => Some(Self::WriteChunkVectored),
            "preloaded" => Some(Self::Preloaded),
            other => other
                .strip_prefix("cache:")
                .and_then(|p| p.parse().ok())
                .map(Self::Cache),
        }
    }
    fn label(self) -> String {
        match self {
            Self::Cache(mb) => format!("cache:{mb}"),
            other => other.as_str().to_string(),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::WriteAll => "write_all",
            Self::WriteChunk => "write_chunk",
            Self::WriteChunkVectored => "write_chunk_vectored",
            Self::Preloaded => "preloaded",
            Self::Cache(_) => "cache",
        }
    }
}

/// Reusable window allocations that can still be handed to quinn as owned `Bytes`.
///
/// One entry per window in flight. An entry cycles: hand out `split_to(want).freeze()`,
/// which leaves the entry empty; once quinn acks and drops that `Bytes`, `try_reclaim`
/// gets the same allocation back. So the steady state neither allocates nor initialises,
/// and the pool's high-water mark is the number of unacked windows — which quinn would
/// have held as its own copies anyway.
///
/// The entry size is the read window (64 KiB), deliberately under glibc's 128 KiB
/// `mmap_threshold`: a bigger arena is returned to the kernel when freed and charges a
/// minor fault per page the next time round, which costs more than the copy it saves.
struct WindowPool {
    free: Vec<BytesMut>,
    cap: usize,
    allocs: u64,
    high_water: usize,
    live: usize,
}

impl WindowPool {
    fn new(cap: usize) -> Self {
        Self {
            free: Vec::new(),
            cap,
            allocs: 0,
            high_water: 0,
            live: 0,
        }
    }

    fn take(&mut self, want: usize) -> BytesMut {
        debug_assert!(want <= self.cap);
        let mut entry = match self
            .free
            .iter_mut()
            .position(|b| b.try_reclaim(self.cap))
            .map(|i| self.free.swap_remove(i))
        {
            Some(b) => b,
            None => {
                self.allocs += 1;
                self.live += 1;
                self.high_water = self.high_water.max(self.live);
                BytesMut::zeroed(self.cap)
            }
        };
        entry.clear();
        // SAFETY: this allocation was initialised by `zeroed` when it was created and
        // `try_reclaim` preserves it, so these are stale-but-initialised bytes; the caller
        // overwrites all `want` of them with a read before anything reads them.
        unsafe { entry.set_len(want) };
        let out = entry.split_to(want);
        self.free.push(entry);
        out
    }
}

/// `WIRE_BENCH_PREFIX` caps how many bytes of each frame are sent — the rung/prefix
/// delivery shape of `docs/adr-resolution-fitting-for-large-frames.md`, where a viewport
/// needs only the first slice of a progressive HTJ2K codestream. Reads then stride over the
/// file (take a prefix, skip the rest) instead of running through it.
fn prefix_env() -> Option<u32> {
    std::env::var("WIRE_BENCH_PREFIX")
        .ok()
        .and_then(|v| v.parse().ok())
}

/// `WIRE_BENCH_STREAM=shared` sends every frame on one uni stream instead of opening one
/// per frame. At 250 KB a stream costs nothing next to the payload; at a 16 KB rung it may
/// not, which is the whole point of measuring it.
fn shared_stream_env() -> bool {
    std::env::var("WIRE_BENCH_STREAM")
        .map(|v| v == "shared")
        .unwrap_or(false)
}

/// `WIRE_BENCH_MTU` raises the path-MTU ceiling on both ends.
fn mtu_env() -> Option<u16> {
    std::env::var("WIRE_BENCH_MTU")
        .ok()
        .and_then(|v| v.parse().ok())
}

fn cpu_ns() -> u64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `ts` is a valid, writable timespec.
    unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut ts) };
    ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64
}

fn pct(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    sorted[(((sorted.len() - 1) as f64) * p).round() as usize]
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 2 && args[1] == "--client" {
        return client(args[2].parse()?, args[3].parse()?).await;
    }
    if args.len() < 4 {
        eprintln!(
            "usage: wire_send_bench <study.sbnd> <write_all|write_chunk|write_chunk_vectored> \
             <frames> [repeats]"
        );
        std::process::exit(2);
    }
    let study = std::path::PathBuf::from(&args[1]);
    let mode = Mode::parse(&args[2]).context("unknown mode")?;
    let frames: u32 = args[3].parse()?;
    let repeats: usize = args.get(4).map(|s| s.parse()).transpose()?.unwrap_or(5);

    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();

    let store = Arc::new(match mode {
        Mode::Cache(mb) => FrameStore::open_with_cache(&study, mb * 1024 * 1024)?,
        _ => FrameStore::open(&study)?,
    });
    // Warm: this bench is about the send path, not about disk.
    {
        let mut buf = vec![0u8; 1 << 20];
        for i in 0..store.frame_count() {
            let (off, len) = store.frame_range(i)?;
            store.read_at_blocking(&mut buf[..len as usize], off)?;
        }
    }

    let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()])?;
    let cert_der = rustls::pki_types::CertificateDer::from(cert.cert.der().to_vec());
    let key_der: rustls::pki_types::PrivateKeyDer =
        rustls::pki_types::PrivatePkcs8KeyDer::from(cert.key_pair.serialize_der()).into();
    let mut server_config = ServerConfig::with_single_cert(vec![cert_der.clone()], key_der)?;
    let mut transport = TransportConfig::default();
    // Optional: let path-MTU discovery climb past quinn's 1452 B default ceiling. Only
    // reachable where the whole path carries jumbo frames — a hospital LAN, not the
    // internet — so it is a knob here, never a default.
    if let Some(mtu) = mtu_env() {
        let mut d = quinn::MtuDiscoveryConfig::default();
        d.upper_bound(mtu);
        transport.mtu_discovery_config(Some(d));
        transport.initial_mtu(mtu.min(1452));
    }
    // Wide windows: this measures the sender's own cost, not the peer's flow control.
    transport
        .max_concurrent_uni_streams(VarInt::from_u32(4096))
        .stream_receive_window(VarInt::from_u32(32 * 1024 * 1024))
        .receive_window(VarInt::from_u32(256 * 1024 * 1024))
        .send_window(256 * 1024 * 1024)
        .max_idle_timeout(Some(Duration::from_secs(30).try_into()?));
    server_config.transport_config(Arc::new(transport));

    let endpoint = match mtu_env() {
        // Raising the datagram ceiling needs `EndpointConfig` on *both* ends: the default
        // 1472 B is what an endpoint advertises it can receive, so path-MTU discovery can
        // never climb past it however wide the path is.
        Some(mtu) => {
            let mut ep_cfg = quinn::EndpointConfig::default();
            ep_cfg.max_udp_payload_size(mtu)?;
            let sock = std::net::UdpSocket::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
            Endpoint::new(
                ep_cfg,
                Some(server_config),
                sock,
                Arc::new(quinn::TokioRuntime),
            )?
        }
        None => Endpoint::server(server_config, SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?,
    };
    let port = endpoint.local_addr()?.port();

    // The client is a separate process so this process's CPU is the server's alone.
    let exe = std::env::current_exe()?;
    let cert_path = std::env::temp_dir().join(format!("wire_send_bench_{port}.der"));
    std::fs::write(&cert_path, cert.cert.der())?;
    let mut child = std::process::Command::new(exe)
        .arg("--client")
        .arg(port.to_string())
        .arg((frames as usize * repeats).to_string())
        .env("WIRE_BENCH_CERT", &cert_path)
        .spawn()?;
    let prefix = prefix_env();
    let shared_stream = shared_stream_env();

    let conn = endpoint
        .accept()
        .await
        .context("no incoming")?
        .await
        .context("handshake")?;

    let window = store.read_window(store.frame_range(0)?.1);
    let mut lat: Vec<u64> = Vec::with_capacity(frames as usize * repeats);
    let mut vec_window: Vec<u8> = vec![0u8; window];
    let mut arena = WindowPool::new(window);
    let mut acks = tokio::task::JoinSet::new();
    // The ceiling arm holds every frame; the product-cache arm starts empty and fills
    // itself through `claim_fill`/`admit` exactly as the server does.
    let preloaded: Vec<Bytes> = if mode == Mode::Preloaded {
        (0..frames)
            .map(|i| {
                let (off, len) = store.frame_range(i)?;
                let mut b = vec![0u8; len as usize];
                store.read_at_blocking(&mut b, off)?;
                Ok(Bytes::from(b))
            })
            .collect::<Result<_>>()?
    } else {
        Vec::new()
    };
    let mut hits = 0u64;

    // Shared mode opens one stream for the whole run; per-frame mode opens one per frame.
    let mut shared: Option<SendStream> = if shared_stream {
        Some(conn.open_uni().await.context("open shared uni")?)
    } else {
        None
    };

    let cpu0 = cpu_ns();
    let wall0 = Instant::now();
    let mut bytes = 0u64;
    for _ in 0..repeats {
        for idx in 0..frames {
            let (off, whole) = store.frame_range(idx)?;
            // Rung delivery: only the codestream prefix the viewport needs goes out.
            let len = prefix.map_or(whole, |p| p.min(whole));
            let t = Instant::now();
            let mut per_frame = match shared {
                Some(_) => None,
                None => Some(conn.open_uni().await.context("open_uni")?),
            };
            let uni: &mut SendStream = match (&mut shared, &mut per_frame) {
                (Some(s), _) => s,
                (_, Some(s)) => s,
                _ => unreachable!("one of the two is always Some"),
            };
            let head = frame_head(idx, len);
            match mode {
                Mode::WriteAll => {
                    uni.write_all(&head).await?;
                    stream_write_all(uni, &store, off, len, window, &mut vec_window).await?;
                }
                Mode::WriteChunk => {
                    uni.write_chunk(Bytes::copy_from_slice(&head)).await?;
                    stream_write_chunk(uni, &store, off, len, window, &mut arena, false).await?;
                }
                Mode::WriteChunkVectored => {
                    stream_write_chunk(uni, &store, off, len, window, &mut arena, true).await?;
                }
                Mode::Preloaded => {
                    hits += 1;
                    let mut chunks = [
                        Bytes::copy_from_slice(&head),
                        preloaded[idx as usize].clone(),
                    ];
                    uni.write_all_chunks(&mut chunks).await?;
                }
                // The product path: a hit is a refcount bump; a miss streams as today and
                // assembles the frame on the ask that earns it a slot.
                Mode::Cache(_) => match store.cached_frame(idx) {
                    Some(b) => {
                        hits += 1;
                        let mut chunks = [Bytes::copy_from_slice(&head), b];
                        uni.write_all_chunks(&mut chunks).await?;
                    }
                    None => {
                        uni.write_all(&head).await?;
                        let mut filling = store
                            .claim_fill(idx)
                            .then(|| store.assembly_buffer(len as usize));
                        let mut pos = 0u32;
                        while pos < len {
                            let want = window.min((len - pos) as usize);
                            let at = off + u64::from(pos);
                            let got = store.read_at_nowait(&mut vec_window[..want], at)?;
                            if got < want {
                                let s = Arc::clone(&store);
                                let mut owned = std::mem::take(&mut vec_window);
                                owned = tokio::task::spawn_blocking(move || {
                                    s.read_at_blocking(&mut owned[got..want], at + got as u64)?;
                                    Ok::<Vec<u8>, anyhow::Error>(owned)
                                })
                                .await??;
                                vec_window = owned;
                            }
                            if let Some(b) = filling.as_mut() {
                                b.extend_from_slice(&vec_window[..want]);
                            }
                            uni.write_all(&vec_window[..want]).await?;
                            pos += want as u32;
                        }
                        match filling {
                            Some(b) if b.len() == len as usize => store.admit(idx, b.freeze()),
                            Some(_) => store.abandon_fill(idx),
                            None => {}
                        }
                    }
                },
            }
            lat.push(t.elapsed().as_nanos() as u64);
            bytes += u64::from(len) + head.len() as u64;
            if let Some(mut uni) = per_frame {
                acks.spawn(async move {
                    let _ = uni.finish();
                    let _ = uni.stopped().await;
                });
                while acks.len() > 256 {
                    let _ = acks.join_next().await;
                }
            }
        }
    }
    if let Some(mut uni) = shared.take() {
        let _ = uni.finish();
        let _ = uni.stopped().await;
    }
    while acks.join_next().await.is_some() {}
    let wall = wall0.elapsed();
    let cpu = cpu_ns() - cpu0;

    conn.close(VarInt::from_u32(0), b"done");
    endpoint.wait_idle().await;
    let _ = child.wait();
    let _ = std::fs::remove_file(&cert_path);

    lat.sort_unstable();
    let n = lat.len() as u64;
    let st = conn.stats();
    println!(
        "mode={}\tframes={}\twindow={}\tp50_ns={}\tp90_ns={}\tp99_ns={}\tcpu_ns_per_frame={}\t\
         wall_ms={}\tMB_per_s={:.1}\tpool_allocs={}\tdatagrams_per_frame={:.1}\t\
         sendmsg_per_frame={:.1}\tmtu={}\thit_rate={:.2}\tcache_MB={:.1}\tpayload_B={}\t\
         stream={}\tcpu_ns_per_MB={:.0}",
        mode.label(),
        n,
        window,
        pct(&lat, 0.50),
        pct(&lat, 0.90),
        pct(&lat, 0.99),
        cpu / n.max(1),
        wall.as_millis(),
        bytes as f64 / wall.as_secs_f64() / 1e6,
        arena.allocs,
        st.udp_tx.datagrams as f64 / n as f64,
        st.udp_tx.ios as f64 / n as f64,
        st.path.current_mtu,
        hits as f64 / n as f64,
        store.cache_stats().0 as f64 / 1e6,
        bytes / n.max(1),
        if shared_stream { "shared" } else { "per_frame" },
        cpu as f64 / (bytes as f64 / 1e6),
    );
    Ok(())
}

fn frame_head(idx: u32, codestream_len: u32) -> [u8; 8] {
    let payload_len = 4u32 + codestream_len;
    let mut head = [0u8; 8];
    head[..4].copy_from_slice(&payload_len.to_be_bytes());
    head[4..].copy_from_slice(&idx.to_be_bytes());
    head
}

/// The product path today.
async fn stream_write_all(
    uni: &mut SendStream,
    store: &Arc<FrameStore>,
    offset: u64,
    len: u32,
    window: usize,
    buf: &mut Vec<u8>,
) -> Result<()> {
    let mut pos = 0u32;
    while pos < len {
        let want = window.min((len - pos) as usize);
        let at = offset + u64::from(pos);
        let got = store.read_at_nowait(&mut buf[..want], at)?;
        if got < want {
            let store = Arc::clone(store);
            let mut owned = std::mem::take(buf);
            owned = tokio::task::spawn_blocking(move || {
                store.read_at_blocking(&mut owned[got..want], at + got as u64)?;
                Ok::<Vec<u8>, anyhow::Error>(owned)
            })
            .await??;
            *buf = owned;
        }
        uni.write_all(&buf[..want]).await?;
        pos += want as u32;
    }
    Ok(())
}

/// The same reads, handed to quinn as owned windows instead of copied into it.
async fn stream_write_chunk(
    uni: &mut SendStream,
    store: &Arc<FrameStore>,
    offset: u64,
    len: u32,
    window: usize,
    arena: &mut WindowPool,
    with_head: bool,
) -> Result<()> {
    let mut pos = 0u32;
    let mut head: Option<Bytes> = if with_head {
        Some(Bytes::copy_from_slice(&frame_head(0, len)))
    } else {
        None
    };
    while pos < len {
        let want = window.min((len - pos) as usize);
        let at = offset + u64::from(pos);
        let mut cell = arena.take(want);
        let got = store.read_at_nowait(&mut cell[..want], at)?;
        if got < want {
            let store = Arc::clone(store);
            cell = tokio::task::spawn_blocking(move || {
                let mut cell = cell;
                store.read_at_blocking(&mut cell[got..want], at + got as u64)?;
                Ok::<BytesMut, anyhow::Error>(cell)
            })
            .await??;
        }
        match head.take() {
            // One `write_chunks` for the header and the first window: two refcount bumps,
            // no copy, one await instead of two.
            Some(h) => {
                let mut chunks = [h, cell.freeze()];
                uni.write_all_chunks(&mut chunks).await?;
            }
            None => uni.write_chunk(cell.freeze()).await?,
        }
        pos += want as u32;
    }
    Ok(())
}

/// Drains every stream the server opens and exits when it has seen `expect` of them.
async fn client(port: u16, expect: usize) -> Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    let cert = std::fs::read(std::env::var("WIRE_BENCH_CERT")?)?;
    let mut roots = rustls::RootCertStore::empty();
    roots.add(rustls::pki_types::CertificateDer::from(cert))?;
    let mut client_config = quinn::ClientConfig::with_root_certificates(Arc::new(roots))?;
    let mut transport = TransportConfig::default();
    if let Some(mtu) = mtu_env() {
        let mut d = quinn::MtuDiscoveryConfig::default();
        d.upper_bound(mtu);
        transport.mtu_discovery_config(Some(d));
        transport.initial_mtu(mtu.min(1452));
    }
    transport
        .max_concurrent_uni_streams(VarInt::from_u32(4096))
        .stream_receive_window(VarInt::from_u32(32 * 1024 * 1024))
        .receive_window(VarInt::from_u32(256 * 1024 * 1024))
        .max_idle_timeout(Some(Duration::from_secs(30).try_into()?));
    client_config.transport_config(Arc::new(transport));

    let mut endpoint = match mtu_env() {
        Some(mtu) => {
            let mut ep_cfg = quinn::EndpointConfig::default();
            ep_cfg.max_udp_payload_size(mtu)?;
            let sock = std::net::UdpSocket::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
            Endpoint::new(ep_cfg, None, sock, Arc::new(quinn::TokioRuntime))?
        }
        None => Endpoint::client(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?,
    };
    endpoint.set_default_client_config(client_config);
    let conn = endpoint
        .connect(SocketAddr::from((Ipv4Addr::LOCALHOST, port)), "localhost")?
        .await?;

    if shared_stream_env() {
        // One stream carrying `[4B payload len][payload]` back to back.
        let mut recv = conn.accept_uni().await?;
        let mut head = [0u8; 4];
        let mut body = vec![0u8; 8 << 20];
        for _ in 0..expect {
            if recv.read_exact(&mut head).await.is_err() {
                break;
            }
            let n = u32::from_be_bytes(head) as usize;
            if n > body.len() {
                body.resize(n, 0);
            }
            if recv.read_exact(&mut body[..n]).await.is_err() {
                break;
            }
        }
        return Ok(());
    }

    let mut seen = 0usize;
    let mut tasks = tokio::task::JoinSet::new();
    while seen < expect {
        match conn.accept_uni().await {
            Ok(mut recv) => {
                seen += 1;
                tasks.spawn(async move { recv.read_to_end(4 * 1024 * 1024).await });
                while tasks.len() > 256 {
                    let _ = tasks.join_next().await;
                }
            }
            Err(_) => break,
        }
    }
    while tasks.join_next().await.is_some() {}
    Ok(())
}
