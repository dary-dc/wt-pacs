//! Length-prefixed FoD read/write on WebTransport streams.

use anyhow::{Context, Result};
use fod::{decode_fod_body, encode_fod_msg, FodMsg};
use wtransport::stream::{RecvStream, SendStream};

/// Largest FoD message the server will read; a client's longest is 56 B. `docs/WIRE.md` §FoD messages
pub const MAX_FOD_LEN: usize = 64 * 1024;

/// The wire-supplied length is checked before a single byte is allocated for it.
pub fn check_fod_len(len: usize) -> Result<()> {
    if len == 0 {
        anyhow::bail!("FoD message length 0");
    }
    if len > MAX_FOD_LEN {
        anyhow::bail!("FoD message length {len} exceeds {MAX_FOD_LEN}");
    }
    Ok(())
}

/// `None` once the peer has finished the stream between messages.
pub async fn read_fod_msg(recv: &mut RecvStream) -> Result<Option<FodMsg>> {
    let mut len_buf = [0u8; 4];
    if !read_exact(recv, &mut len_buf).await? {
        return Ok(None);
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    check_fod_len(len)?;
    let mut body = vec![0u8; len];
    if !read_exact(recv, &mut body).await? {
        anyhow::bail!("stream ended before {len} bytes");
    }
    decode_fod_body(&body).map(Some)
}

pub async fn write_fod_msg(send: &mut SendStream, msg: &FodMsg) -> Result<()> {
    let bytes = encode_fod_msg(msg)?;
    send.write_all(&bytes).await.context("write FoD")?;
    Ok(())
}

/// False when the stream ended before the first byte; an end part-way is an error.
async fn read_exact(recv: &mut RecvStream, out: &mut [u8]) -> Result<bool> {
    let mut filled = 0;
    while filled < out.len() {
        match recv.read(&mut out[filled..]).await? {
            Some(n) => filled += n,
            None if filled == 0 => return Ok(false),
            None => anyhow::bail!("stream ended before {} bytes", out.len()),
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests;
