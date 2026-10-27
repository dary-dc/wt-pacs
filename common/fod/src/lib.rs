//! FoD control messages on the WebTransport **bidirectional control stream**.
//!
//! Wire: LE u32 length + JSON body.
//! Media-complete: frame completion is one envelope payload on a server uni stream.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum FodMsg {
    /// Interactive / real-time path — one frame per message (depth = outstanding asks).
    RequestFrame {
        frame: u32,
    },
    /// `{}` is the whole series; an omitted `from` is the first frame, an omitted `to` the last.
    StreamFrames {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<u32>,
    },
    EndStream,
    EndSession,
    FrameError {
        frame_index: u32,
        #[serde(default)]
        reason: String,
    },
}

/// Largest FoD message either side will read; a client's longest is 56 B. `docs/WIRE.md` §FoD messages
pub const MAX_FOD_LEN: usize = 64 * 1024;

/// The wire-supplied length is checked before a single byte is allocated for it.
pub fn check_fod_len(len: usize) -> Result<()> {
    if len == 0 {
        bail!("FoD message length 0");
    }
    if len > MAX_FOD_LEN {
        bail!("FoD message length {len} exceeds {MAX_FOD_LEN}");
    }
    Ok(())
}

pub fn encode_fod_msg(msg: &FodMsg) -> Result<Vec<u8>> {
    let body = serde_json::to_vec(msg).context("serialize FodMsg")?;
    let mut out = Vec::with_capacity(4 + body.len());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    Ok(out)
}

/// Decode a framed message: `[4B LE len][JSON body]`.
pub fn decode_fod_msg(bytes: &[u8]) -> Result<FodMsg> {
    if bytes.len() < 4 {
        bail!("FodMsg too short");
    }
    let len = u32::from_le_bytes(bytes[0..4].try_into()?) as usize;
    let body = bytes.get(4..4 + len).context("FodMsg truncated")?;
    decode_fod_body(body)
}

/// Decode the JSON body alone — for a reader that has already consumed the length prefix.
pub fn decode_fod_body(body: &[u8]) -> Result<FodMsg> {
    serde_json::from_slice(body).context("deserialize FodMsg")
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

    #[test]
    fn roundtrip_request_frame() {
        let msg = FodMsg::RequestFrame { frame: 7 };
        let enc = encode_fod_msg(&msg).unwrap();
        assert_eq!(decode_fod_msg(&enc).unwrap(), msg);
    }

    #[test]
    fn roundtrip_frame_error() {
        let msg = FodMsg::FrameError {
            frame_index: 9,
            reason: "out of range".into(),
        };
        let enc = encode_fod_msg(&msg).unwrap();
        assert_eq!(decode_fod_msg(&enc).unwrap(), msg);
    }

    #[test]
    fn stream_frames_empty_is_the_whole_series() {
        let msg = FodMsg::StreamFrames {
            from: None,
            to: None,
        };
        let enc = encode_fod_msg(&msg).unwrap();
        let body = &enc[4..];
        assert_eq!(body, br#"{"op":"stream_frames"}"#);
        assert_eq!(decode_fod_msg(&enc).unwrap(), msg);
    }

    #[test]
    fn stream_frames_range_and_end_stream_roundtrip() {
        let msg = FodMsg::StreamFrames {
            from: Some(2),
            to: Some(9),
        };
        let enc = encode_fod_msg(&msg).unwrap();
        assert_eq!(decode_fod_msg(&enc).unwrap(), msg);
        let stop = encode_fod_msg(&FodMsg::EndStream).unwrap();
        assert_eq!(decode_fod_msg(&stop).unwrap(), FodMsg::EndStream);
    }

    /// The length-prefixed decoder and the body decoder agree on every variant.
    #[test]
    fn decode_fod_body_agrees_with_decode_fod_msg_on_every_variant() {
        let msgs = [
            FodMsg::RequestFrame { frame: 7 },
            FodMsg::StreamFrames {
                from: None,
                to: None,
            },
            FodMsg::StreamFrames {
                from: Some(2),
                to: Some(9),
            },
            FodMsg::EndStream,
            FodMsg::EndSession,
            FodMsg::FrameError {
                frame_index: 9,
                reason: "out of range".into(),
            },
        ];
        for msg in msgs {
            let enc = encode_fod_msg(&msg).unwrap();
            let n = u32::from_le_bytes(enc[0..4].try_into().unwrap()) as usize;
            let via_full = decode_fod_msg(&enc).unwrap();
            let via_body = decode_fod_body(&enc[4..4 + n]).unwrap();
            assert_eq!(via_full, via_body, "{msg:?}");
            assert_eq!(via_body, msg);
        }
    }
}
