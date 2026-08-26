//! FoD length-prefixed write + paced uni reads on wtransport streams.

use anyhow::{Context, Result};
use fod::{encode_fod_msg, FodMsg};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use wtransport::stream::{RecvStream, SendStream};

/// Maximum envelope payload (64 MiB), matching the server guard.
pub const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

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

    pub(crate) async fn consume_bytes(pacer: &Arc<Mutex<Self>>, nbytes: usize) {
        if nbytes == 0 {
            return;
        }
        let delay = {
            let mut p = pacer.lock().await;
            if p.read_bps == 0 {
                Duration::ZERO
            } else {
                let need = Duration::from_micros(
                    (nbytes as u64)
                        .saturating_mul(8)
                        .saturating_mul(1_000_000)
                        / p.read_bps,
                );
                let now = Instant::now();
                let start = p.next_at.max(now);
                p.next_at = start + need;
                start.saturating_duration_since(now)
            }
        };
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }
}

/// Read exactly `buf.len()` bytes, pacing against the shared link budget as they arrive.
pub async fn read_exact_paced(
    recv: &mut RecvStream,
    buf: &mut [u8],
    pacer: &Arc<Mutex<LinkPacer>>,
) -> Result<()> {
    let mut filled = 0usize;
    while filled < buf.len() {
        let n = recv
            .read(&mut buf[filled..])
            .await
            .context("read uni")?
            .unwrap_or(0);
        if n == 0 {
            anyhow::bail!("stream ended early");
        }
        filled += n;
        LinkPacer::consume_bytes(pacer, n).await;
    }
    Ok(())
}

/// Read one length-prefixed envelope: `[4B BE len][payload]`.
pub async fn read_framed_paced(
    recv: &mut RecvStream,
    pacer: &Arc<Mutex<LinkPacer>>,
) -> Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    read_exact_paced(recv, &mut len_buf, pacer).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len == 0 || len > MAX_FRAME_LEN {
        anyhow::bail!("invalid frame length {len}");
    }
    let mut payload = vec![0u8; len];
    read_exact_paced(recv, &mut payload, pacer).await?;
    Ok(payload)
}

/// Returns `(payload, consumed_bytes)` when a full frame is present.
pub fn parse_length_prefixed(buf: &[u8]) -> Option<(&[u8], usize)> {
    if buf.len() < 4 {
        return None;
    }
    let len = u32::from_be_bytes(buf[..4].try_into().ok()?) as usize;
    if len == 0 || len > MAX_FRAME_LEN {
        return None;
    }
    let total = 4 + len;
    if buf.len() < total {
        return None;
    }
    Some((&buf[4..total], total))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_length_prefixed_round_trip() {
        let payload = b"hello";
        let mut framed = Vec::new();
        framed.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        framed.extend_from_slice(payload);
        let (got, n) = parse_length_prefixed(&framed).unwrap();
        assert_eq!(got, payload);
        assert_eq!(n, framed.len());
    }
}
