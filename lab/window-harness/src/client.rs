use crate::depth::DepthController;
use crate::metrics::{HarnessMetrics, HarnessMode, RunConfig, SharedMetrics, StreamMode};
use crate::trace::TraceSpec;
use crate::wire::{read_framed_paced, write_fod_msg, LinkPacer};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::unwrap;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use wtransport::{ClientConfig, Connection, Endpoint};

use std::sync::atomic::{AtomicU32, Ordering};

/// Peak concurrent outstanding asks actually observed during a run.
///
/// Invariant check: if this never reaches the configured `D`, the harness is not
/// producing the concurrency it claims and every number from the run is void.
/// Two bugs violated exactly this and went undetected across three campaigns.
pub(crate) static PEAK_OUTSTANDING: AtomicU32 = AtomicU32::new(0);

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
/// FIFO ask wall-times per frame index (for dynamic RTT samples).
/// One slot was wrong: a re-ask overwrote the earlier timestamp and the second
/// response then cleared the entry (`None`), dropping ~40% of samples and biasing
/// survivors low (timed from the latest ask).
static ASK_AT: LazyLock<Mutex<HashMap<u32, VecDeque<Instant>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn reset_ask_join() {
    ASK_ORDINALS.lock().expect("ask ordinals").clear();
    ASK_JOIN.lock().expect("ask join").clear();
    ASK_AT.lock().expect("ask at").clear();
}

pub fn take_ask_join() -> Vec<crate::metrics::AskJoinRow> {
    ASK_JOIN.lock().expect("ask join").clone()
}

fn record_ask(frame_index: u32) {
    ASK_AT
        .lock()
        .expect("ask at")
        .entry(frame_index)
        .or_default()
        .push_back(Instant::now());
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
        .push(crate::metrics::AskJoinRow {
            frame_index,
            ask_ordinal: ordinal,
        });
}

/// Pair the oldest unmatched ask for `frame_index` with a first-byte instant.
fn take_ask_rtt_ms(frame_index: u32, first_byte_at: Instant) -> Option<f64> {
    let at = ASK_AT
        .lock()
        .expect("ask at")
        .get_mut(&frame_index)?
        .pop_front()?;
    Some(first_byte_at.saturating_duration_since(at).as_secs_f64() * 1000.0)
}

/// One process, serial depth sweep — fresh session per D, no shell between depths.
pub async fn run_depth_sweep(
    trace: &TraceSpec,
    cfg: &RunConfig,
    depths: &[u32],
    arm_prefix: &str,
) -> Result<Vec<HarnessMetrics>> {
    let mut out = Vec::with_capacity(depths.len());
    for &depth in depths {
        reset_peak_outstanding();
        reset_ask_join();
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
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("rustls ring provider already installed"))?;

    let client_cfg = ClientConfig::builder()
        .with_bind_default()
        .with_no_cert_validation()
        .keep_alive_interval(Some(Duration::from_secs(3)))
        .build();

    let endpoint = Endpoint::client(client_cfg).context("wtransport client")?;
    let connection = endpoint
        .connect(cfg.wt_url.clone())
        .await
        .context("connect")?;

    let trace_ref = trace.as_ref();
    let (schedule, wanted, trace_name) = match cfg.mode {
        HarnessMode::Saturate => (Vec::new(), 0u32, "saturate".to_string()),
        HarnessMode::Trace => {
            let t = trace_ref.context("trace required")?;
            let schedule = t.frame_schedule();
            // Wrap like `window_frames` does. A trace whose cursor exceeds the study's frame
            // count would otherwise set `wanted` to a frame that is never asked for and never
            // arrives, so `wait_wanted` blocks for the whole timeout.
            let wanted = *schedule.last().context("empty trace")? % cfg.frame_count.max(1);
            (schedule, wanted, t.name.clone())
        }
    };

    let metrics: SharedMetrics = Arc::new(Mutex::new(crate::metrics::MetricsState::new(wanted)));
    let depth_ctl: Option<Arc<Mutex<DepthController>>> = if cfg.dynamic_depth {
        Some(Arc::new(Mutex::new(DepthController::new(cfg.depth.max(1)))))
    } else {
        None
    };

    let conn_uni = connection.clone();
    let metrics_uni = Arc::clone(&metrics);
    let read_bps = cfg.read_bps;
    let pacer = LinkPacer::new(read_bps);
    let outstanding: Arc<Mutex<HashSet<u32>>> = Arc::new(Mutex::new(HashSet::new()));
    let in_flight: Arc<Mutex<u32>> = Arc::new(Mutex::new(0));
    let outstanding_uni = Arc::clone(&outstanding);
    let in_flight_uni = Arc::clone(&in_flight);
    let pacer_uni = Arc::clone(&pacer);
    let depth_uni = depth_ctl.clone();
    let rtt_ms = cfg.rtt_ms;
    let stream_mode = cfg.stream_mode;
    let uni_task = tokio::spawn(async move {
        let r = match stream_mode {
            StreamMode::Shared => {
                shared_stream_loop(
                    conn_uni,
                    metrics_uni,
                    outstanding_uni,
                    in_flight_uni,
                    pacer_uni,
                    rtt_ms,
                    depth_uni,
                )
                .await
            }
            StreamMode::PerFrame => {
                accept_uni_loop(
                    conn_uni,
                    metrics_uni,
                    outstanding_uni,
                    in_flight_uni,
                    pacer_uni,
                    rtt_ms,
                    depth_uni,
                )
                .await
            }
        };
        if let Err(err) = r {
            eprintln!("uni loop ended: {err:#}");
        }
    });

    let (mut control_send, _control_recv) = connection
        .open_bi()
        .await
        .context("open bi")?
        .await
        .context("open bi ready")?;

    let asks_sent = match cfg.mode {
        HarnessMode::Saturate => {
            run_saturate(&mut control_send, cfg, &metrics, &in_flight).await?
        }
        HarnessMode::Trace => {
            let t = trace_ref.context("trace required")?;
            if cfg.depth > 0 || cfg.dynamic_depth {
                run_windowed(
                    &mut control_send,
                    t,
                    cfg,
                    &schedule,
                    wanted,
                    &metrics,
                    &outstanding,
                    depth_ctl.as_ref(),
                )
                .await?
            } else {
                run_legacy_schedule(
                    &mut control_send,
                    t,
                    cfg,
                    &schedule,
                    wanted,
                    &metrics,
                    &outstanding,
                )
                .await?
            }
        }
    };

    write_fod_msg(&mut control_send, &FodMsg::EndSession).await?;
    tokio::time::sleep(Duration::from_millis(50)).await;
    connection.close(0u32.into(), b"harness done");
    let _ = tokio::time::timeout(Duration::from_secs(1), uni_task).await;

    let mode = match cfg.mode {
        HarnessMode::Saturate => "saturate",
        HarnessMode::Trace => "trace",
    };
    let (d_min, d_max, d_traj, oscillating, report_depth) = if let Some(ctl) = &depth_ctl {
        let c = ctl.lock().expect("depth ctl");
        // Do not bail here — main prints JSON (incl. d_current) then exits 2.
        (
            c.d_min_observed,
            c.d_max_observed,
            c.d_trajectory.clone(),
            c.oscillating,
            c.current_d(),
        )
    } else {
        (cfg.depth, cfg.depth, Vec::new(), false, cfg.depth)
    };
    let m = metrics.lock().expect("metrics lock");
    Ok(m.finalize(
        &trace_name,
        mode,
        cfg.read_bps,
        report_depth,
        arm_label,
        asks_sent,
        cfg.fill_dwell_ms,
        cfg.warm_cache,
        cfg.rtt_ms,
        cfg.stream_mode,
        d_min,
        d_max,
        d_traj,
        oscillating,
    ))
}

async fn run_saturate(
    control_send: &mut wtransport::stream::SendStream,
    cfg: &RunConfig,
    metrics: &SharedMetrics,
    in_flight: &Arc<Mutex<u32>>,
) -> Result<u32> {
    let n = cfg.frame_count.max(1);
    let d = cfg.depth.max(1);
    let dwell = cfg.fill_dwell_ms.max(500);
    let mut asks_sent = 0u32;
    let mut next_ask = 0u32;

    // Count-based outstanding (same frame may be re-asked while in flight).
    while *in_flight.lock().expect("in_flight") < d {
        {
            let mut c = in_flight.lock().expect("in_flight");
            *c += 1;
            note_outstanding(*c);
        }
        let frame = next_ask % n;
        next_ask = next_ask.wrapping_add(1);
        match tokio::time::timeout(
            Duration::from_millis(cfg.rtt_ms + 10_000),
            ask_frame(control_send, frame, cfg.rtt_ms),
        )
        .await
        {
            Ok(Ok(())) => asks_sent += 1,
            Ok(Err(err)) => return Err(err),
            Err(_) => {
                let mut c = in_flight.lock().expect("in_flight");
                *c = c.saturating_sub(1);
                break;
            }
        }
    }

    {
        let mut m = metrics.lock().expect("metrics lock");
        m.start_fill();
        m.wanted_received = true;
        m.first_byte_wanted_at = Some(std::time::Instant::now());
    }

    let fill_deadline = std::time::Instant::now() + Duration::from_millis(dwell);
    while std::time::Instant::now() < fill_deadline {
        while *in_flight.lock().expect("in_flight") < d {
            if std::time::Instant::now() >= fill_deadline {
                break;
            }
            {
                let mut c = in_flight.lock().expect("in_flight");
                *c += 1;
                note_outstanding(*c);
            }
            let frame = next_ask % n;
            next_ask = next_ask.wrapping_add(1);
            // Bound each ask so a blocked control write cannot outlive the dwell.
            match tokio::time::timeout(
                Duration::from_millis(dwell + cfg.rtt_ms + 5_000),
                ask_frame(control_send, frame, cfg.rtt_ms),
            )
            .await
            {
                Ok(Ok(())) => asks_sent += 1,
                Ok(Err(err)) => return Err(err),
                Err(_) => {
                    let mut c = in_flight.lock().expect("in_flight");
                    *c = c.saturating_sub(1);
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }

    {
        let mut m = metrics.lock().expect("metrics lock");
        m.stop_fill();
    }
    Ok(asks_sent)
}

async fn run_legacy_schedule(
    control_send: &mut wtransport::stream::SendStream,
    trace: &TraceSpec,
    cfg: &RunConfig,
    schedule: &[u32],
    wanted: u32,
    metrics: &SharedMetrics,
    outstanding: &Arc<Mutex<HashSet<u32>>>,
) -> Result<u32> {
    let n = cfg.frame_count.max(1);
    let mut asks_sent = 0u32;
    // Fire-all: ask every schedule frame with no outstanding bound (shipping behaviour).
    // Measure per-step time-to-displayable concurrently so waits do not serialize asks
    // into depth≈1 — that would void the control arm.
    let mut wait_tasks = Vec::with_capacity(schedule.len());
    for (i, &frame) in schedule.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(Duration::from_millis(trace.step_interval_ms)).await;
        }
        let idx = frame % n;
        {
            let mut o = outstanding.lock().expect("outstanding");
            o.insert(idx);
            note_outstanding(o.len() as u32);
        }
        ask_frame(control_send, idx, cfg.rtt_ms).await?;
        asks_sent += 1;
        let metrics_w = Arc::clone(metrics);
        let timeout_ms = cfg.timeout_ms;
        wait_tasks.push(tokio::spawn(async move {
            wait_displayable(&metrics_w, idx, timeout_ms).await
        }));
    }

    for task in wait_tasks {
        task.await
            .context("legacy wait task join")?
            .context("legacy wait_displayable")?;
    }

    // Drain in-flight responses so bytes_on_wire counts every ask's payload — otherwise
    // control stops at last unique displayable and leaves ~30% of responses uncounted.
    wait_frames_on_wire(metrics, asks_sent, cfg.timeout_ms).await?;
    wait_outstanding_below(outstanding, 0, cfg.timeout_ms).await?;

    {
        let mut m = metrics.lock().expect("metrics lock");
        m.settle();
    }

    wait_wanted(metrics, cfg.timeout_ms, wanted % n).await?;
    Ok(asks_sent)
}

async fn run_windowed(
    control_send: &mut wtransport::stream::SendStream,
    trace: &TraceSpec,
    cfg: &RunConfig,
    schedule: &[u32],
    wanted: u32,
    metrics: &SharedMetrics,
    outstanding: &Arc<Mutex<HashSet<u32>>>,
    depth_ctl: Option<&Arc<Mutex<DepthController>>>,
) -> Result<u32> {
    let n = cfg.frame_count.max(1);
    let mut asks_sent = 0u32;

    let current_d = || -> u32 {
        if let Some(ctl) = depth_ctl {
            ctl.lock().expect("depth ctl").current_d()
        } else {
            cfg.depth
        }
    };

    if cfg.warm_cache {
        // Prefetch every unique frame once so settle is a cache hit.
        let mut seen = HashSet::new();
        for &frame in schedule {
            if seen.insert(frame) {
                ask_frame(control_send, frame, cfg.rtt_ms).await?;
                asks_sent += 1;
                outstanding.lock().expect("outstanding").insert(frame);
            }
        }
        // Wait until all unique frames arrived.
        let need = seen.len() as u32;
        let start = std::time::Instant::now();
        loop {
            let got = {
                let m = metrics.lock().expect("metrics lock");
                m.frames_on_wire
            };
            if got >= need {
                break;
            }
            if start.elapsed() >= Duration::from_millis(cfg.timeout_ms) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        outstanding.lock().expect("outstanding").clear();
    }

    let mut wait_tasks = Vec::with_capacity(schedule.len());
    for (i, &cursor) in schedule.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(Duration::from_millis(trace.step_interval_ms)).await;
        }
        let d = current_d();
        // Depth bound only — do not await displayable inline. Awaiting here made the
        // windowed arms self-throttle to link service (~50 ms/step) while control offers
        // the trace's 16 ms cadence; that asymmetry dominated the p95 gap.
        wait_outstanding_below(outstanding, d.saturating_sub(1), cfg.timeout_ms).await?;
        asks_sent += emit_window(control_send, outstanding, cursor, d, n, cfg.rtt_ms).await?;
        let metrics_w = Arc::clone(metrics);
        let timeout_ms = cfg.timeout_ms;
        let frame = cursor % n;
        wait_tasks.push(tokio::spawn(async move {
            wait_displayable(&metrics_w, frame, timeout_ms).await
        }));
        if let Some(ctl) = depth_ctl {
            if ctl.lock().expect("depth ctl").oscillating {
                break;
            }
        }
    }

    for task in wait_tasks {
        task.await
            .context("windowed wait task join")?
            .context("windowed wait_displayable")?;
    }

    let oscillating = depth_ctl
        .map(|c| c.lock().expect("depth ctl").oscillating)
        .unwrap_or(false);

    // Drain so bytes_on_wire is comparable with control.
    wait_frames_on_wire(metrics, asks_sent, cfg.timeout_ms).await?;
    wait_outstanding_below(outstanding, 0, cfg.timeout_ms).await?;

    {
        let mut m = metrics.lock().expect("metrics lock");
        m.settle();
    }
    if !oscillating {
        let d = current_d();
        wait_outstanding_below(outstanding, d.saturating_sub(1), cfg.timeout_ms).await?;
        asks_sent += emit_window(control_send, outstanding, wanted, d, n, cfg.rtt_ms).await?;
        wait_displayable(metrics, wanted % n, cfg.timeout_ms).await?;
        wait_wanted(metrics, cfg.timeout_ms, wanted).await?;
    }

    if !oscillating && cfg.fill_dwell_ms > 0 {
        {
            let mut m = metrics.lock().expect("metrics lock");
            m.start_fill();
        }
        let fill_deadline = std::time::Instant::now() + Duration::from_millis(cfg.fill_dwell_ms);
        while std::time::Instant::now() < fill_deadline {
            let d = current_d();
            wait_outstanding_below(outstanding, d.saturating_sub(1).max(0), 2_000).await?;
            asks_sent += emit_window(control_send, outstanding, wanted, d, n, cfg.rtt_ms).await?;
            wait_outstanding_below(outstanding, d.saturating_sub(1).max(0), 2_000).await?;
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        {
            let mut m = metrics.lock().expect("metrics lock");
            m.stop_fill();
        }
    }

    Ok(asks_sent)
}

fn window_frames(center: u32, d: u32, n: u32) -> Vec<u32> {
    let mut out = Vec::with_capacity(d as usize);
    if d == 0 || n == 0 {
        return out;
    }
    out.push(center % n);
    let mut radius = 1u32;
    while out.len() < d as usize {
        let plus = center.wrapping_add(radius) % n;
        if !out.contains(&plus) {
            out.push(plus);
            if out.len() >= d as usize {
                break;
            }
        }
        let minus = center.wrapping_add(n).wrapping_sub(radius % n) % n;
        if !out.contains(&minus) {
            out.push(minus);
        }
        radius += 1;
        if radius > n {
            break;
        }
    }
    out
}

async fn emit_window(
    control_send: &mut wtransport::stream::SendStream,
    outstanding: &Arc<Mutex<HashSet<u32>>>,
    center: u32,
    d: u32,
    n: u32,
    rtt_ms: u64,
) -> Result<u32> {
    let frames = window_frames(center, d, n);
    let mut sent = 0u32;
    for (i, frame) in frames.into_iter().enumerate() {
        {
            let mut o = outstanding.lock().expect("outstanding");
            // Always ask the center (index 0). Neighbours may be skipped when at capacity.
            if i > 0 && o.len() as u32 >= d && !o.contains(&frame) {
                continue;
            }
            o.insert(frame);
            note_outstanding(o.len() as u32);
        }
        ask_frame(control_send, frame, rtt_ms).await?;
        sent += 1;
    }
    Ok(sent)
}

async fn wait_outstanding_below(
    outstanding: &Arc<Mutex<HashSet<u32>>>,
    max: u32,
    timeout_ms: u64,
) -> Result<()> {
    let start = std::time::Instant::now();
    loop {
        {
            let o = outstanding.lock().expect("outstanding");
            if (o.len() as u32) <= max {
                return Ok(());
            }
        }
        if start.elapsed() >= Duration::from_millis(timeout_ms) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
}

/// Wait until `frames_on_wire >= min_frames` (or timeout). Used to drain responses so
/// `bytes_on_wire` counts every ask, not just the first unique displayable.
async fn wait_frames_on_wire(
    metrics: &SharedMetrics,
    min_frames: u32,
    timeout_ms: u64,
) -> Result<()> {
    let start = std::time::Instant::now();
    loop {
        let got = {
            let m = metrics.lock().expect("metrics lock");
            m.frames_on_wire
        };
        if got >= min_frames {
            return Ok(());
        }
        if start.elapsed() >= Duration::from_millis(timeout_ms) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
}

async fn rtt_full(rtt_ms: u64) {
    if rtt_ms > 0 {
        tokio::time::sleep(Duration::from_millis(rtt_ms)).await;
    }
}


/// Writes the ask immediately. **Does not sleep.**
///
/// The ask half of simulated RTT used to be slept here, but every caller awaits
/// `ask_frame` in a loop, so issuing D asks took `D × RTT/2` ms and the asks were
/// never simultaneously in flight — depth became a counter with no wire meaning.
/// The full RTT is now applied once on the return path, which models the same
/// per-frame latency while leaving the issue loop free to pipeline.
async fn ask_frame(
    control_send: &mut wtransport::stream::SendStream,
    frame: u32,
    _rtt_ms: u64,
) -> Result<()> {
    record_ask(frame);
    write_fod_msg(control_send, &FodMsg::RequestFrame { frame }).await
}

async fn wait_displayable(
    metrics: &SharedMetrics,
    frame: u32,
    timeout_ms: u64,
) -> Result<f64> {
    let start = std::time::Instant::now();
    {
        let mut m = metrics.lock().expect("metrics lock");
        if m.cache.contains(&frame) {
            m.record_wait_ms(0.0);
            return Ok(0.0);
        }
    }
    let deadline = Duration::from_millis(timeout_ms);
    loop {
        {
            let mut m = metrics.lock().expect("metrics lock");
            if m.cache.contains(&frame) {
                let ms = start.elapsed().as_secs_f64() * 1000.0;
                m.record_wait_ms(ms);
                return Ok(ms);
            }
        }
        if start.elapsed() >= deadline {
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            metrics.lock().expect("metrics lock").record_wait_ms(ms);
            anyhow::bail!("timeout waiting for displayable frame {frame}");
        }
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
}

async fn wait_wanted(metrics: &SharedMetrics, timeout_ms: u64, wanted: u32) -> Result<()> {
    let deadline = Duration::from_millis(timeout_ms);
    let start = std::time::Instant::now();
    loop {
        {
            let m = metrics.lock().expect("metrics lock");
            if m.wanted_received {
                return Ok(());
            }
        }
        if start.elapsed() >= deadline {
            anyhow::bail!("timeout waiting for wanted frame {wanted}");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

async fn on_frame_arrived(
    index: u32,
    wire_len: u64,
    metrics: &SharedMetrics,
    outstanding: &Arc<Mutex<HashSet<u32>>>,
    in_flight: &Arc<Mutex<u32>>,
    rtt_ms: u64,
    depth_ctl: &Option<Arc<Mutex<DepthController>>>,
    first_byte_at: Instant,
) {
    // Ask→first-byte: first_byte_at is when the length-prefix's first byte arrived,
    // before the body is drained (not ask→last-byte).
    let ask_rtt = take_ask_rtt_ms(index, first_byte_at);
    rtt_full(rtt_ms).await;
    {
        let mut o = outstanding.lock().expect("outstanding");
        o.remove(&index);
    }
    {
        let mut c = in_flight.lock().expect("in_flight");
        *c = c.saturating_sub(1);
    }
    {
        let mut m = metrics.lock().expect("metrics lock");
        m.on_envelope(index, wire_len);
    }
    if let (Some(ctl), Some(rtt)) = (depth_ctl, ask_rtt) {
        ctl.lock()
            .expect("depth ctl")
            .on_frame_completed(rtt, wire_len);
    }
}

/// One shared uni stream carrying `[4B BE envelope_len][envelope]` repeatedly.
///
/// Frames arrive strictly in order — that is the point of the architecture. Post-processing
/// (RTT delay + metrics) is spawned so the read loop is never blocked by it.
async fn shared_stream_loop(
    connection: Connection,
    metrics: SharedMetrics,
    outstanding: Arc<Mutex<HashSet<u32>>>,
    in_flight: Arc<Mutex<u32>>,
    pacer: Arc<tokio::sync::Mutex<LinkPacer>>,
    rtt_ms: u64,
    depth_ctl: Option<Arc<Mutex<DepthController>>>,
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
        let metrics = Arc::clone(&metrics);
        let outstanding = Arc::clone(&outstanding);
        let in_flight = Arc::clone(&in_flight);
        let depth_ctl = depth_ctl.clone();
        tokio::spawn(async move {
            on_frame_arrived(
                index,
                wire_len,
                &metrics,
                &outstanding,
                &in_flight,
                rtt_ms,
                &depth_ctl,
                first_byte_at,
            )
            .await;
        });
    }
    Ok(())
}

async fn accept_uni_loop(
    connection: Connection,
    metrics: SharedMetrics,
    outstanding: Arc<Mutex<HashSet<u32>>>,
    in_flight: Arc<Mutex<u32>>,
    pacer: Arc<tokio::sync::Mutex<LinkPacer>>,
    rtt_ms: u64,
    depth_ctl: Option<Arc<Mutex<DepthController>>>,
) -> Result<()> {
    loop {
        let mut recv = match connection.accept_uni().await {
            Ok(s) => s,
            Err(_) => break,
        };
        let metrics = Arc::clone(&metrics);
        let outstanding = Arc::clone(&outstanding);
        let in_flight = Arc::clone(&in_flight);
        let pacer = Arc::clone(&pacer);
        let depth_ctl = depth_ctl.clone();
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
            on_frame_arrived(
                index,
                (4 + body.len()) as u64,
                &metrics,
                &outstanding,
                &in_flight,
                rtt_ms,
                &depth_ctl,
                first_byte_at,
            )
            .await;
        });
    }
    Ok(())
}
