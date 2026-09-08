//! Length-prefixed FoD read/write on WebTransport streams.

use anyhow::{Context, Result};
use fod::{decode_fod_msg, encode_fod_msg, FodMsg};
use wtransport::stream::{RecvStream, SendStream};

/// Largest FoD message the server will read. Asks are small; a `RequestFrames` of 700 k
/// indices fits. Anything larger is a broken or hostile peer, not a study.
pub const MAX_FOD_LEN: usize = 4 * 1024 * 1024;

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

pub async fn read_fod_msg(recv: &mut RecvStream) -> Result<FodMsg> {
    let mut len_buf = [0u8; 4];
    read_exact(recv, &mut len_buf).await?;
    let len = u32::from_le_bytes(len_buf) as usize;
    check_fod_len(len)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fod_len_zero_and_huge_are_refused_before_allocation() {
        assert!(check_fod_len(0).is_err());
        assert!(check_fod_len(1).is_ok());
        assert!(check_fod_len(MAX_FOD_LEN).is_ok());
        assert!(check_fod_len(MAX_FOD_LEN + 1).is_err());
        assert!(check_fod_len(u32::MAX as usize).is_err(), "a 4 GB length prefix is refused");
    }
}
