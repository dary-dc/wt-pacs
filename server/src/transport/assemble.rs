//! How the chunked send path builds the media envelope.
//!
//! Wire: `[4B BE total_len][4B BE display_index][codestream…]`
//! where `total_len = 4 + codestream.len()`.

use bytes::Bytes;
use frame_envelope::ENVELOPE_LEN;

/// `[4B BE total_len][4B BE display_index]` — first chunk of the chunked path.
pub fn envelope_header(idx: u32, codestream_len: usize) -> [u8; ENVELOPE_LEN * 2] {
    let wire_len = (ENVELOPE_LEN + codestream_len) as u32;
    let mut header = [0u8; ENVELOPE_LEN * 2];
    header[..ENVELOPE_LEN].copy_from_slice(&wire_len.to_be_bytes());
    header[ENVELOPE_LEN..].copy_from_slice(&idx.to_be_bytes());
    header
}

/// Chunked path: header as one `Bytes`, codestream as the other. No full-frame copy.
pub fn chunked_chunks(idx: u32, body: Bytes) -> [Bytes; 2] {
    [
        Bytes::copy_from_slice(&envelope_header(idx, body.len())),
        body,
    ]
}

pub fn assemble_chunked(idx: u32, body: &[u8]) -> Vec<u8> {
    let chunks = chunked_chunks(idx, Bytes::copy_from_slice(body));
    let mut out = Vec::with_capacity(chunks[0].len() + chunks[1].len());
    out.extend_from_slice(&chunks[0]);
    out.extend_from_slice(&chunks[1]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The write path calls `chunked_chunks`. This is the envelope those two
    /// buffers must concatenate to.
    #[test]
    fn chunked_writes_the_envelope() {
        for (idx, body) in [
            (0u32, b"".as_slice()),
            (1, b"x"),
            (7, b"htj2k-codestream-bytes"),
            (u32::MAX, &[0xAB; 4096]),
        ] {
            let got = assemble_chunked(idx, body);
            let mut expected = Vec::with_capacity(8 + body.len());
            expected.extend_from_slice(&envelope_header(idx, body.len()));
            expected.extend_from_slice(body);
            assert_eq!(got, expected, "chunked, idx {idx}, {} B", body.len());
        }
    }
}
