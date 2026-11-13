//! Exact-tier wire framing, one frame: `[4B BE envelope_len][4B BE display_index][codestream…]`,
//! where `envelope_len` counts the index and the codestream. Series bundles store raw codestream;
//! the server streams [`frame_head`] before it, and a client unwraps what follows the length.

pub const INDEX_LEN: usize = 4;
pub const FRAME_HEAD_LEN: usize = 4 + INDEX_LEN;
/// The largest `envelope_len` a client reads. docs/WIRE.md §The envelope.
pub const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;
pub const MAX_CODESTREAM_LEN: usize = MAX_FRAME_LEN - INDEX_LEN;

/// The `envelope_len` a stream's 4-byte prefix declares, refused outside what a client reads.
pub fn envelope_len(prefix: [u8; 4]) -> Result<usize, String> {
    let len = u32::from_be_bytes(prefix) as usize;
    if len < INDEX_LEN || len > MAX_FRAME_LEN {
        return Err(format!("invalid frame length {len}"));
    }
    Ok(len)
}

/// The bytes that precede a codestream of `codestream_len` bytes on the wire.
pub fn frame_head(display_index: u32, codestream_len: u32) -> [u8; FRAME_HEAD_LEN] {
    let envelope_len = (INDEX_LEN as u32).saturating_add(codestream_len);
    let mut head = [0u8; FRAME_HEAD_LEN];
    head[..4].copy_from_slice(&envelope_len.to_be_bytes());
    head[4..].copy_from_slice(&display_index.to_be_bytes());
    head
}

pub fn unwrap(payload: &[u8]) -> Result<(u32, &[u8]), String> {
    if payload.len() < INDEX_LEN {
        return Err(format!(
            "frame envelope too short ({} bytes, need {})",
            payload.len(),
            INDEX_LEN
        ));
    }
    let index = u32::from_be_bytes(
        payload[0..INDEX_LEN]
            .try_into()
            .map_err(|_| "frame envelope header")?,
    );
    Ok((index, &payload[INDEX_LEN..]))
}

#[cfg(test)]
mod tests;
