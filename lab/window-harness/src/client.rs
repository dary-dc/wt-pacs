use crate::metrics::{HarnessMetrics, HarnessMode, RunConfig, SharedMetrics};
use crate::trace::TraceSpec;
use crate::wire::{read_paced, write_fod_msg, LinkPacer};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::unwrap;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use wtransport::{ClientConfig, Connection, Endpoint};

pub async fn run_harness(
    trace: Option<&TraceSpec>,
    cfg: &RunConfig,
    arm_label: &str,
) -> Result<HarnessMetrics> {
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

    let (schedule, wanted, trace_name) = match (cfg.mode, trace) {
        (HarnessMode::Saturate, _) => (Vec::new(), 0u32, "saturate".to_string()),
        (HarnessMode::Trace, Some(t)) => {
            let schedule = t.frame_schedule();
            let wanted = *schedule.last().context("empty trace")?;
            (schedule, wanted, t.name.clone())
        }
        (HarnessMode::Trace, None) => anyhow::bail!("trace mode requires --trace"),
    };

    let metrics: SharedMetrics = Arc::new(Mutex::new(crate::metrics::MetricsState::new(wanted)));

    let conn_uni = connection.clone();
    let metrics_uni = Arc::clone(&metrics);
    let read_bps = cfg.read_bps;
    let pacer = LinkPacer::new(read_bps);
    let outstanding: Arc<Mutex<HashSet<u32>>> = Arc::new(Mutex::new(HashSet::new()));
    let in_flight: Arc<Mutex<u32>> = Arc::new(Mutex::new(0));
    let outstanding_uni = Arc::clone(&outstanding);
    let in_flight_uni = Arc::clone(&in_flight);
    let pacer_uni = Arc::clone(&pacer);
    let uni_task = tokio::spawn(async move {
        if let Err(err) = accept_uni_loop(
            conn_uni,
            metrics_uni,
            outstanding_uni,
            in_flight_uni,
            pacer_uni,
        )
        .await
        {
            eprintln!("uni accept loop ended: {err:#}");
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
            let t = trace.expect("trace");
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
                run_legacy_schedule(&mut control_send, t, cfg, &schedule, wanted, &metrics)
                    .await?
            }
        }
    };

    write_fod_msg(&mut control_send, &FodMsg::EndSession).await?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let _ = uni_task.await;

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
            *in_flight.lock().expect("in_flight") += 1;
        }
        let frame = next_ask % n;
        next_ask = next_ask.wrapping_add(1);
        write_fod_msg(control_send, &FodMsg::RequestFrame { frame }).await?;
        asks_sent += 1;
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
            {
                *in_flight.lock().expect("in_flight") += 1;
            }
            let frame = next_ask % n;
            next_ask = next_ask.wrapping_add(1);
            write_fod_msg(control_send, &FodMsg::RequestFrame { frame }).await?;
            asks_sent += 1;
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
        write_fod_msg(control_send, &FodMsg::RequestFrame { frame }).await?;
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
                write_fod_msg(control_send, &FodMsg::RequestFrame { frame }).await?;
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

    for (i, &cursor) in schedule.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(Duration::from_millis(trace.step_interval_ms)).await;
        }
        // Ask first so depth can pipeline; then measure wait for this cursor.
        asks_sent += emit_window(control_send, outstanding, cursor, d, n).await?;
        wait_displayable(metrics, cursor, cfg.timeout_ms).await?;
        wait_outstanding_below(outstanding, d, cfg.timeout_ms).await?;
    }

    {
        let mut m = metrics.lock().expect("metrics lock");
        m.settle();
    }
    asks_sent += emit_window(control_send, outstanding, wanted, d, n).await?;
    wait_displayable(metrics, wanted, cfg.timeout_ms).await?;
    wait_wanted(metrics, cfg.timeout_ms, wanted).await?;

    if cfg.fill_dwell_ms > 0 {
        {
            let mut m = metrics.lock().expect("metrics lock");
            m.start_fill();
        }
        let fill_deadline = std::time::Instant::now() + Duration::from_millis(cfg.fill_dwell_ms);
        while std::time::Instant::now() < fill_deadline {
            asks_sent += emit_window(control_send, outstanding, wanted, d, n).await?;
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
) -> Result<u32> {
    let frames = window_frames(center, d, n);
    let mut sent = 0u32;
    for frame in frames {
        {
            let mut o = outstanding.lock().expect("outstanding");
            if o.len() as u32 >= d && !o.contains(&frame) {
                continue;
            }
            o.insert(frame);
        }
        write_fod_msg(control_send, &FodMsg::RequestFrame { frame }).await?;
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

async fn accept_uni_loop(
    connection: Connection,
    metrics: SharedMetrics,
    outstanding: Arc<Mutex<HashSet<u32>>>,
    in_flight: Arc<Mutex<u32>>,
    pacer: Arc<tokio::sync::Mutex<LinkPacer>>,
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
            let payload = match read_paced(&mut recv, &pacer).await {
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
            {
                let mut o = outstanding.lock().expect("outstanding");
                o.remove(&index);
            }
            {
                let mut c = in_flight.lock().expect("in_flight");
                *c = c.saturating_sub(1);
            }
            let mut m = metrics.lock().expect("metrics lock");
            m.on_envelope(index, (4 + body.len()) as u64);
        });
    }
    Ok(())
}
