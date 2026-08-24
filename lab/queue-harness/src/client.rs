use crate::metrics::{HarnessMetrics, RunConfig, SharedMetrics};
use crate::trace::TraceSpec;
use crate::wire::{read_paced, write_fod_msg};
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::unwrap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use wtransport::{ClientConfig, Connection, Endpoint};

pub async fn run_harness(
    trace: &TraceSpec,
    cfg: &RunConfig,
    server_cancel_enabled: bool,
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
    let uni_task = tokio::spawn(async move {
        if let Err(err) = accept_uni_loop(conn_uni, metrics_uni, read_bps).await {
            eprintln!("uni accept loop ended: {err:#}");
        }
    });

    let (mut control_send, _control_recv) = connection
        .open_bi()
        .await
        .context("open bi")?
        .await
        .context("open bi ready")?;

    let mut asked: Vec<u32> = Vec::new();
    for (i, &frame) in schedule.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(Duration::from_millis(trace.step_interval_ms)).await;
        }
        write_fod_msg(
            &mut control_send,
            &FodMsg::RequestFrame { frame },
        )
        .await?;
        asked.push(frame);
    }

    let client_sent_cancel = trace.send_cancel_on_settle && cfg.send_cancel;
    if client_sent_cancel {
        {
            let mut m = metrics.lock().expect("metrics lock");
            m.settle();
        }
        let cancel: Vec<u32> = asked
            .iter()
            .copied()
            .filter(|&f| f != wanted)
            .collect();
        if !cancel.is_empty() {
            write_fod_msg(&mut control_send, &FodMsg::CancelFrames { frames: cancel }).await?;
        }
    } else {
        let mut m = metrics.lock().expect("metrics lock");
        m.settle();
    }

    let deadline = Duration::from_millis(cfg.timeout_ms);
    let start = std::time::Instant::now();
    loop {
        {
            let m = metrics.lock().expect("metrics lock");
            if m.wanted_received {
                break;
            }
        }
        if start.elapsed() >= deadline {
            anyhow::bail!("timeout waiting for wanted frame {wanted}");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }

    write_fod_msg(&mut control_send, &FodMsg::EndSession).await?;
    // Let in-flight uni streams finish so wire totals are complete.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let _ = uni_task.await;

    let m = metrics.lock().expect("metrics lock");
    Ok(m.finalize(
        &trace.name,
        cfg.read_bps,
        server_cancel_enabled,
        client_sent_cancel,
        asked.len() as u32,
    ))
}

async fn accept_uni_loop(
    connection: Connection,
    metrics: SharedMetrics,
    read_bps: u64,
) -> Result<()> {
    loop {
        let mut recv = match connection.accept_uni().await {
            Ok(s) => s,
            Err(_) => break,
        };
        let metrics = Arc::clone(&metrics);
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
            let mut m = metrics.lock().expect("metrics lock");
            m.on_envelope(index, (4 + body.len()) as u64);
        });
    }
    Ok(())
}
