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
