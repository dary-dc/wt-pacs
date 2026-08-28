//! Length-prefixed FoD read/write on WebTransport streams.

use anyhow::{Context, Result};
use fod::{decode_fod_msg, encode_fod_msg, FodMsg};
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
    decode_fod_msg(&full)
}

pub async fn write_fod_msg(send: &mut SendStream, msg: &FodMsg) -> Result<()> {
    let bytes = encode_fod_msg(msg)?;
    send.write_all(&bytes).await.context("write FoD")?;
    Ok(())
}

pub async fn read_envelope(recv: &mut RecvStream) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut buf = vec![0u8; 65536];
    loop {
        match recv.read(&mut buf).await? {
            Some(n) => out.extend_from_slice(&buf[..n]),
            None => break,
        }
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

/// Maximum envelope payload (64 MiB), matching the harness guard.
pub const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

/// `[4B BE len][payload]` — the media envelope framing, identical in both stream modes.
pub fn length_prefixed(payload: &[u8]) -> Vec<u8> {
    let len = payload.len().min(u32::MAX as usize) as u32;
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(payload);
    out
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
    fn length_prefixed_round_trip() {
        let payload = b"hello envelope";
        let framed = length_prefixed(payload);
        let (got, n) = parse_length_prefixed(&framed).unwrap();
        assert_eq!(got, payload);
        assert_eq!(n, framed.len());
    }

    #[test]
    fn length_prefixed_zero_rejected() {
        assert!(parse_length_prefixed(&0u32.to_be_bytes()).is_none());
    }

    #[test]
    fn length_prefixed_truncated_prefix() {
        assert!(parse_length_prefixed(&[0, 0, 0]).is_none());
    }

    #[test]
    fn length_prefixed_truncated_body() {
        let mut framed = length_prefixed(b"x");
        framed.pop();
        assert!(parse_length_prefixed(&framed).is_none());
    }

    #[test]
    fn length_prefixed_over_max_rejected() {
        let len = (MAX_FRAME_LEN as u32 + 1).to_be_bytes();
        assert!(parse_length_prefixed(&len).is_none());
    }
}
