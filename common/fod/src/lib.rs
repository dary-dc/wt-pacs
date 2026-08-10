//! FoD control messages on the WebTransport **bidirectional control stream**.
//!
//! Wire: LE u32 length + JSON body.
//! Media-complete: frame completion is one envelope payload on a server uni stream.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum FodMsg {
    RequestFrame { frame: u32 },
    RequestFrames { frames: Vec<u32> },
    RequestPath { from: u32, to: u32, stride: u32 },
    EndSession,
    FrameError {
        frame_index: u32,
        #[serde(default)]
        reason: String,
    },
}

pub fn encode_fod_msg(msg: &FodMsg) -> Result<Vec<u8>> {
    let body = serde_json::to_vec(msg).context("serialize FodMsg")?;
    let mut out = Vec::with_capacity(4 + body.len());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    Ok(out)
}

pub fn decode_fod_msg(bytes: &[u8]) -> Result<FodMsg> {
    if bytes.len() < 4 {
        bail!("FodMsg too short");
    }
    let len = u32::from_le_bytes(bytes[0..4].try_into()?) as usize;
    let body = bytes.get(4..4 + len).context("FodMsg truncated")?;
    serde_json::from_slice(body).context("deserialize FodMsg")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_request_frame() {
        let msg = FodMsg::RequestFrame { frame: 7 };
        let enc = encode_fod_msg(&msg).unwrap();
        assert_eq!(decode_fod_msg(&enc).unwrap(), msg);
    }

    #[test]
    fn roundtrip_frame_error() {
