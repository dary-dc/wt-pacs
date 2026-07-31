//! Exact-tier wire payload: `[4B BE display_index][codestream…]`.
//! Study bundles store raw codestream; server wraps at send, client unwraps after recv.

pub const ENVELOPE_LEN: usize = 4;

pub fn wrap(display_index: u32, codestream: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(ENVELOPE_LEN + codestream.len());
    out.extend_from_slice(&display_index.to_be_bytes());
    out.extend_from_slice(codestream);
    out
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
