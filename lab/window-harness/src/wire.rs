//! FoD length-prefixed write + paced uni reads on wtransport streams.

use anyhow::{Context, Result};
use fod::{encode_fod_msg, FodMsg};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use wtransport::stream::{RecvStream, SendStream};

pub async fn write_fod_msg(send: &mut SendStream, msg: &FodMsg) -> Result<()> {
    let bytes = encode_fod_msg(msg)?;
    send.write_all(&bytes).await.context("write FoD")?;
    Ok(())
}

/// Shared across uni streams so concurrent reads cannot exceed `read_bps` in aggregate.
/// Lock is held across the paced sleep so wall-clock rate matches the reservation.
#[derive(Debug)]
pub struct LinkPacer {
    read_bps: u64,
    next_at: Instant,
}

impl LinkPacer {
    pub fn new(read_bps: u64) -> Arc<Mutex<Self>> {
        Arc::new(Mutex::new(Self {
            read_bps,
            next_at: Instant::now(),
        }))
    }

    async fn consume_bytes(pacer: &Arc<Mutex<Self>>, nbytes: usize) {
        if nbytes == 0 {
            return;
        }
        let mut p = pacer.lock().await;
        if p.read_bps == 0 {
            return;
        }
        let need = Duration::from_micros(
            (nbytes as u64)
                .saturating_mul(8)
                .saturating_mul(1_000_000)
                / p.read_bps,
        );
        let now = Instant::now();
        let start = p.next_at.max(now);
        p.next_at = start + need;
        let delay = start.saturating_duration_since(now);
        if !delay.is_zero() {
            // Hold the mutex across sleep so concurrent streams cannot overlap wall time.
            tokio::time::sleep(delay).await;
        }
    }
}

pub async fn read_paced(recv: &mut RecvStream, pacer: &Arc<Mutex<LinkPacer>>) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = vec![0u8; 16 * 1024];
    loop {
        let n = match recv.read(&mut buf).await.context("read uni")? {
            Some(n) => n,
            None => break,
        };
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        LinkPacer::consume_bytes(pacer, n).await;
    }
    Ok(out)
}
