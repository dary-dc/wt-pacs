use super::*;

/// Clients parse the bytes, not this code, so the head is pinned byte for byte: the length
/// counts the index and the whole codestream, then the index, both big-endian.
#[test]
fn the_head_is_the_envelope_length_then_the_index_big_endian() {
    assert_eq!(frame_head(7, 5000), [0, 0, 0x13, 0x8c, 0, 0, 0, 7]);
    assert_eq!(frame_head(1, 3 * 65_536 + 17), [0, 3, 0, 0x15, 0, 0, 0, 1]);
}

/// A prefix is read only between the index alone and 64 MiB, both bounds inclusive.
#[test]
fn an_envelope_length_is_read_only_within_its_bounds() {
    let prefix = |len: usize| (len as u32).to_be_bytes();
    assert_eq!(envelope_len(prefix(INDEX_LEN)), Ok(INDEX_LEN));
    assert_eq!(envelope_len(prefix(MAX_FRAME_LEN)), Ok(MAX_FRAME_LEN));
    assert!(envelope_len(prefix(INDEX_LEN - 1)).is_err(), "an envelope shorter than its index");
    assert!(envelope_len(prefix(MAX_FRAME_LEN + 1)).is_err(), "an envelope over 64 MiB");
}

/// What a client reads after the length prefix unwraps to the index and the codestream.
#[test]
fn a_streamed_frame_unwraps_to_its_index_and_codestream() {
    let codestream = b"htj2k-bytes";
    let mut wire = frame_head(42, codestream.len() as u32).to_vec();
    wire.extend_from_slice(codestream);
    let len = u32::from_be_bytes(wire[..4].try_into().unwrap()) as usize;
    assert_eq!(len, wire.len() - 4);
    assert_eq!(unwrap(&wire[4..]).unwrap(), (42, &codestream[..]));
}
