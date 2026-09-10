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
    /// Bulk / sequential testing path — server drains the whole batch before the next ask.
    RequestFrames {
        frames: Vec<u32>,
    },
    /// Current use is start-to-end (`{}`); `from` / `to` stay so a later range does not need a new type.
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
    /// Catalog: how many instances the study holds. Pushed once after accept.
    /// `docs/WIRE.md`.
    Study {
        frames: u32,
    },
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
    fn stream_frames_empty_is_the_whole_study() {
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

    /// The catalog is a small JSON object so a client can learn `frames` without HTTP.
    #[test]
    fn study_pins_the_wire_bytes() {
        let enc = encode_fod_msg(&FodMsg::Study { frames: 3 }).unwrap();
        assert_eq!(&enc[4..], br#"{"op":"study","frames":3}"#);
        assert_eq!(decode_fod_msg(&enc).unwrap(), FodMsg::Study { frames: 3 });
    }

    /// The length-prefixed decoder and the body decoder agree on every variant.
    #[test]
    fn decode_fod_body_agrees_with_decode_fod_msg_on_every_variant() {
        let msgs = [
            FodMsg::RequestFrame { frame: 7 },
            FodMsg::RequestFrames {
                frames: vec![1, 2, 3],
            },
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
            FodMsg::Study { frames: 3 },
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
