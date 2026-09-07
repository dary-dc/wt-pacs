//! The pathological client: asks for a lot, then stops reading.
//!
//! Every other mode in this harness reads. That is why
//! `docs/measurements/mem/README.md` closes with the admission that the flow-control
//! ceilings could not be measured — *"What would actually reach the ceiling is a client
//! that asks for a lot and then stops reading entirely… This harness always reads, so it
//! cannot produce that case."* A ceiling that is never approached cannot be distinguished
//! from a different ceiling, so the light and stress sweeps compared 110 KB against 114 KB
//! and 162 KB against 146 KB — real, ordered, and three orders below the 10 MB
//! `send_window` the worry was actually about.
//!
//! This module produces the case. It is deliberately **separate** from `client.rs`: every
//! campaign already recorded on this branch must stay reproducible byte for byte, and the
//! surest way to guarantee that is for the stalled client to share no code path with the
//! reader that produced them.
//!
//! # What "stops reading" has to mean
//!
//! Not "reads slowly" — `--read-bps` already does that, and it is the *stress* workload
//! that measured 162 KB. A paced reader still drains, so the receiver keeps extending
//! stream flow-control credit and the server's send buffer keeps emptying. The ceiling is
//! never approached.
//!
//! Stopping means three things at once, and dropping any one of them measures nothing:
//!
//! 1. **No `read()` call is ever issued again.** Not a slower one.
//! 2. **The receive streams stay alive.** Dropping a `RecvStream` makes quinn send
//!    `STOP_SENDING`, the server abandons the stream, and its buffer drains — the opposite
//!    of the case under test. The streams are therefore parked in `_held`, unread and
//!    undropped, until the run ends.
//! 3. **The connection stays open.** No `EndSession`, no `close()`. A client that says
//!    goodbye frees the server's state, which is the opposite of the case under test.
//!
//! # Which stalled client this is
//!
//! **This is the client that keeps its connection alive, not the one that goes silent**, and
//! the distinction is a threat model rather than a detail. `build_client_config` sets
//! `keep_alive_interval(3s)`, so the peer measured here is never quiet. A genuinely silent
//! client — a suspended laptop — is reaped by quinn's 30 s idle timeout, so its cost is
//! bounded by 30 seconds no matter how much it asked for.
//!
//! Only a peer that actively keeps the connection alive can hold the server's memory
//! indefinitely. Both cost the same *per second*, so the per-connection figures are the same
//! either way; what differs is for how long. Read §3.1's numbers as the sustained case.
//!
//! `connection_alive_at_end` is the gate on all three. A row where it is false measured a
//! teardown, not a stall, and must be voided rather than averaged in.

use crate::metrics::{RunConfig, StreamMode};
use anyhow::{Context, Result};
use fod::FodMsg;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use wtransport::Connection;

/// How the stalled client is configured. Separate from `RunConfig` so that struct — read
/// by every campaign on this branch — does not grow fields that only one mode uses.
#[derive(Debug, Clone)]
pub struct StallConfig {
    /// Stop reading this long after the **first byte arrives**, not after connect.
    ///
    /// Anchored to the first byte so the stall is guaranteed to interrupt delivery in
    /// progress. Anchored to connect, a slow handshake could stall the client before the
    /// server had written anything, and the run would report a stall that stranded
    /// nothing.
    pub stall_after_ms: u64,
    /// Asks issued back-to-back before the stall. This is the "asks for a lot" half.
    ///
    /// Must be enough bytes to reach whichever ceiling is under test: at 64 KB frames,
    /// quinn's 10 MB default `send_window` needs ~160 frames to fill. Too few and both
    /// arms sit under both ceilings and the comparison is the null the stress sweep
    /// already reported.
    pub asks: u32,
    /// Hold the connection open, unread, for this long after stalling.
    pub hold_ms: u64,
}

/// One stalled-client run. Every field is either the measurement or a gate on it.
#[derive(Debug, Serialize)]
pub struct StallOutcome {
    pub arm: String,
    pub stream_mode: String,
    pub stall_after_ms: u64,
    pub hold_ms: u64,
    pub asks_requested: u32,
    pub asks_sent: u32,
    /// Bytes consumed before the stall. **Zero voids the row**: nothing was flowing, so
    /// nothing was stranded by refusing to read.
    pub bytes_read: u64,
    /// Whether the stall actually engaged. False means the run ended before the deadline.
    pub stall_engaged: bool,
    /// Uni streams the server opened. In `per-frame` this is the count of frames the
    /// server got onto the wire, which is itself the interesting quantity.
    pub uni_streams_opened: u32,
    /// **The gate.** False means the connection died — idle timeout, server close, reset —
    /// and the memory sampled after that point is post-teardown, not a stalled client.
    pub connection_alive_at_end: bool,
    pub close_reason: String,
    pub elapsed_ms: f64,
}

/// Ask for `cfg.asks` frames, read until `stall_after_ms` past the first byte, then stop
/// reading and hold the connection open — silent, undrained — for `hold_ms`.
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

    // Set on the first byte of the first stream; every reader then races the same
    // deadline, so "stop reading" is one instant for the whole connection rather than one
    // per stream.
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

    // Fire every ask up front. This is the client's whole contribution: it commits the
    // server to a large amount of work and then goes silent. Asks are ~10 bytes, so they
    // fit in the control stream's window regardless of what happens to the media path.
    let n = cfg.frame_count.max(1);
    let mut asks_sent = 0u32;
    for i in 0..stall.asks {
        match crate::wire::write_fod_msg(
            &mut control_send,
            &FodMsg::RequestFrame { frame: i % n },
        )
        .await
        {
            Ok(()) => asks_sent += 1,
            // The control stream blocking or resetting is itself informative: it means the
            // server stopped reading asks because it is blocked writing frames.
            Err(_) => break,
        }
    }

    // Wait out the stall deadline, then hold. Deliberately no `EndSession` and no
    // `close()` — see the module docs.
    let hold_until = Instant::now()
        + Duration::from_millis(stall.stall_after_ms.saturating_add(stall.hold_ms));
    while Instant::now() < hold_until {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Is the peer still there? `closed()` resolves only once the connection is gone, so a
    // timeout that expires is the healthy case.
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

    // Only now, after the outcome is captured, is it safe to let the connection go.
    connection.close(0u32.into(), b"stall done");
    Ok(outcome)
}

/// Accept uni streams and read them until the stall deadline, then park them.
///
/// Streams are moved into `_held` rather than dropped: a dropped `RecvStream` sends
/// `STOP_SENDING` and lets the server discard its buffer, which would erase the very thing
/// being measured.
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
        // One stream for the session: read it here until the deadline, then hold it.
        StreamMode::Shared => {
            if let Ok(recv) = connection.accept_uni().await {
                streams_opened.fetch_add(1, Ordering::Relaxed);
                let mut recv = recv;
                read_until_stall(
                    &mut recv,
                    stall_after_ms,
                    &deadline,
                    &stalled,
                    &bytes_read,
                )
                .await;
                held.push(recv);
            }
        }
        // A stream per frame. Each is read until the deadline and then parked, so the
        // server sees a peer that opened many streams and drained none of them.
        StreamMode::PerFrame => loop {
            match connection.accept_uni().await {
                Ok(mut recv) => {
                    streams_opened.fetch_add(1, Ordering::Relaxed);
                    read_until_stall(
                        &mut recv,
                        stall_after_ms,
                        &deadline,
                        &stalled,
                        &bytes_read,
                    )
                    .await;
                    held.push(recv);
                }
                Err(_) => break,
            }
        },
    }

    // Park forever. The task is aborted from the caller once the hold has elapsed, which
    // keeps `held` — and therefore every unread stream — alive for the whole measurement.
    loop {
        tokio::time::sleep(Duration::from_secs(3600)).await;
    }
}

/// Read one stream until the shared stall deadline, counting bytes. Returns as soon as the
/// deadline passes; the caller must keep the stream alive afterwards.
async fn read_until_stall(
    recv: &mut wtransport::stream::RecvStream,
    stall_after_ms: u64,
    deadline: &Arc<Mutex<Option<Instant>>>,
    stalled: &Arc<AtomicBool>,
    bytes_read: &Arc<AtomicU64>,
) {
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        // Already past the deadline (possibly armed by another stream): stop without
        // issuing another read.
        let until = *deadline.lock().expect("stall deadline");
        if let Some(t) = until {
            if Instant::now() >= t {
                stalled.store(true, Ordering::Relaxed);
                return;
            }
        }
        // Before the first byte anywhere there is no deadline yet, so wake periodically
        // rather than blocking indefinitely on a stream that may never carry data.
        let slice = match until {
            Some(t) => t.saturating_duration_since(Instant::now()),
            None => Duration::from_millis(200),
        };
        match tokio::time::timeout(slice.max(Duration::from_millis(1)), recv.read(&mut buf)).await {
            // Timed out mid-read. Whatever quinn had already buffered stays buffered and
            // unread, which is exactly the state under test.
            Err(_) => continue,
            Ok(Ok(Some(n))) if n > 0 => {
                bytes_read.fetch_add(n as u64, Ordering::Relaxed);
                let mut d = deadline.lock().expect("stall deadline");
                if d.is_none() {
                    *d = Some(Instant::now() + Duration::from_millis(stall_after_ms));
                }
            }
            // Stream finished or failed. Nothing more to read here; the caller parks it
            // anyway so its state is not torn down early.
            Ok(Ok(_)) | Ok(Err(_)) => return,
        }
    }
}
