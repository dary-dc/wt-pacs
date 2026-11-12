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
