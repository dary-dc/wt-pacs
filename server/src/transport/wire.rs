//! Length-prefixed FoD read/write on WebTransport streams.

use anyhow::{Context, Result};
use fod::{decode_fod_msg, encode_fod_msg, FodMsg};
use wtransport::stream::{RecvStream, SendStream};

pub async fn read_fod_msg(recv: &mut RecvStream) -> Result<FodMsg> {
    let mut len_buf = [0u8; 4];
    read_exact(recv, &mut len_buf).await?;
    let len = u32::from_le_bytes(len_buf) as usize;
