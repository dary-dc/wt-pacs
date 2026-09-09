//! Userspace UDP path simulator standing in for `sch_netem`. LATENCY QUESTIONS ONLY:
//! forwarding datagram-by-datagram destroys the server's GSO batching.

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
    /// Packets dropped in a row when a drop fires. 1 = Bernoulli, which flatters
    /// rate-based controllers; repeat any controller comparison with >1 before believing it.
    #[arg(long, default_value_t = 1)]
    loss_burst: u32,
    /// Per-direction rate limit in Mbit/s. 0 = unlimited.
    #[arg(long, default_value_t = 0.0)]
    rate_mbps: f64,
    /// Bottleneck queue depth per direction, tail-drop beyond it. Not optional: an
    /// infinite queue buffers instead of dropping and every controller arm becomes a no-op.
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

/// Drains one direction. One task with a heap, not a timer per packet: at WAN rates a task
/// each would cost more than the path being simulated.
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
    let mut burst_left: u32 = 0;
    let burst = args.loss_burst.max(1);
    let trigger_pct = args.loss_pct / burst as f64;
    let bits_per_sec = args.rate_mbps * 1e6;

    loop {
        let sleep_until = heap.peek().map(|Reverse(q)| q.due);
        tokio::select! {
            biased;
            got = rx.recv() => {
                let Some((data, to, arrived)) = got else { break };

                if burst_left > 0 {
                    burst_left -= 1;
                    counters.lock().expect("counters").dropped_loss += 1;
                    continue;
                }
                if args.loss_pct > 0.0 && rng.next_f64() * 100.0 < trigger_pct {
                    burst_left = burst - 1;
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

                // Serialisation — what makes the queue fill and tail-drop, which is the
                // congestion signal the controllers need.
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

/// Datagram, reply address, and the instant it was received.
type ClientTx = mpsc::Sender<(Vec<u8>, Option<SocketAddr>, Instant)>;

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

    // One pacer, queue and rate limiter per client: they never share a bottleneck, so no
    // fairness question can be answered here — both flows get full rate. Use the Oracle rig.
    let mut clients: HashMap<SocketAddr, ClientTx> = HashMap::new();
    let mut buf = vec![0u8; 65535];

    if args.stats {
        // Stop condition 4 needs these visible: without them a campaign cannot tell a
        // congested link from a simulator that is itself the bottleneck.
        let (u, d) = (Arc::clone(&up_counters), Arc::clone(&down_counters));
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_millis(500));
            loop {
                tick.tick().await;
                let (u, d) = (u.lock().expect("up"), d.lock().expect("down"));
                println!(
                    "stats up_fwd={} up_loss={} up_queue={} down_fwd={} down_loss={} down_queue={}",
                    u.forwarded, u.dropped_loss, u.dropped_queue,
                    d.forwarded, d.dropped_loss, d.dropped_queue
                );
            }
        });
    }

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
