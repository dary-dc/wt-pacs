//! Exact-tier wire framing, one frame: `[4B BE envelope_len][4B BE display_index][codestream…]`,
//! where `envelope_len` counts the index and the codestream. Study bundles store raw codestream;
//! the server streams [`frame_head`] before it, and a client unwraps what follows the length.

pub const ENVELOPE_LEN: usize = 4;
pub const FRAME_HEAD_LEN: usize = 4 + ENVELOPE_LEN;
/// The largest `envelope_len` a client reads. docs/WIRE.md §The envelope.
pub const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;
pub const MAX_CODESTREAM_LEN: usize = MAX_FRAME_LEN - ENVELOPE_LEN;

/// The `envelope_len` a stream's 4-byte prefix declares, refused outside what a client reads.
pub fn envelope_len(prefix: [u8; 4]) -> Result<usize, String> {
    let len = u32::from_be_bytes(prefix) as usize;
    if len < ENVELOPE_LEN || len > MAX_FRAME_LEN {
        return Err(format!("invalid frame length {len}"));
    }
    Ok(len)
}

/// The bytes that precede a codestream of `codestream_len` bytes on the wire.
pub fn frame_head(display_index: u32, codestream_len: u32) -> [u8; FRAME_HEAD_LEN] {
    let envelope_len = (ENVELOPE_LEN as u32).saturating_add(codestream_len);
    let mut head = [0u8; FRAME_HEAD_LEN];
    head[..4].copy_from_slice(&envelope_len.to_be_bytes());
    head[4..].copy_from_slice(&display_index.to_be_bytes());
    head
}

pub fn unwrap(payload: &[u8]) -> Result<(u32, &[u8]), String> {
    if payload.len() < ENVELOPE_LEN {
        return Err(format!(
            "frame envelope too short ({} bytes, need {})",
            payload.len(),
            ENVELOPE_LEN
        ));
    }
    let index = u32::from_be_bytes(
        payload[0..ENVELOPE_LEN]
            .try_into()
            .map_err(|_| "frame envelope header")?,
    );
    Ok((index, &payload[ENVELOPE_LEN..]))
}

#[cfg(test)]
mod tests {
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
        assert_eq!(envelope_len(prefix(ENVELOPE_LEN)), Ok(ENVELOPE_LEN));
        assert_eq!(envelope_len(prefix(MAX_FRAME_LEN)), Ok(MAX_FRAME_LEN));
        assert!(envelope_len(prefix(ENVELOPE_LEN - 1)).is_err(), "an envelope shorter than its index");
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
}
