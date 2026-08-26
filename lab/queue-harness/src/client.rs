use crate::metrics::{HarnessMetrics, RunConfig, SharedMetrics};
use crate::trace::TraceSpec;
use crate::wire::{read_paced, write_fod_msg};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::unwrap;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use wtransport::{ClientConfig, Connection, Endpoint};

pub async fn run_harness(
    trace: &TraceSpec,
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

    let schedule = trace.frame_schedule();
    let wanted = *schedule.last().context("empty trace")?;
    let metrics: SharedMetrics = Arc::new(Mutex::new(crate::metrics::MetricsState::new(wanted)));

    let conn_uni = connection.clone();
    let metrics_uni = Arc::clone(&metrics);
    let read_bps = cfg.read_bps;
    let outstanding: Arc<Mutex<HashSet<u32>>> = Arc::new(Mutex::new(HashSet::new()));
    let outstanding_uni = Arc::clone(&outstanding);
    let uni_task = tokio::spawn(async move {
        if let Err(err) =
            accept_uni_loop(conn_uni, metrics_uni, outstanding_uni, read_bps).await
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

    let asks_sent = if cfg.depth > 0 {
        run_windowed(
            &mut control_send,
            trace,
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
            trace,
            cfg,
            &schedule,
            wanted,
            &metrics,
        )
        .await?
    };

    write_fod_msg(&mut control_send, &FodMsg::EndSession).await?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let _ = uni_task.await;

    let m = metrics.lock().expect("metrics lock");
    Ok(m.finalize(
        &trace.name,
        cfg.read_bps,
        cfg.depth,
        arm_label,
        asks_sent,
        cfg.fill_dwell_ms,
    ))
}

/// Legacy: fire every schedule step then settle (D≈1 / no window).
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
        write_fod_msg(
            control_send,
            &FodMsg::RequestFrame {
                frame,
                generation: 0,
            },
        )
        .await?;
        asks_sent += 1;
    }

    {
        let mut m = metrics.lock().expect("metrics lock");
        m.settle();
    }

    wait_wanted(metrics, cfg.timeout_ms, wanted).await?;
    Ok(asks_sent)
}

/// Depth-D window: bump generation on each move; refill to D outstanding.
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
    let mut generation = 0u32;
    let mut asks_sent = 0u32;

    for (i, &cursor) in schedule.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(Duration::from_millis(trace.step_interval_ms)).await;
        }
        generation = generation.saturating_add(1);
        asks_sent += emit_window(
            control_send,
            outstanding,
            cursor,
            d,
            n,
            generation,
        )
        .await?;

        // Cap outstanding: wait until below D before next move if we overshot.
        wait_outstanding_below(outstanding, d, cfg.timeout_ms).await?;
    }

    // Settle on wanted: new generation so GEN ordering can jump the queue.
    {
        let mut m = metrics.lock().expect("metrics lock");
        m.settle();
    }
    generation = generation.saturating_add(1);
    asks_sent += emit_window(control_send, outstanding, wanted, d, n, generation).await?;

    wait_wanted(metrics, cfg.timeout_ms, wanted).await?;

    // Stationary fill: keep window warm at same generation; measure fill_rate.
    if cfg.fill_dwell_ms > 0 {
        {
            let mut m = metrics.lock().expect("metrics lock");
            m.start_fill();
        }
        let fill_deadline = std::time::Instant::now() + Duration::from_millis(cfg.fill_dwell_ms);
        while std::time::Instant::now() < fill_deadline {
            asks_sent += emit_window(control_send, outstanding, wanted, d, n, generation).await?;
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

/// Window around center: center first, then +1,−1,+2,−2… (arrival order = client priority).
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
    generation: u32,
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
        write_fod_msg(
            control_send,
            &FodMsg::RequestFrame { frame, generation },
        )
        .await?;
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
            return Ok(()); // soft — don't fail the run on depth wait
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
    read_bps: u64,
) -> Result<()> {
    loop {
        let mut recv = match connection.accept_uni().await {
            Ok(s) => s,
            Err(_) => break,
        };
        let metrics = Arc::clone(&metrics);
        let outstanding = Arc::clone(&outstanding);
        tokio::spawn(async move {
            let payload = match read_paced(&mut recv, read_bps).await {
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
            let mut m = metrics.lock().expect("metrics lock");
            m.on_envelope(index, (4 + body.len()) as u64);
        });
    }
    Ok(())
}
