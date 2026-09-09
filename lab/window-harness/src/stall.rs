//! The pathological client: asks a lot, stops reading, stays connected. mem/stall-client.md §3.1.

use crate::metrics::{RunConfig, StreamMode};
use anyhow::{Context, Result};
use fod::FodMsg;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use wtransport::Connection;

/// Stall-only knobs. Kept off `RunConfig` so campaign rows do not grow unused fields.
#[derive(Debug, Clone)]
pub struct StallConfig {
    /// Stop reading this long after the first byte, not after connect.
    pub stall_after_ms: u64,
    pub asks: u32,
    pub hold_ms: u64,
}

/// One stalled-client run. Zero `bytes_read` or a dead connection voids the row.
#[derive(Debug, Serialize)]
pub struct StallOutcome {
    pub arm: String,
    pub stream_mode: String,
    pub stall_after_ms: u64,
    pub hold_ms: u64,
    pub asks_requested: u32,
    pub asks_sent: u32,
    pub bytes_read: u64,
    pub stall_engaged: bool,
    pub uni_streams_opened: u32,
    pub connection_alive_at_end: bool,
    pub close_reason: String,
    pub elapsed_ms: f64,
}

pub async fn run_stall_client(
    cfg: &RunConfig,
    stall: &StallConfig,
    arm_label: &str,
) -> Result<StallOutcome> {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let client_cfg = crate::client::build_client_config(cfg.stream_recv_window, cfg.bind_ip)?;
    let endpoint = wtransport::Endpoint::client(client_cfg).context("wtransport client")?;
    let connection = endpoint
        .connect(cfg.wt_url.clone())
        .await
        .context("connect")?;

    let started = Instant::now();

    let deadline: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    let stalled = Arc::new(AtomicBool::new(false));
    let bytes_read = Arc::new(AtomicU64::new(0));
    let streams_opened = Arc::new(AtomicU32::new(0));

    let reader = tokio::spawn(accept_and_read(
        connection.clone(),
        cfg.stream_mode,
        stall.stall_after_ms,
        Arc::clone(&deadline),
        Arc::clone(&stalled),
        Arc::clone(&bytes_read),
        Arc::clone(&streams_opened),
    ));

    let (mut control_send, _control_recv) = connection
        .open_bi()
        .await
        .context("open bi")?
        .await
        .context("open bi ready")?;

    let n = cfg.frame_count.max(1);
    let mut asks_sent = 0u32;
    for i in 0..stall.asks {
        match crate::wire::write_fod_msg(&mut control_send, &FodMsg::RequestFrame { frame: i % n })
            .await
        {
            Ok(()) => asks_sent += 1,
            Err(_) => break,
        }
    }

    let hold_until =
        Instant::now() + Duration::from_millis(stall.stall_after_ms.saturating_add(stall.hold_ms));
    while Instant::now() < hold_until {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let conn_for_probe = connection.clone();
    let (alive, close_reason) =
        match tokio::time::timeout(Duration::from_millis(50), conn_for_probe.closed()).await {
            Err(_) => (true, String::new()),
            Ok(reason) => (false, format!("{reason:?}")),
        };

    reader.abort();
    let _ = reader.await;

    let outcome = StallOutcome {
        arm: arm_label.to_string(),
        stream_mode: match cfg.stream_mode {
            StreamMode::Shared => "shared".to_string(),
            StreamMode::PerFrame => "per-frame".to_string(),
        },
        stall_after_ms: stall.stall_after_ms,
        hold_ms: stall.hold_ms,
        asks_requested: stall.asks,
        asks_sent,
        bytes_read: bytes_read.load(Ordering::Relaxed),
        stall_engaged: stalled.load(Ordering::Relaxed),
        uni_streams_opened: streams_opened.load(Ordering::Relaxed),
        connection_alive_at_end: alive,
        close_reason,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
    };

    connection.close(0u32.into(), b"stall done");
    Ok(outcome)
}

/// Read until the deadline, then park the streams. Dropping one sends `STOP_SENDING`.
async fn accept_and_read(
    connection: Connection,
    stream_mode: StreamMode,
    stall_after_ms: u64,
    deadline: Arc<Mutex<Option<Instant>>>,
    stalled: Arc<AtomicBool>,
    bytes_read: Arc<AtomicU64>,
    streams_opened: Arc<AtomicU32>,
) {
    let mut held: Vec<wtransport::stream::RecvStream> = Vec::new();

    match stream_mode {
        StreamMode::Shared => {
            if let Ok(recv) = connection.accept_uni().await {
                streams_opened.fetch_add(1, Ordering::Relaxed);
                let mut recv = recv;
                read_until_stall(&mut recv, stall_after_ms, &deadline, &stalled, &bytes_read).await;
                held.push(recv);
            }
        }
        StreamMode::PerFrame => {
            while let Ok(mut recv) = connection.accept_uni().await {
                streams_opened.fetch_add(1, Ordering::Relaxed);
                read_until_stall(&mut recv, stall_after_ms, &deadline, &stalled, &bytes_read).await;
                held.push(recv);
            }
        }
    }

    loop {
        tokio::time::sleep(Duration::from_secs(3600)).await;
    }
}

async fn read_until_stall(
    recv: &mut wtransport::stream::RecvStream,
    stall_after_ms: u64,
    deadline: &Arc<Mutex<Option<Instant>>>,
    stalled: &Arc<AtomicBool>,
    bytes_read: &Arc<AtomicU64>,
) {
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let until = *deadline.lock().expect("stall deadline");
        if let Some(t) = until {
            if Instant::now() >= t {
                stalled.store(true, Ordering::Relaxed);
                return;
            }
        }
        let slice = match until {
            Some(t) => t.saturating_duration_since(Instant::now()),
            None => Duration::from_millis(200),
        };
        match tokio::time::timeout(slice.max(Duration::from_millis(1)), recv.read(&mut buf)).await {
            Err(_) => continue,
            Ok(Ok(Some(n))) if n > 0 => {
                bytes_read.fetch_add(n as u64, Ordering::Relaxed);
                let mut d = deadline.lock().expect("stall deadline");
                if d.is_none() {
                    *d = Some(Instant::now() + Duration::from_millis(stall_after_ms));
                }
            }
            Ok(Ok(_)) | Ok(Err(_)) => return,
        }
    }
}
