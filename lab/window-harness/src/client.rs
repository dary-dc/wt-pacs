use crate::metrics::{
    HarnessMetrics, HarnessMode, ReaderMode, RunConfig, SharedMetrics, StreamMode, WindowShape,
};
use crate::trace::TraceSpec;
use crate::wire::{read_framed_paced, write_fod_msg, LinkPacer};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::unwrap;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
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
    CENTER_DROPPED.store(0, Ordering::Relaxed);
}

/// Steps whose centre ask was suppressed by the hard outstanding ceiling.
///
/// The centre is the frame whose wait is being measured. If its ask never went out, the
/// step measured the harness's own ask policy, not the transport. **Any run with a
/// non-zero count is void for p95 purposes**, and the campaign analyser must say so
/// rather than quietly averaging it in.
static CENTER_DROPPED: AtomicU32 = AtomicU32::new(0);

fn note_center_dropped() {
    CENTER_DROPPED.fetch_add(1, Ordering::Relaxed);
}

pub fn center_asks_dropped() -> u32 {
    CENTER_DROPPED.load(Ordering::Relaxed)
}

/// Per-session ask ordinals for offline join with server `telemetry-server.json`.
/// Rule: increment per `frame_index` (0-based), same as server Tap `take_ordinal`.
static ASK_ORDINALS: LazyLock<Mutex<HashMap<u32, u32>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static ASK_JOIN: LazyLock<Mutex<Vec<crate::metrics::AskJoinRow>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

pub fn reset_ask_join() {
    ASK_ORDINALS.lock().expect("ask ordinals").clear();
    ASK_JOIN.lock().expect("ask join").clear();
}

pub fn take_ask_join() -> Vec<crate::metrics::AskJoinRow> {
    ASK_JOIN.lock().expect("ask join").clone()
}

fn record_ask(frame_index: u32) {
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


pub(crate) fn build_client_config(
    stream_recv_window: Option<u64>,
    bind_ip: Option<std::net::IpAddr>,
) -> Result<ClientConfig> {
    // Default is wtransport's dual-stack bind, which is what every L1 row was collected
    // with. An explicit address is needed only on hosts with no IPv6 stack, where the
    // dual-stack bind fails with EAFNOSUPPORT.
    let builder = match bind_ip {
        None => ClientConfig::builder().with_bind_default(),
        Some(ip) => ClientConfig::builder().with_bind_address(std::net::SocketAddr::new(ip, 0)),
    };
    match stream_recv_window {
        None => Ok(builder
            .with_no_cert_validation()
            .keep_alive_interval(Some(Duration::from_secs(3)))
            .build()),
        Some(bytes) => {
            // A3: same insecure TLS as the default path, with a custom stream receive window.
            use std::sync::Arc;
            use rustls::RootCertStore;
            use wtransport::config::QuicTransportConfig;
            use wtransport::tls::client::{build_default_tls_config, NoServerVerification};

            let tls = build_default_tls_config(
                Arc::new(RootCertStore::empty()),
                Some(Arc::new(NoServerVerification::new())),
            );
            let mut transport = QuicTransportConfig::default();
            let window = wtransport::quinn::VarInt::from_u64(bytes)
                .map_err(|_| anyhow::anyhow!("stream_recv_window {bytes} out of VarInt range"))?;
            transport.stream_receive_window(window);
            Ok(builder
                .with_custom_tls_and_transport(tls, transport)
                .keep_alive_interval(Some(Duration::from_secs(3)))
                .build())
        }
    }
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

    let client_cfg = build_client_config(cfg.stream_recv_window, cfg.bind_ip)?;

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
    metrics.lock().expect("metrics").cache_cap = cfg.cache_frames;

    let conn_uni = connection.clone();
    let metrics_uni = Arc::clone(&metrics);
    let read_bps = cfg.read_bps;
    let pacer = LinkPacer::new(read_bps);
    let outstanding: Arc<Mutex<HashSet<u32>>> = Arc::new(Mutex::new(HashSet::new()));
    let in_flight: Arc<Mutex<u32>> = Arc::new(Mutex::new(0));
    let outstanding_uni = Arc::clone(&outstanding);
    let in_flight_uni = Arc::clone(&in_flight);
    let pacer_uni = Arc::clone(&pacer);
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
            if cfg.depth > 0 {
                run_windowed(
                    &mut control_send,
                    t,
                    cfg,
                    &schedule,
                    wanted,
                    &metrics,
                    &outstanding,
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
    let m = metrics.lock().expect("metrics lock");
    Ok(m.finalize(
        &trace_name,
        mode,
        cfg.read_bps,
        cfg.depth,
        arm_label,
        asks_sent,
        cfg.fill_dwell_ms,
        cfg.warm_cache,
        cfg.rtt_ms,
        cfg.stream_mode,
        cfg.reader_mode,
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
) -> Result<u32> {
    let mut asks_sent = 0u32;
    for (i, &frame) in schedule.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(Duration::from_millis(trace.step_interval_ms)).await;
        }
        ask_frame(control_send, frame, cfg.rtt_ms).await?;
        asks_sent += 1;
    }

    {
        let mut m = metrics.lock().expect("metrics lock");
        m.settle();
    }

    wait_wanted(metrics, cfg.timeout_ms, wanted).await?;
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
) -> Result<u32> {
    let n = cfg.frame_count.max(1);
    let d = cfg.depth;
    let mut asks_sent = 0u32;

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

    let step_interval_ms = cfg.step_interval_ms.unwrap_or(trace.step_interval_ms);
    let step_loop_start = std::time::Instant::now();
    match cfg.reader_mode {
        // L1's reader: advances on an absolute schedule and *measures* how late each frame
        // is, but still blocks on the frame before moving on. Its own Phase C review found
        // the consequence — BACKLOG on 9 of 20 rows — because a reader that blocks cannot
        // fall behind by more than one frame at a time.
        ReaderMode::Closed => {
    for (i, &cursor) in schedule.iter().enumerate() {
        // Advance on the trace clock (absolute schedule). Miss waits that overrun
        // the interval stretch the loop — that is the backlog C4 / A2 detect.
        let target = step_loop_start + Duration::from_millis(step_interval_ms.saturating_mul(i as u64));
        let now = std::time::Instant::now();
        if target > now {
            tokio::time::sleep(target - now).await;
        }
        // Ask first so depth can pipeline; then measure wait for this cursor.
        // C4: do NOT wait_outstanding_below here — that link-paces the reader.
        // emit_window already caps concurrency via the outstanding set.
        asks_sent += emit_window(
            control_send,
            outstanding,
            metrics,
            cursor,
            d,
            n,
            cfg.rtt_ms,
            cfg.window_shape,
            false,
        )
        .await?;
        // `window_frames` asks for `cursor % n`, so wait for the same frame. Waiting on the
        // raw cursor hangs for the full timeout on any trace whose cursor exceeds the study's
        // frame count - which is how mild_cell_scroll (300 frames) "timed out" against an
        // 80-frame fixture. See docs/measurements/r2/TASK_B.md.
        wait_displayable(metrics, cursor % n, cfg.timeout_ms, Some(target)).await?;
    }
        }
        // R6's reader: never blocks, so the transport can fall behind by an unbounded
        // amount and the reader is genuinely stuck behind data it no longer wants. This is
        // the mode in which head-of-line blocking can occur at all.
        ReaderMode::Open => {
            asks_sent +=
                run_reader_open_loop(control_send, trace, cfg, schedule, metrics, outstanding)
                    .await?;
        }
    }

    {
        let mut m = metrics.lock().expect("metrics lock");
        m.step_loop_ms = step_loop_start.elapsed().as_secs_f64() * 1000.0;
        m.settle();
    }
    asks_sent += emit_window(
        control_send,
        outstanding,
        metrics,
        wanted,
        d,
        n,
        cfg.rtt_ms,
        cfg.window_shape,
        false,
    )
    .await?;
    wait_displayable(metrics, wanted % n, cfg.timeout_ms, None).await?;
    wait_wanted(metrics, cfg.timeout_ms, wanted).await?;

    if cfg.fill_dwell_ms > 0 {
        {
            let mut m = metrics.lock().expect("metrics lock");
            m.start_fill();
        }
        let fill_deadline = std::time::Instant::now() + Duration::from_millis(cfg.fill_dwell_ms);
        while std::time::Instant::now() < fill_deadline {
            asks_sent += emit_window(
                control_send,
                outstanding,
                metrics,
                wanted,
                d,
                n,
                cfg.rtt_ms,
                cfg.window_shape,
                false,
            )
            .await?;
            wait_outstanding_below(outstanding, d.saturating_sub(1), 2_000).await?;
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        {
            let mut m = metrics.lock().expect("metrics lock");
            m.stop_fill();
        }
    }

    Ok(asks_sent)
}

/// One outstanding want: the frame the reader is looking at, and when it asked for it.
struct Want {
    frame: u32,
    wanted_at: std::time::Instant,
}

/// The reader advances on the trace's own wall clock and never waits for the transport.
///
/// This is the whole point of the mode. A closed-loop reader (`ReaderMode::Closed`) blocks
/// on each cursor before advancing, so the transport can never fall behind it and every
/// byte in flight is a byte the reader still wants. Under those conditions head-of-line
/// blocking cannot occur and no stream-shape comparison means anything — which is how a
/// "keep one shared stream" recommendation came to be written on evidence that could not
/// support it (`docs/transport-conclusions.md` §2).
///
/// Three properties matter for the numbers this produces to be trustworthy:
///
/// 1. **Steps are absolute deadlines**, `t0 + i × step`, not `sleep(step)` per iteration.
///    Per-iteration sleeps accumulate the ask-emission cost into the schedule, so a slower
///    arm would silently get a slower reader — flattering exactly the arm under suspicion.
/// 2. **Waits are resolved from recorded arrival instants**, not by polling cache
///    membership. Poll granularity therefore cannot quantise a wait, and a frame that
///    arrives and is LRU-evicted before the next poll is still scored as delivered.
/// 3. **Unmet wants are censored, not dropped.** An arm that fails to deliver would
///    otherwise lose its slowest samples and win on p95 by delivering less.
async fn run_reader_open_loop(
    control_send: &mut wtransport::stream::SendStream,
    trace: &TraceSpec,
    cfg: &RunConfig,
    schedule: &[u32],
    metrics: &SharedMetrics,
    outstanding: &Arc<Mutex<HashSet<u32>>>,
) -> Result<u32> {
    let n = cfg.frame_count.max(1);
    let d = cfg.depth;
    let mut asks_sent = 0u32;
    let mut pending: Vec<Want> = Vec::new();

    let t0 = tokio::time::Instant::now();
    // Both knobs apply: L1's absolute override picks the cadence, R6's multiplier moves
    // the operating point relative to it.
    let base_ms = cfg.step_interval_ms.unwrap_or(trace.step_interval_ms);
    let step = Duration::from_secs_f64((base_ms as f64 * cfg.step_scale.max(0.001)) / 1000.0);

    for (i, &cursor) in schedule.iter().enumerate() {
        // Absolute deadline. If emission overran the previous step this returns
        // immediately and the reader is simply late — which is recorded, not hidden.
        tokio::time::sleep_until(t0 + step * i as u32).await;

        let frame = cursor % n;
        let window = window_frames(cursor, d, n, cfg.window_shape);
        {
            // Publish the window before asking, so a frame arriving for a position the
            // reader has left is attributed as stranded from this instant on.
            let mut m = metrics.lock().expect("metrics");
            m.live_window = window.iter().copied().collect();
        }

        // Non-blocking: a full depth gate drops the prefetch rather than stalling the
        // reader. `center_first` keeps the frame actually on screen exempt from that cap,
        // which is what a viewer does and which stops the metric from measuring ask
        // policy instead of transport.
        asks_sent += emit_window(
            control_send,
            outstanding,
            metrics,
            cursor,
            d,
            n,
            cfg.rtt_ms,
            cfg.window_shape,
            true,
        )
        .await?;

        // Register the want, then resolve whatever has landed. A cache hit is a genuine
        // zero: the reader had the frame the instant it wanted it.
        let hit = {
            let mut m = metrics.lock().expect("metrics");
            if m.cache.contains(&frame) {
                m.touch_cache(frame);
                m.record_wait_ms(0.0);
                true
            } else {
                false
            }
        };
        if !hit {
            pending.push(Want {
                frame,
                wanted_at: std::time::Instant::now(),
            });
        }
        resolve_pending(&mut pending, metrics);
    }

    // Measured here, before the drain — `t0.elapsed()` after draining would add
    // `drain_ms` to every run and report a lag the reader never had.
    let lag_ms = reader_lag_ms(t0, schedule.len(), step);

    // The reader has stopped scrolling. Give the transport a bounded chance to finish
    // what it owes before anything is called censored.
    let drain_deadline = tokio::time::Instant::now() + Duration::from_millis(cfg.drain_ms);
    while !pending.is_empty() && tokio::time::Instant::now() < drain_deadline {
        tokio::time::sleep(Duration::from_millis(5)).await;
        resolve_pending(&mut pending, metrics);
    }

    // Anything still owed is censored at its bound — recorded as a slow sample and
    // counted, never discarded.
    {
        let mut m = metrics.lock().expect("metrics");
        for w in pending.drain(..) {
            let ms = w.wanted_at.elapsed().as_secs_f64() * 1000.0;
            m.record_wait_ms(ms);
            m.censored_waits += 1;
        }
        m.reader_lag_ms = lag_ms;
    }

    Ok(asks_sent)
}

/// Move every want whose frame has arrived since it was wanted into the wait samples.
///
/// Uses the recorded arrival instant, so the sample is the true wait rather than the
/// time this happened to be called.
fn resolve_pending(pending: &mut Vec<Want>, metrics: &SharedMetrics) {
    let mut m = metrics.lock().expect("metrics");
    pending.retain(|w| match m.last_arrival.get(&w.frame).copied() {
        Some(t) if t >= w.wanted_at => {
            let ms = t.duration_since(w.wanted_at).as_secs_f64() * 1000.0;
            m.record_wait_ms(ms);
            false
        }
        _ => true,
    });
}

/// How far behind its own clock an open-loop reader finished.
///
/// Zero means the reader kept its schedule, the transport never fell behind, and the run
/// tested nothing a closed-loop run does not.
fn reader_lag_ms(t0: tokio::time::Instant, schedule_len: usize, step: Duration) -> f64 {
    let planned = step * schedule_len.saturating_sub(1) as u32;
    t0.elapsed().saturating_sub(planned).as_secs_f64() * 1000.0
}

fn window_frames(center: u32, d: u32, n: u32, shape: WindowShape) -> Vec<u32> {
    let mut out = Vec::with_capacity(d as usize);
    if d == 0 || n == 0 {
        return out;
    }
    if shape == WindowShape::Forward {
        for r in 0..d.min(n) {
            out.push(center.wrapping_add(r) % n);
        }
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

#[allow(clippy::too_many_arguments)]
async fn emit_window(
    control_send: &mut wtransport::stream::SendStream,
    outstanding: &Arc<Mutex<HashSet<u32>>>,
    metrics: &SharedMetrics,
    center: u32,
    d: u32,
    n: u32,
    rtt_ms: u64,
    shape: WindowShape,
    center_exempt: bool,
) -> Result<u32> {
    let frames = window_frames(center, d, n, shape);
    let mut sent = 0u32;
    for (slot, frame) in frames.into_iter().enumerate() {
        // `window_frames` puts the centre — the frame actually on screen — at slot 0.
        // Under an open-loop reader it is exempt from the depth cap, because a viewer
        // prioritises what it is looking at and, without the exemption, a full window
        // silently drops the ask for the very frame whose wait is being measured. Under
        // the closed-loop reader the cap stays strict: L1's committed rows were collected
        // that way and an exemption here would make them irreproducible.
        let is_center = center_exempt && slot == 0;
        // Already displayable: re-asking re-sends a frame the client holds. On the shared arm
        // those bytes queue ahead of frames the reader is waiting for — the exact head-of-line
        // cost this lane exists to measure. Never manufacture it here. Measured from
        // committed data, the missing guard was 7.6-13.7x redundant load, and it was
        // self-reinforcing: a slower arm holds frames outstanding longer, gets re-asked
        // more, and loads its own link more.
        //
        // LOCK ORDER: take `metrics`, drop it, THEN take `outstanding`. Never hold both:
        // `on_frame_arrived` takes them in the opposite order and would deadlock.
        {
            // A hit must also refresh recency, or the bounded cache is FIFO-by-arrival
            // rather than LRU and evicts the frame the reader is currently looking at on
            // the same schedule as one never displayed. No-op when `cache_cap` is 0.
            let mut m = metrics.lock().expect("metrics lock");
            if m.cache.contains(&frame) {
                m.touch_cache(frame);
                continue;
            }
        }
        {
            let mut o = outstanding.lock().expect("outstanding");
            // Already in flight: do not re-ask. Re-asking is what produced v2's
            // ~6× ask inflation and is exactly what S3 polices.
            if o.contains(&frame) {
                continue;
            }
            // Prefetch is capped at D. An exempt centre may exceed it, but only to a hard
            // ceiling of 2D: with an open-loop reader nothing retires an ask except the
            // frame arriving, so an unconditionally exempt centre adds one ask per step
            // forever, and a reader that outran the transport would flood its own link
            // and self-congest. That would make every arm's result a measurement of the
            // harness. `note_center_dropped` records the ceiling binding, because a
            // dropped centre ask makes that step's wait uninterpretable.
            if o.len() as u32 >= d.saturating_mul(2) {
                if is_center {
                    note_center_dropped();
                }
                continue;
            }
            if !is_center && o.len() as u32 >= d {
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

/// Waits until `frame` is displayable, recording two different clocks.
///
/// `wait_ms` runs from this call — i.e. from the harness's ask. `due` is the step's
/// *scheduled* display time, fixed at `loop_start + i*interval` before any network
/// work; lateness against it is what the reader felt. The two diverge exactly when
/// the loop has fallen behind, which is the case `wait_ms` cannot report and which
/// voided the v2 grid (`stream-mode-remediation.md` §R4, L1_V2_ADVERSARIAL_REVIEW §B1).
/// `due` is `None` outside the trace step loop, where there is no schedule to miss.
async fn wait_displayable(
    metrics: &SharedMetrics,
    frame: u32,
    timeout_ms: u64,
    due: Option<std::time::Instant>,
) -> Result<f64> {
    let start = std::time::Instant::now();
    let note = |m: &mut crate::metrics::MetricsState, wait_ms: f64, at: std::time::Instant| {
        m.record_wait_ms(wait_ms);
        if let Some(due) = due {
            m.record_lateness_ms(at.saturating_duration_since(due).as_secs_f64() * 1000.0);
        }
    };
    {
        let mut m = metrics.lock().expect("metrics lock");
        if m.cache.contains(&frame) {
            note(&mut m, 0.0, start);
            return Ok(0.0);
        }
    }
    let deadline = Duration::from_millis(timeout_ms);
    loop {
        {
            let mut m = metrics.lock().expect("metrics lock");
            if m.cache.contains(&frame) {
                let now = std::time::Instant::now();
                let ms = now.duration_since(start).as_secs_f64() * 1000.0;
                note(&mut m, ms, now);
                return Ok(ms);
            }
        }
        if start.elapsed() >= deadline {
            let now = std::time::Instant::now();
            let ms = now.duration_since(start).as_secs_f64() * 1000.0;
            note(&mut metrics.lock().expect("metrics lock"), ms, now);
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
) {
    rtt_full(rtt_ms).await;
    {
        let mut o = outstanding.lock().expect("outstanding");
        o.remove(&index);
    }
    {
        let mut c = in_flight.lock().expect("in_flight");
        *c = c.saturating_sub(1);
    }
    let mut m = metrics.lock().expect("metrics lock");
    m.on_envelope(index, wire_len);
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
) -> Result<()> {
    let mut recv = match connection.accept_uni().await {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    loop {
        let payload = match read_framed_paced(&mut recv, &pacer).await {
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
        tokio::spawn(async move {
            on_frame_arrived(index, wire_len, &metrics, &outstanding, &in_flight, rtt_ms).await;
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
        tokio::spawn(async move {
            let payload = match read_framed_paced(&mut recv, &pacer).await {
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
            )
            .await;
        });
    }
    Ok(())
}

#[cfg(test)]
mod window_shape_tests {
    use super::window_frames;
    use crate::metrics::WindowShape;

    #[test]
    fn forward_window_never_looks_back() {
        assert_eq!(
            window_frames(40, 7, 80, WindowShape::Forward),
            vec![40, 41, 42, 43, 44, 45, 46]
        );
    }

    #[test]
    fn symmetric_window_is_unchanged() {
        assert_eq!(
            window_frames(40, 7, 80, WindowShape::Symmetric),
            vec![40, 41, 39, 42, 38, 43, 37]
        );
    }
}
