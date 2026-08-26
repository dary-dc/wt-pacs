//! Lab-only session: generation ordering + optional in-flight stream cap.
//! Product exact-server stays FIFO — see docs/window-depth-and-priority-experiment.md.

use anyhow::{Context, Result};
use exact_server::media::frame_store::FrameStore;
use exact_server::transport::wire::write_fod_msg;
use fod::FodMsg;
use frame_envelope::wrap;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, Semaphore};
use tracing::{debug, warn};
use wtransport::stream::SendStream;
use wtransport::Connection;

const INBOX_CAP: usize = 512;
const DEQUE_CAP: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueOrder {
    Fifo,
    Generation,
}

#[derive(Debug, Clone, Copy)]
pub struct QueuePolicy {
    pub order: QueueOrder,
    /// 0 = uncapped concurrent uni sends; N = at most N in flight.
    pub stream_cap: usize,
}

impl QueuePolicy {
    pub fn arm_label(&self) -> char {
        match (self.order, self.stream_cap) {
            (QueueOrder::Fifo, 0) => 'A',
            (QueueOrder::Generation, 0) => 'B',
            (QueueOrder::Generation, 1) => 'C',
            (QueueOrder::Fifo, 1) => 'D',
            _ => '?',
        }
    }
}

#[derive(Debug)]
enum InboxMsg {
    Ask { frame: u32, generation: u32 },
    AskMany { frames: Vec<u32>, generation: u32 },
    Cancel,
    EndSession,
}

struct QueuedFrame {
    index: u32,
    generation: u32,
    arrival_seq: u64,
    enqueued_at: Instant,
}

pub async fn run_session(
    connection: Connection,
    mut control_send: SendStream,
    mut control_recv: wtransport::stream::RecvStream,
    store: Arc<FrameStore>,
    policy: QueuePolicy,
) -> Result<()> {
    let (tx, mut rx) = mpsc::channel::<InboxMsg>(INBOX_CAP);

    let reader = tokio::spawn(async move {
        loop {
            let msg = match exact_server::transport::wire::read_fod_msg(&mut control_recv).await {
                Ok(m) => m,
                Err(err) => {
                    warn!(%err, "control read ended");
                    break;
                }
            };

            let (inbox, is_end) = match msg {
                FodMsg::RequestFrame { frame, generation } => {
                    (InboxMsg::Ask { frame, generation }, false)
                }
                FodMsg::RequestFrames { frames, generation } => {
                    (InboxMsg::AskMany { frames, generation }, false)
                }
                FodMsg::CancelFrames { .. } => (InboxMsg::Cancel, false),
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
    let mut arrival_seq: u64 = 0;
    let send_slots = if policy.stream_cap == 0 {
        Arc::new(Semaphore::new(10_000))
    } else {
        Arc::new(Semaphore::new(policy.stream_cap))
    };
    let mut in_flight: tokio::task::JoinSet<Result<()>> = tokio::task::JoinSet::new();

    loop {
        while let Some(joined) = in_flight.try_join_next() {
            if let Ok(Err(err)) = joined {
                warn!(%err, "in-flight send failed");
            }
        }

        drain_inbox(
            &mut rx,
            &mut deque,
            policy.order,
            &mut arrival_seq,
            &mut stop_after_current,
        );

        if stop_after_current && deque.is_empty() && in_flight.is_empty() {
            break;
        }

        let permit = match send_slots.clone().try_acquire_owned() {
            Ok(p) => Some(p),
            Err(_) => None,
        };

        if let Some(permit) = permit {
            if let Some(next) = pop_next(&mut deque, policy.order) {
                let queue_us = next.enqueued_at.elapsed().as_micros() as u64;
                let connection = connection.clone();
                let store = Arc::clone(&store);
                let frame = next.index;
                let generation = next.generation;

                let bytes = match store.frame_slice(frame) {
                    Ok(b) => b.to_vec(),
                    Err(err) => {
                        drop(permit);
                        warn!(frame, %err, "frame refused");
                        write_fod_msg(
                            &mut control_send,
                            &FodMsg::FrameError {
                                frame_index: frame,
                                reason: err.to_string(),
                            },
                        )
                        .await?;
                        continue;
                    }
                };

                in_flight.spawn(async move {
                    let _permit = permit;
                    let timings = send_uni_payload(&connection, frame, &bytes, queue_us).await?;
                    debug!(
                        frame,
                        generation,
                        queue_us = timings.queue_us,
                        work_us = timings.work_us,
                        write_us = timings.write_us,
                        "frame sent"
                    );
                    Ok(())
                });
                continue;
            }
            drop(permit);
        }

        if stop_after_current && deque.is_empty() {
            while let Some(joined) = in_flight.join_next().await {
                if let Ok(Err(err)) = joined {
                    warn!(%err, "in-flight send failed");
                }
            }
            break;
        }

        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(msg) => apply_one(
                        msg,
                        &mut deque,
                        policy.order,
                        &mut arrival_seq,
                        &mut stop_after_current,
                    ),
                    None => {
                        while let Some(joined) = in_flight.join_next().await {
                            let _ = joined;
                        }
                        break;
                    }
                }
            }
            _ = async {
                if !in_flight.is_empty() {
                    if let Some(joined) = in_flight.join_next().await {
                        if let Ok(Err(err)) = joined {
                            warn!(%err, "in-flight send failed");
                        }
                    }
                } else {
                    std::future::pending::<()>().await;
                }
            } => {}
        }
    }

    let _ = reader.await;
    Ok(())
}

fn drain_inbox(
    rx: &mut mpsc::Receiver<InboxMsg>,
    deque: &mut VecDeque<QueuedFrame>,
    order: QueueOrder,
    arrival_seq: &mut u64,
    stop_after_current: &mut bool,
) {
    while let Ok(msg) = rx.try_recv() {
        apply_one(msg, deque, order, arrival_seq, stop_after_current);
    }
}

fn apply_one(
    msg: InboxMsg,
    deque: &mut VecDeque<QueuedFrame>,
    order: QueueOrder,
    arrival_seq: &mut u64,
    stop_after_current: &mut bool,
) {
    match msg {
        InboxMsg::Ask { frame, generation } => {
            enqueue(deque, order, arrival_seq, frame, generation);
        }
        InboxMsg::AskMany { frames, generation } => {
            for frame in frames {
                enqueue(deque, order, arrival_seq, frame, generation);
            }
        }
        InboxMsg::Cancel => {}
        InboxMsg::EndSession => *stop_after_current = true,
    }
}

fn enqueue(
    deque: &mut VecDeque<QueuedFrame>,
    order: QueueOrder,
    arrival_seq: &mut u64,
    index: u32,
    generation: u32,
) {
    if let Some(pos) = deque.iter().position(|q| q.index == index) {
        if deque[pos].generation <= generation {
            *arrival_seq += 1;
            deque[pos].generation = generation;
            deque[pos].arrival_seq = *arrival_seq;
            deque[pos].enqueued_at = Instant::now();
        }
        return;
    }

    if deque.len() >= DEQUE_CAP {
        if order == QueueOrder::Generation {
            let victim = deque
                .iter()
                .enumerate()
                .min_by_key(|(_, q)| (q.generation, q.arrival_seq))
                .map(|(i, _)| i);
            if let Some(i) = victim {
                if generation < deque[i].generation {
                    return;
                }
                deque.remove(i);
            }
        } else {
            deque.pop_front();
        }
    }

    *arrival_seq += 1;
    deque.push_back(QueuedFrame {
        index,
        generation,
        arrival_seq: *arrival_seq,
        enqueued_at: Instant::now(),
    });
}

fn pop_next(deque: &mut VecDeque<QueuedFrame>, order: QueueOrder) -> Option<QueuedFrame> {
    match order {
        QueueOrder::Fifo => deque.pop_front(),
        QueueOrder::Generation => {
            let best = deque
                .iter()
                .enumerate()
                .max_by_key(|(_, q)| (q.generation, std::cmp::Reverse(q.arrival_seq)))
                .map(|(i, _)| i)?;
            deque.remove(best)
        }
    }
}

struct FrameTimings {
    queue_us: u64,
    work_us: u64,
    write_us: u64,
}

async fn send_uni_payload(
    connection: &Connection,
    idx: u32,
    bytes: &[u8],
    queue_us: u64,
) -> Result<FrameTimings> {
    let work_start = Instant::now();
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
