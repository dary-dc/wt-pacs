//! FoD length-prefixed read/write on wtransport streams.

use anyhow::{Context, Result};
use fod::{decode_fod_msg, encode_fod_msg, FodMsg};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use wtransport::stream::{RecvStream, SendStream};

pub async fn read_fod_msg(recv: &mut RecvStream) -> Result<FodMsg> {
    let mut len_buf = [0u8; 4];
    read_exact(recv, &mut len_buf).await?;
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut body = vec![0u8; len];
    read_exact(recv, &mut body).await?;
    let mut full = Vec::with_capacity(4 + len);
    full.extend_from_slice(&len_buf);
    full.extend_from_slice(&body);
    decode_fod_msg(&full).context("decode FoD")
}

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

async fn read_exact(recv: &mut RecvStream, out: &mut [u8]) -> Result<()> {
    let mut filled = 0;
    while filled < out.len() {
        match recv.read(&mut out[filled..]).await? {
            Some(n) => filled += n,
            None => anyhow::bail!("stream ended before {} bytes", out.len()),
        }
    }
    Ok(())
}
