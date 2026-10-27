//! Length-prefixed FoD read/write on WebTransport and raw QUIC streams.

use anyhow::{Context, Result};
use fod::{decode_fod_body, encode_fod_msg, FodMsg};
use wtransport::quinn;
use wtransport::stream::{RecvStream, SendStream};

/// The QUIC stream a WebTransport stream wraps, or the raw QUIC stream itself.
pub trait QuicStream<S> {
    fn quic(&mut self) -> &mut S;
}

impl QuicStream<quinn::RecvStream> for quinn::RecvStream {
    fn quic(&mut self) -> &mut quinn::RecvStream {
        self
    }
}

impl QuicStream<quinn::RecvStream> for RecvStream {
    fn quic(&mut self) -> &mut quinn::RecvStream {
        self.quic_stream_mut()
    }
}

impl QuicStream<quinn::SendStream> for SendStream {
    fn quic(&mut self) -> &mut quinn::SendStream {
        self.quic_stream_mut()
    }
}

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
pub async fn read_fod_msg(recv: &mut impl QuicStream<quinn::RecvStream>) -> Result<Option<FodMsg>> {
    let recv = recv.quic();
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

pub async fn write_fod_msg(send: &mut impl QuicStream<quinn::SendStream>, msg: &FodMsg) -> Result<()> {
    let bytes = encode_fod_msg(msg)?;
    send.quic().write_all(&bytes).await.context("write FoD")?;
    Ok(())
}

/// False when the stream ended before the first byte; an end part-way is an error.
async fn read_exact(recv: &mut quinn::RecvStream, out: &mut [u8]) -> Result<bool> {
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
mod tests {
    use super::*;

    #[test]
    fn fod_len_zero_and_huge_are_refused_before_allocation() {
        assert!(check_fod_len(0).is_err());
        assert!(check_fod_len(1).is_ok());
        assert!(check_fod_len(MAX_FOD_LEN).is_ok());
        assert!(check_fod_len(MAX_FOD_LEN + 1).is_err());
        assert!(
            check_fod_len(u32::MAX as usize).is_err(),
            "a 4 GB length prefix is refused"
        );
    }

    /// The longest message a client sends, a fill with both ends at `u32::MAX`, fits under the cap.
    #[test]
    fn the_longest_client_message_fits() {
        let longest = FodMsg::StreamFrames { from: Some(u32::MAX), to: Some(u32::MAX) };
        let bytes = encode_fod_msg(&longest).unwrap();
        check_fod_len(bytes.len() - 4).unwrap();
        assert_eq!(decode_fod_body(&bytes[4..]).unwrap(), longest);
    }
}
