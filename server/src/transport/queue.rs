//! Two-task ask queue: reader never cancels; sender owns a private deque.

use crate::media::frame_store::FrameStore;
use crate::transport::wire::write_fod_msg;
use anyhow::{Context, Result};
use fod::FodMsg;
use frame_envelope::wrap;
use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc;
use tracing::{debug, warn};
use wtransport::stream::SendStream;
use wtransport::Connection;

/// Bounded channel depth — robustness cap, not a performance knob.
const INBOX_CAP: usize = 512;

#[derive(Debug)]
enum InboxMsg {
    Ask(u32),
    AskMany(Vec<u32>),
    Cancel(Vec<u32>),
    EndSession,
}

struct QueuedFrame {
    index: u32,
    enqueued_at: Instant,
}

pub fn cancel_enabled_from_env() -> bool {
    match std::env::var("WTPACS_QUEUE_CANCEL") {
        Ok(v) => v == "1" || v.eq_ignore_ascii_case("true"),
        Err(_) => false,
    }
}

pub async fn run_session(
    connection: Connection,
    mut control_send: SendStream,
    mut control_recv: wtransport::stream::RecvStream,
    store: Arc<FrameStore>,
    cancel_enabled: bool,
) -> Result<()> {
    let (tx, mut rx) = mpsc::channel::<InboxMsg>(INBOX_CAP);

    let reader = tokio::spawn(async move {
        loop {
            let msg = match super::wire::read_fod_msg(&mut control_recv).await {
                Ok(m) => m,
                Err(err) => {
                    warn!(%err, "control read ended");
                    break;
                }
            };

            let (inbox, is_end) = match msg {
                FodMsg::RequestFrame { frame } => (InboxMsg::Ask(frame), false),
                FodMsg::RequestFrames { frames } => (InboxMsg::AskMany(frames), false),
                FodMsg::CancelFrames { frames } => (InboxMsg::Cancel(frames), false),
                FodMsg::EndSession => (InboxMsg::EndSession, true),
                other => {
                    warn!(?other, "ask-only: ignoring unexpected FoD message");
                    continue;
                }
            };

            if tx.send(inbox).await.is_err() {
                break;
            }

            if is_end {
                break;
            }
        }
    });

    let mut deque: VecDeque<QueuedFrame> = VecDeque::new();
    let mut stop_after_current = false;

    loop {
        drain_inbox(&mut rx, &mut deque, cancel_enabled, &mut stop_after_current);

        if stop_after_current && deque.is_empty() {
            break;
        }

        if let Some(next) = deque.pop_front() {
            let queue_us = next.enqueued_at.elapsed().as_micros() as u64;
            let timings = send_one_frame(
                &connection,
                &mut control_send,
                &store,
                next.index,
                queue_us,
            )
            .await?;

            debug!(
                frame = next.index,
                queue_us = timings.queue_us,
                work_us = timings.work_us,
                write_us = timings.write_us,
                "frame sent"
            );

            if stop_after_current {
                break;
            }
            continue;
        }

        if stop_after_current {
            break;
        }

        match rx.recv().await {
            Some(msg) => apply_one(msg, &mut deque, cancel_enabled, &mut stop_after_current),
            None => break,
        }
    }

    let _ = reader.await;
    Ok(())
}

fn drain_inbox(
    rx: &mut mpsc::Receiver<InboxMsg>,
    deque: &mut VecDeque<QueuedFrame>,
    cancel_enabled: bool,
    stop_after_current: &mut bool,
) {
    while let Ok(msg) = rx.try_recv() {
        apply_one(msg, deque, cancel_enabled, stop_after_current);
    }
}

fn apply_one(
    msg: InboxMsg,
    deque: &mut VecDeque<QueuedFrame>,
    cancel_enabled: bool,
    stop_after_current: &mut bool,
) {
    match msg {
        InboxMsg::Ask(frame) => deque.push_back(QueuedFrame {
            index: frame,
            enqueued_at: Instant::now(),
        }),
        InboxMsg::AskMany(frames) => {
            let now = Instant::now();
            for frame in frames {
                deque.push_back(QueuedFrame {
                    index: frame,
                    enqueued_at: now,
                });
            }
        }
        InboxMsg::Cancel(frames) if cancel_enabled => {
            let drop: HashSet<u32> = frames.into_iter().collect();
            deque.retain(|q| !drop.contains(&q.index));
        }
        InboxMsg::Cancel(_) => {}
        InboxMsg::EndSession => *stop_after_current = true,
    }
}

struct FrameTimings {
    queue_us: u64,
    work_us: u64,
    write_us: u64,
}

async fn send_one_frame(
    connection: &Connection,
    control_send: &mut SendStream,
    store: &FrameStore,
    idx: u32,
    queue_us: u64,
) -> Result<FrameTimings> {
    let work_start = Instant::now();
    let bytes = match store.frame_slice(idx) {
        Ok(bytes) => bytes,
        Err(err) => {
            warn!(frame = idx, %err, "frame refused");
            write_fod_msg(
                control_send,
                &FodMsg::FrameError {
                    frame_index: idx,
                    reason: err.to_string(),
                },
            )
            .await?;
            return Ok(FrameTimings {
                queue_us,
                work_us: work_start.elapsed().as_micros() as u64,
                write_us: 0,
            });
        }
    };
    let payload = wrap(idx, bytes);
    let work_us = work_start.elapsed().as_micros() as u64;

    let write_start = Instant::now();
    let mut uni = connection
        .open_uni()
        .await
        .context("open uni")?
        .await
        .context("open uni ready")?;
    uni.write_all(&payload).await.context("write envelope")?;
    uni.finish().await.context("finish uni")?;
    let write_us = write_start.elapsed().as_micros() as u64;

    Ok(FrameTimings {
        queue_us,
        work_us,
        write_us,
    })
}
