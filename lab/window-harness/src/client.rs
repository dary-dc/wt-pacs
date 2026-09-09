//! The harness client: a reader that walks a trace on its own clock, an ask policy (a prefetch
//! window bounded by an in-flight cap), and the receive side that feeds the metrics.

use crate::depth::DepthController;
use crate::metrics::{
    DepthReport, HarnessMetrics, HarnessMode, MetricsState, RunConfig, SharedMetrics, StreamMode,
    WindowShape,
};
use crate::trace::TraceSpec;
use crate::wire::{read_framed_paced, write_fod_msg, LinkPacer};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::unwrap;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Notify};
use wtransport::{ClientConfig, Connection, Endpoint};

// ----------------------------------------------------------------------------- process counters

/// Peak concurrent outstanding asks actually observed during a run.
///
/// Invariant check: if this never reaches the configured `D`, the harness is not
/// producing the concurrency it claims and every number from the run is void.
/// Two bugs violated exactly this and went undetected across three campaigns.
static PEAK_OUTSTANDING: AtomicU32 = AtomicU32::new(0);

fn note_outstanding(n: u32) {
    PEAK_OUTSTANDING.fetch_max(n, Ordering::Relaxed);
}

pub fn peak_outstanding() -> u32 {
    PEAK_OUTSTANDING.load(Ordering::Relaxed)
}

pub fn reset_peak_outstanding() {
    PEAK_OUTSTANDING.store(0, Ordering::Relaxed);
}

/// Per-session ask ordinals for offline join with server `telemetry-server.json`.
/// Rule: increment per `frame_index` (0-based), same as server Tap `take_ordinal`.
static ASK_ORDINALS: LazyLock<Mutex<HashMap<u32, u32>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static ASK_JOIN: LazyLock<Mutex<Vec<crate::metrics::AskJoinRow>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));
/// `(decided_at, in_flight_at_ask)` per ask, oldest first.
type AskQueue = VecDeque<(Instant, u32)>;
/// FIFO ask instants per frame index, paired with the first byte of the answer. A queue, not a
/// slot: a re-ask must not overwrite the earlier timestamp.
static ASK_AT: LazyLock<Mutex<HashMap<u32, AskQueue>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn reset_ask_join() {
    ASK_ORDINALS.lock().expect("ask ordinals").clear();
    ASK_JOIN.lock().expect("ask join").clear();
    ASK_AT.lock().expect("ask at").clear();
}

pub fn take_ask_join() -> Vec<crate::metrics::AskJoinRow> {
    ASK_JOIN.lock().expect("ask join").clone()
}

fn record_ask(frame_index: u32, decided_at: Instant, in_flight_at_ask: u32) {
    ASK_AT
        .lock()
        .expect("ask at")
        .entry(frame_index)
        .or_default()
        .push_back((decided_at, in_flight_at_ask));
    let ordinal = {
        let mut map = ASK_ORDINALS.lock().expect("ask ordinals");
        let entry = map.entry(frame_index).or_insert(0);
        let n = *entry;
        *entry = entry.saturating_add(1);
        n
    };
    ASK_JOIN
        .lock()
        .expect("ask join")
        .push(crate::metrics::AskJoinRow { frame_index, ask_ordinal: ordinal });
}

/// Pair the oldest unmatched ask for `frame_index` with the instant its first byte was seen.
fn take_ask_rtt_ms(frame_index: u32, first_byte_at: Instant) -> Option<(f64, u32)> {
    let (at, in_flight) = ASK_AT
        .lock()
        .expect("ask at")
        .get_mut(&frame_index)?
        .pop_front()?;
    Some((first_byte_at.saturating_duration_since(at).as_secs_f64() * 1000.0, in_flight))
}

// ----------------------------------------------------------------------------- the ask path

enum AskCmd {
    Frame { frame: u32, decided_at: Instant },
    End,
}

/// The control stream, written by one task so asks leave in order and — when an RTT is
/// emulated — one-way delay after the reader decided on them. The reader never blocks on a
/// write, so issuing `D` asks takes no longer than issuing one.
struct AskPath {
    tx: mpsc::UnboundedSender<AskCmd>,
    task: Mutex<Option<tokio::task::JoinHandle<Result<()>>>>,
}

impl AskPath {
    fn spawn(mut send: wtransport::stream::SendStream, one_way: Duration) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(async move {
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    AskCmd::Frame { frame, decided_at } => {
                        sleep_until(decided_at + one_way).await;
                        write_fod_msg(&mut send, &FodMsg::RequestFrame { frame }).await?;
                    }
                    AskCmd::End => {
                        write_fod_msg(&mut send, &FodMsg::EndSession).await?;
                        break;
                    }
                }
            }
            Ok(())
        });
        Self { tx, task: Mutex::new(Some(task)) }
    }

    /// Queue an ask; returns the instant the reader decided on it.
    fn ask(&self, frame: u32) -> Result<Instant> {
        let decided_at = Instant::now();
        self.tx
            .send(AskCmd::Frame { frame, decided_at })
            .map_err(|_| anyhow::anyhow!("ask path closed"))?;
        Ok(decided_at)
    }

    async fn finish(&self) -> Result<()> {
        let _ = self.tx.send(AskCmd::End);
        let task = self.task.lock().expect("ask path task").take();
        match task {
            Some(t) => t.await.context("ask path task")?,
            None => Ok(()),
        }
    }
}

// ----------------------------------------------------------------------------- shared state

/// What the reader, the ask path and the receive loops share.
struct Shared {
    metrics: SharedMetrics,
    /// Frames asked and not yet arrived.
    outstanding: Mutex<HashSet<u32>>,
    /// Asks not yet answered, counted (saturate mode re-asks the same frame).
    in_flight: Mutex<u32>,
    /// Signalled on every arrival so a deferred prefetch can take the freed slot.
    arrived: Notify,
    asks: AskPath,
    depth_ctl: Option<Mutex<DepthController>>,
    /// Half the emulated RTT — the return-path delay.
    one_way: Duration,
}

impl Shared {
    /// The in-flight cap in force now.
    fn cap(&self, cfg: &RunConfig) -> u32 {
        match &self.depth_ctl {
            Some(ctl) => ctl.lock().expect("depth ctl").current_d(),
            None => cfg.max_in_flight(),
        }
    }

    fn depth_report(&self, cfg: &RunConfig) -> DepthReport {
        match &self.depth_ctl {
            Some(ctl) => {
                let c = ctl.lock().expect("depth ctl");
                DepthReport {
                    depth: c.current_d(),
                    d_min_observed: c.d_min_observed,
                    d_max_observed: c.d_max_observed,
                    d_current: c.d_trajectory.clone(),
                    oscillating: c.oscillating,
                    saturated: c.saturated,
                }
            }
            None => DepthReport {
                depth: cfg.depth,
                d_min_observed: cfg.depth,
                d_max_observed: cfg.depth,
                ..DepthReport::default()
            },
        }
    }
}

// ----------------------------------------------------------------------------- entry points

/// One process, serial depth sweep — fresh session per D, no shell between depths.
pub async fn run_depth_sweep(
    trace: &TraceSpec,
    cfg: &RunConfig,
    depths: &[u32],
    arm_prefix: &str,
) -> Result<Vec<HarnessMetrics>> {
    let mut out = Vec::with_capacity(depths.len());
    for &depth in depths {
        let mut run_cfg = cfg.clone();
        run_cfg.depth = depth;
        let label = format!("{arm_prefix}_d{depth}");
        out.push(run_harness(Some(trace), &run_cfg, &label).await?);
    }
    Ok(out)
}

pub async fn run_harness(
    trace: Option<&TraceSpec>,
    cfg: &RunConfig,
    arm_label: &str,
) -> Result<HarnessMetrics> {
    reset_peak_outstanding();
    reset_ask_join();
    // A second run in the same process finds the provider already installed; that is fine.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let builder = ClientConfig::builder();
    let builder = if cfg.ipv4 {
        builder.with_bind_config(wtransport::config::IpBindConfig::InAddrAnyV4)
    } else {
        builder.with_bind_default()
    };
    let client_cfg = builder
        .with_no_cert_validation()
        .keep_alive_interval(Some(Duration::from_secs(3)))
        .build();
    let endpoint = Endpoint::client(client_cfg).context("wtransport client")?;
    let connection = endpoint.connect(cfg.wt_url.clone()).await.context("connect")?;

    let n = cfg.frame_count.max(1);
    let (schedule, wanted, trace_name) = match cfg.mode {
        HarnessMode::Saturate => (Vec::new(), 0u32, "saturate".to_string()),
        HarnessMode::Trace => {
            let t = trace.context("trace required")?;
            let schedule = t.frame_schedule();
            // A cursor past the study's frame count wraps, as the window does, so `wanted` is a
            // frame that can arrive.
            let wanted = *schedule.last().context("empty trace")? % n;
            (schedule, wanted, t.name.clone())
        }
    };
    let wanted_frames = match cfg.mode {
        HarnessMode::Trace => Some(schedule.iter().map(|f| f % n).collect()),
        HarnessMode::Saturate => None,
    };

    let (control_send, _control_recv) = connection
        .open_bi()
        .await
        .context("open bi")?
        .await
        .context("open bi ready")?;
    let one_way = Duration::from_secs_f64(cfg.rtt_ms as f64 / 2000.0);
    let shared = Arc::new(Shared {
        metrics: Arc::new(Mutex::new(MetricsState::new(wanted, wanted_frames))),
        outstanding: Mutex::new(HashSet::new()),
        in_flight: Mutex::new(0),
        arrived: Notify::new(),
        asks: AskPath::spawn(control_send, one_way),
        depth_ctl: cfg.dynamic_depth.then(|| {
            Mutex::new(DepthController::new(
                cfg.depth.max(1),
                cfg.rtt_source,
                cfg.path_rtt_ms.map(|v| v as f64),
            ))
        }),
        one_way,
    });

    let pacer = LinkPacer::new(cfg.read_bps);
    let uni_task = {
        let shared = Arc::clone(&shared);
        let connection = connection.clone();
        let stream_mode = cfg.stream_mode;
        tokio::spawn(async move {
            let r = match stream_mode {
                StreamMode::Shared => shared_stream_loop(connection, shared, pacer).await,
                StreamMode::PerFrame => accept_uni_loop(connection, shared, pacer).await,
            };
            if let Err(err) = r {
                eprintln!("uni loop ended: {err:#}");
            }
        })
    };

    let asks_sent = match cfg.mode {
        HarnessMode::Saturate => run_saturate(&shared, cfg)?,
        HarnessMode::Trace => run_reader(&shared, trace.context("trace required")?, cfg, &schedule, wanted).await?,
    };

    shared.asks.finish().await?;
    tokio::time::sleep(Duration::from_millis(50)).await;
    connection.close(0u32.into(), b"harness done");
    let _ = tokio::time::timeout(Duration::from_secs(1), uni_task).await;

    let mode = match cfg.mode {
        HarnessMode::Saturate => "saturate",
        HarnessMode::Trace => "trace",
    };
    let depth_report = shared.depth_report(cfg);
    let m = shared.metrics.lock().expect("metrics lock");
    Ok(m.finalize(cfg, &trace_name, mode, arm_label, asks_sent, &depth_report))
}

// ----------------------------------------------------------------------------- saturate mode

/// Keep `D` asks in flight for the dwell, cycling through the study (E1: link fill).
fn run_saturate(shared: &Shared, cfg: &RunConfig) -> Result<u32> {
    let n = cfg.frame_count.max(1);
    let d = cfg.depth.max(1);
    let dwell = Duration::from_millis(cfg.fill_dwell_ms.max(500));
    let mut asks_sent = 0u32;
    let mut next = 0u32;

    let mut top_up = |shared: &Shared| -> Result<()> {
        loop {
            let at_ask = {
                let mut c = shared.in_flight.lock().expect("in_flight");
                if *c >= d {
                    return Ok(());
                }
                let cur = *c;
                *c += 1;
                note_outstanding(*c);
                cur
            };
            let frame = next % n;
            next = next.wrapping_add(1);
            let decided_at = shared.asks.ask(frame)?;
            record_ask(frame, decided_at, at_ask);
            shared.metrics.lock().expect("metrics lock").note_ask(decided_at);
            asks_sent += 1;
        }
    };

    top_up(shared)?;
    {
        let mut m = shared.metrics.lock().expect("metrics lock");
        m.start_fill();
        m.wanted_received = true;
        m.first_byte_wanted_at = Some(Instant::now());
    }
    let deadline = Instant::now() + dwell;
    while Instant::now() < deadline {
        top_up(shared)?;
        std::thread::sleep(Duration::from_millis(1));
    }
    shared.metrics.lock().expect("metrics lock").stop_fill();
    Ok(asks_sent)
}

// ----------------------------------------------------------------------------- trace mode

/// Walk the trace on its own clock. At each step the reader asks for the frame on screen (always)
/// and for the prefetch window ahead of it (while the in-flight cap allows); between steps, every
/// arrival re-offers the window so a deferred prefetch takes the freed slot.
async fn run_reader(
    shared: &Arc<Shared>,
    trace: &TraceSpec,
    cfg: &RunConfig,
    schedule: &[u32],
    wanted: u32,
) -> Result<u32> {
    let n = cfg.frame_count.max(1);
    let mut asks_sent = 0u32;

    if cfg.warm_cache {
        asks_sent += warm_cache(shared, cfg, schedule).await?;
    }

    let trace_start = Instant::now();
    shared.metrics.lock().expect("metrics lock").trace_start = Some(trace_start);
    let step = Duration::from_millis(trace.step_interval_ms);
    let mut direction: i64 = 1;
    let mut wait_tasks = Vec::with_capacity(schedule.len());

    for (i, &cursor) in schedule.iter().enumerate() {
        let scheduled_at = trace_start + step * i as u32;
        if i > 0 {
            let prev = schedule[i - 1];
            loop {
                tokio::select! {
                    _ = sleep_until(scheduled_at) => break,
                    _ = shared.arrived.notified() => {
                        asks_sent += emit_window(shared, cfg, prev, direction, n)?.sent;
                    }
                }
            }
            if cursor != prev {
                direction = if cursor > prev { 1 } else { -1 };
            }
        }
        let issued = emit_window(shared, cfg, cursor, direction, n)?;
        asks_sent += issued.sent;
        wait_tasks.push(tokio::spawn(wait_step_displayable(
            Arc::clone(shared),
            i,
            cursor % n,
            scheduled_at,
            issued.centre_ask_at,
            cfg.timeout_ms,
        )));
    }

    for task in wait_tasks {
        task.await.context("wait task join")??;
    }

    let drain_ok = wait_frames_on_wire(&shared.metrics, asks_sent, cfg.timeout_ms).await;
    let _ = wait_outstanding_below(&shared.outstanding, 0, cfg.timeout_ms).await;
    {
        let mut m = shared.metrics.lock().expect("metrics lock");
        if !drain_ok {
            m.drain_incomplete = true;
        }
        m.settle();
    }
    wait_wanted(&shared.metrics, cfg.timeout_ms, wanted).await?;

    if cfg.fill_dwell_ms > 0 {
        shared.metrics.lock().expect("metrics lock").start_fill();
        let fill_deadline = Instant::now() + Duration::from_millis(cfg.fill_dwell_ms);
        while Instant::now() < fill_deadline {
            asks_sent += emit_window(shared, cfg, wanted, direction, n)?.sent;
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        shared.metrics.lock().expect("metrics lock").stop_fill();
    }

    Ok(asks_sent)
}

/// E2 warm-cache control: every frame of the schedule is in the cache before the trace starts.
async fn warm_cache(shared: &Shared, cfg: &RunConfig, schedule: &[u32]) -> Result<u32> {
    let n = cfg.frame_count.max(1);
    let mut asks_sent = 0u32;
    let mut seen = HashSet::new();
    for &frame in schedule {
        if seen.insert(frame % n) && try_ask_frame(shared, frame % n, u32::MAX, true)?.is_some() {
            asks_sent += 1;
        }
    }
    wait_frames_on_wire(&shared.metrics, seen.len() as u32, cfg.timeout_ms).await;
    shared.outstanding.lock().expect("outstanding").clear();
    *shared.in_flight.lock().expect("in_flight") = 0;
    Ok(asks_sent)
}

struct Issued {
    sent: u32,
    /// When the frame on screen was asked for at this step; `None` if it was cached or in flight.
    centre_ask_at: Option<Instant>,
}

/// Offer the window around `cursor`: the centre always, the prefetch while the cap allows.
fn emit_window(shared: &Shared, cfg: &RunConfig, cursor: u32, direction: i64, n: u32) -> Result<Issued> {
    let centre = cursor % n;
    let cap = shared.cap(cfg);
    let mut out = Issued { sent: 0, centre_ask_at: None };
    for frame in window_frames(centre, direction, cfg.prefetch, n, cfg.window_shape) {
        let exempt = frame == centre;
        if let Some(at) = try_ask_frame(shared, frame, cap, exempt)? {
            out.sent += 1;
            if exempt {
                out.centre_ask_at = Some(at);
            }
        }
    }
    Ok(out)
}

/// The frames a step wants, in ask order.
fn window_frames(centre: u32, direction: i64, prefetch: u32, n: u32, shape: WindowShape) -> Vec<u32> {
    let want = 1 + prefetch as usize;
    let mut out = Vec::with_capacity(want.min(n as usize));
    if n == 0 {
        return out;
    }
    match shape {
        WindowShape::Forward => {
            let mut f = i64::from(centre % n);
            while out.len() < want && (0..i64::from(n)).contains(&f) {
                out.push(f as u32);
                f += direction;
            }
        }
        WindowShape::Ring => {
            out.push(centre % n);
            let mut radius = 1u32;
            while out.len() < want && radius <= n {
                let plus = centre.wrapping_add(radius) % n;
                if !out.contains(&plus) {
                    out.push(plus);
                    if out.len() >= want {
                        break;
                    }
                }
                let minus = centre.wrapping_add(n).wrapping_sub(radius % n) % n;
                if !out.contains(&minus) {
                    out.push(minus);
                }
                radius += 1;
            }
        }
    }
    out
}

/// Ask unless cached, already in flight, or (for a non-exempt frame) at the cap. Returns the
/// instant the ask was decided on when one went out.
fn try_ask_frame(shared: &Shared, frame: u32, cap: u32, exempt: bool) -> Result<Option<Instant>> {
    if shared.metrics.lock().expect("metrics lock").cache.contains(&frame) {
        return Ok(None);
    }
    if shared.outstanding.lock().expect("outstanding").contains(&frame) {
        return Ok(None);
    }
    let at_ask = {
        let mut c = shared.in_flight.lock().expect("in_flight");
        if !exempt && *c >= cap {
            return Ok(None);
        }
        let cur = *c;
        *c += 1;
        note_outstanding(*c);
        cur
    };
    shared.outstanding.lock().expect("outstanding").insert(frame);
    let decided_at = shared.asks.ask(frame)?;
    record_ask(frame, decided_at, at_ask);
    shared.metrics.lock().expect("metrics lock").note_ask(decided_at);
    Ok(Some(decided_at))
}

/// Wait until step `index`'s frame is displayable; record its lateness against the schedule.
async fn wait_step_displayable(
    shared: Arc<Shared>,
    index: usize,
    frame: u32,
    scheduled_at: Instant,
    ask_at: Option<Instant>,
    timeout_ms: u64,
) -> Result<()> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        let arrived = {
            let m = shared.metrics.lock().expect("metrics lock");
            m.arrived_at(frame)
        };
        if let Some(arrived_at) = arrived {
            // A frame that landed before its step was displayable on time.
            let displayable_at = arrived_at.max(scheduled_at);
            let lateness_ms = displayable_at.duration_since(scheduled_at).as_secs_f64() * 1000.0;
            let wait_ms = ask_at
                .map(|a| displayable_at.saturating_duration_since(a).as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            shared
                .metrics
                .lock()
                .expect("metrics lock")
                .record_step(index, lateness_ms, wait_ms, displayable_at);
            return Ok(());
        }
        if Instant::now() >= deadline {
            anyhow::bail!("timeout waiting for displayable frame {frame} (step {index})");
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
}

async fn sleep_until(deadline: Instant) {
    tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)).await;
}

async fn wait_outstanding_below(outstanding: &Mutex<HashSet<u32>>, max: usize, timeout_ms: u64) -> bool {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if outstanding.lock().expect("outstanding").len() <= max {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
}

/// Wait until `frames_on_wire >= min_frames`. False on timeout.
async fn wait_frames_on_wire(metrics: &SharedMetrics, min_frames: u32, timeout_ms: u64) -> bool {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if metrics.lock().expect("metrics lock").frames_on_wire >= min_frames {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
}

async fn wait_wanted(metrics: &SharedMetrics, timeout_ms: u64, wanted: u32) -> Result<()> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if metrics.lock().expect("metrics lock").wanted_received {
            return Ok(());
        }
        if Instant::now() >= deadline {
            anyhow::bail!("timeout waiting for wanted frame {wanted}");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

// ----------------------------------------------------------------------------- receive side

/// A frame has been read in full; `first_byte_at` is when its length prefix arrived.
async fn on_frame_arrived(shared: &Shared, index: u32, wire_len: u64, first_byte_at: Instant) {
    // The emulated path delivers the first byte one-way later; the ask→first-byte sample is
    // measured from the instant the reader decided to ask, so it carries the whole RTT.
    let ask_rtt = take_ask_rtt_ms(index, first_byte_at + shared.one_way);
    if let Some((rtt, _)) = ask_rtt {
        shared.metrics.lock().expect("metrics lock").record_ask_first_byte_ms(rtt);
    }
    if !shared.one_way.is_zero() {
        tokio::time::sleep(shared.one_way).await;
    }
    shared.outstanding.lock().expect("outstanding").remove(&index);
    {
        let mut c = shared.in_flight.lock().expect("in_flight");
        *c = c.saturating_sub(1);
    }
    shared.metrics.lock().expect("metrics lock").on_envelope(index, wire_len);
    if let Some(ctl) = &shared.depth_ctl {
        let (rtt, in_flight_at_ask) = match ask_rtt {
            Some((rtt, at)) => (Some(rtt), at),
            None => (None, u32::MAX),
        };
        ctl.lock()
            .expect("depth ctl")
            .on_frame_completed(rtt, wire_len, in_flight_at_ask, Instant::now());
    }
    shared.arrived.notify_one();
}

/// One shared uni stream carrying `[4B BE envelope_len][envelope]` repeatedly.
///
/// Frames arrive strictly in order — that is the point of the architecture. Post-processing
/// (emulated delay + metrics) is spawned so the read loop is never blocked by it.
async fn shared_stream_loop(
    connection: Connection,
    shared: Arc<Shared>,
    pacer: Arc<tokio::sync::Mutex<LinkPacer>>,
) -> Result<()> {
    let mut recv = match connection.accept_uni().await {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    loop {
        let (payload, first_byte_at) = match read_framed_paced(&mut recv, &pacer).await {
            Ok(p) => p,
            Err(_) => break,
        };
        let (index, body) = match unwrap(&payload) {
            Ok(v) => v,
            Err(err) => {
                eprintln!("unwrap error: {err}");
                break;
            }
        };
        let wire_len = (4 + body.len()) as u64;
        let shared = Arc::clone(&shared);
        tokio::spawn(async move { on_frame_arrived(&shared, index, wire_len, first_byte_at).await });
    }
    Ok(())
}

async fn accept_uni_loop(
    connection: Connection,
    shared: Arc<Shared>,
    pacer: Arc<tokio::sync::Mutex<LinkPacer>>,
) -> Result<()> {
    loop {
        let mut recv = match connection.accept_uni().await {
            Ok(s) => s,
            Err(_) => break,
        };
        let shared = Arc::clone(&shared);
        let pacer = Arc::clone(&pacer);
        tokio::spawn(async move {
            let (payload, first_byte_at) = match read_framed_paced(&mut recv, &pacer).await {
                Ok(p) => p,
                Err(err) => {
                    eprintln!("uni read error: {err:#}");
                    return;
                }
            };
            let (index, body) = match unwrap(&payload) {
                Ok(v) => v,
                Err(err) => {
                    eprintln!("unwrap error: {err}");
                    return;
                }
            };
            on_frame_arrived(&shared, index, (4 + body.len()) as u64, first_byte_at).await;
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ask order the v2 review asked to pin: ahead in the direction of travel, never past
    /// the study's edges, never wrapping.
    #[test]
    fn forward_window_follows_travel_and_stops_at_the_edges() {
        assert_eq!(window_frames(0, 1, 3, 80, WindowShape::Forward), vec![0, 1, 2, 3]);
        assert_eq!(window_frames(40, -1, 3, 80, WindowShape::Forward), vec![40, 39, 38, 37]);
        assert_eq!(window_frames(78, 1, 5, 80, WindowShape::Forward), vec![78, 79]);
        assert_eq!(window_frames(1, -1, 5, 80, WindowShape::Forward), vec![1, 0]);
        assert_eq!(window_frames(7, 1, 0, 80, WindowShape::Forward), vec![7]);
    }

    /// The v2 artefact, kept reproducible: at the study start the ring asks for its last frames.
    #[test]
    fn ring_window_wraps_at_the_study_start() {
        assert_eq!(window_frames(0, 1, 6, 80, WindowShape::Ring), vec![0, 1, 79, 2, 78, 3, 77]);
    }

    #[test]
    fn window_never_exceeds_the_study() {
        assert_eq!(window_frames(2, 1, 100, 4, WindowShape::Forward), vec![2, 3]);
        assert_eq!(window_frames(2, 1, 100, 4, WindowShape::Ring).len(), 4);
    }
}
