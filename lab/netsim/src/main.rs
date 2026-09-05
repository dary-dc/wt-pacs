//! Userspace UDP path simulator: one-way delay, loss, rate, finite queue.
//!
//! Exists because this kernel has no `sch_netem` (Firecracker, no loadable modules), and
//! every congestion-control, initial-window and loss question is unanswerable without an
//! RTT axis. `tbf` gives rate only.
//!
//! ```text
//!   client ──▶ :listen ──[delay │ loss │ rate │ queue]──▶ upstream (server)
//!   client ◀──         ◀─[delay │ loss │ rate │ queue]──  upstream
//! ```
//!
//! **Valid for latency-domain questions only.** It forwards datagram-by-datagram in
//! userspace, so it destroys the send-side GSO batching the server does and adds its own
//! per-packet cost. Do not measure CPU or throughput ceilings through it; use the direct
//! loopback rig for those. Its own accuracy and capacity are measured by `e0_netsim_validation.sh`.

use anyhow::{Context, Result};
use clap::Parser;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

#[derive(Parser, Clone)]
#[command(name = "netsim")]
struct Args {
    /// Address the client connects to.
    #[arg(long, default_value = "127.0.0.1:15000")]
    listen: SocketAddr,
    /// The real server.
    #[arg(long, default_value = "127.0.0.1:14433")]
    upstream: SocketAddr,
    /// One-way delay in ms. RTT is twice this.
    #[arg(long, default_value_t = 0)]
    delay_ms: u64,
    /// Independent per-direction drop probability, percent.
    #[arg(long, default_value_t = 0.0)]
    loss_pct: f64,
    /// Per-direction rate limit in Mbit/s. 0 = unlimited.
    #[arg(long, default_value_t = 0.0)]
    rate_mbps: f64,
    /// Bottleneck queue depth in packets, per direction. Tail-drop beyond it.
    ///
    /// A finite queue is not optional: with an infinite one a rate limit produces
    /// unbounded buffering and a loss-based controller never sees a congestion signal,
    /// which silently turns every congestion-control arm into a no-op.
    #[arg(long, default_value_t = 500)]
    queue_pkts: usize,
    /// Uniform jitter in ms, applied as delay ± jitter/2.
    #[arg(long, default_value_t = 0)]
    jitter_ms: u64,
    /// Seed for the loss/jitter RNG, so an arm is reproducible.
    #[arg(long, default_value_t = 0x5EED_1234_ABCD_9876)]
    seed: u64,
    /// Print counters on exit.
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    stats: bool,
}

/// xorshift64*, so the simulator has no `rand` dependency and a seed reproduces an arm.
struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform in [0, 1).
    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn next_below(&mut self, n: u64) -> u64 {
        if n == 0 { 0 } else { self.next_u64() % n }
    }
}

/// One packet waiting for its release time.
struct Queued {
    due: Instant,
    data: Vec<u8>,
    /// Where to send it: `None` = upstream (connected socket), `Some(a)` = back to client.
    to: Option<SocketAddr>,
}

impl PartialEq for Queued {
    fn eq(&self, other: &Self) -> bool {
        self.due == other.due
    }
}
impl Eq for Queued {}
impl PartialOrd for Queued {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Queued {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.due.cmp(&other.due)
    }
}

#[derive(Default)]
struct Counters {
    forwarded: u64,
    dropped_loss: u64,
    dropped_queue: u64,
    bytes: u64,
}

/// Drains one direction: applies delay, rate and queue limit, then sends.
///
/// A single task with a heap rather than a timer per packet — at WAN rates this is a few
/// thousand packets a second and a task each would cost more than the path being simulated.
async fn pacer(
    mut rx: mpsc::Receiver<(Vec<u8>, Option<SocketAddr>, Instant)>,
    sock: Arc<UdpSocket>,
    args: Args,
    label: &'static str,
    counters: Arc<std::sync::Mutex<Counters>>,
) {
    let mut heap: BinaryHeap<Reverse<Queued>> = BinaryHeap::new();
    let mut rng = Rng(args.seed ^ label.as_bytes()[0] as u64);
    let mut next_tx = Instant::now();
    let bits_per_sec = args.rate_mbps * 1e6;

    loop {
        let sleep_until = heap.peek().map(|Reverse(q)| q.due);
        tokio::select! {
            biased;
            got = rx.recv() => {
                let Some((data, to, arrived)) = got else { break };

                if args.loss_pct > 0.0 && rng.next_f64() * 100.0 < args.loss_pct {
                    counters.lock().expect("counters").dropped_loss += 1;
                    continue;
                }
                if heap.len() >= args.queue_pkts {
                    counters.lock().expect("counters").dropped_queue += 1;
                    continue;
                }

                let mut delay = Duration::from_millis(args.delay_ms);
                if args.jitter_ms > 0 {
                    let j = rng.next_below(args.jitter_ms * 1000);
                    delay += Duration::from_micros(j);
                    delay = delay.saturating_sub(Duration::from_micros(args.jitter_ms * 500));
                }

                // Serialisation: a packet cannot leave before the link has finished the
                // one in front of it. This is what makes the queue fill and eventually
                // tail-drop, which is the congestion signal the controllers need.
                let mut due = arrived + delay;
                if bits_per_sec > 0.0 {
                    let serial = Duration::from_secs_f64((data.len() * 8) as f64 / bits_per_sec);
                    next_tx = next_tx.max(due) + serial;
                    due = next_tx;
                }
                heap.push(Reverse(Queued { due, data, to }));
            }
            _ = async {
                match sleep_until {
                    Some(t) => tokio::time::sleep_until(t.into()).await,
                    None => std::future::pending().await,
                }
            } => {
                while heap.peek().is_some_and(|Reverse(q)| q.due <= Instant::now()) {
                    let Reverse(q) = heap.pop().expect("peeked");
                    let sent = match q.to {
                        Some(addr) => sock.send_to(&q.data, addr).await,
                        None => sock.send(&q.data).await,
                    };
                    let mut c = counters.lock().expect("counters");
                    match sent {
                        Ok(n) => { c.forwarded += 1; c.bytes += n as u64; }
                        Err(_) => { c.dropped_queue += 1; }
                    }
                }
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let listen = Arc::new(UdpSocket::bind(args.listen).await.context("bind listen")?);
    println!(
        "netsim listen={} upstream={} rtt_ms={} loss_pct={} rate_mbps={} queue_pkts={}",
        args.listen,
        args.upstream,
        args.delay_ms * 2,
        args.loss_pct,
        args.rate_mbps,
        args.queue_pkts
    );

    let up_counters = Arc::new(std::sync::Mutex::new(Counters::default()));
    let down_counters = Arc::new(std::sync::Mutex::new(Counters::default()));

    // One upstream socket per client address, so the server sees distinct peers.
    let mut clients: HashMap<SocketAddr, mpsc::Sender<(Vec<u8>, Option<SocketAddr>, Instant)>> =
        HashMap::new();
    let mut buf = vec![0u8; 65535];

    loop {
        let (n, from) = listen.recv_from(&mut buf).await.context("recv listen")?;
        let now = Instant::now();

        let tx = match clients.get(&from) {
            Some(tx) => tx,
            None => {
                let up = Arc::new(UdpSocket::bind("127.0.0.1:0").await.context("bind upstream")?);
                up.connect(args.upstream).await.context("connect upstream")?;

                // client -> server
                let (tx, rx) = mpsc::channel(4096);
                tokio::spawn(pacer(rx, Arc::clone(&up), args.clone(), "u", Arc::clone(&up_counters)));

                // server -> client
                let (dtx, drx) = mpsc::channel(4096);
                tokio::spawn(pacer(drx, Arc::clone(&listen), args.clone(), "d", Arc::clone(&down_counters)));

                let up_recv = Arc::clone(&up);
                tokio::spawn(async move {
                    let mut b = vec![0u8; 65535];
                    while let Ok(n) = up_recv.recv(&mut b).await {
                        if dtx.send((b[..n].to_vec(), Some(from), Instant::now())).await.is_err() {
                            break;
                        }
                    }
                });

                clients.insert(from, tx);
                clients.get(&from).expect("just inserted")
            }
        };
        let _ = tx.send((buf[..n].to_vec(), None, now)).await;
    }
}
