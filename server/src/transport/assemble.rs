//! How each send path builds the media envelope. The write functions call these;
//! `all_send_paths_are_the_same_wire` compares the three constructions.
//!
//! Wire: `[4B BE total_len][4B BE display_index][codestream…]`
//! where `total_len = 4 + codestream.len()`.

use bytes::Bytes;
use frame_envelope::ENVELOPE_LEN;

/// Copy path: `wrap` then length-prefix. Two full-frame copies on the write path.
pub fn assemble_copy(idx: u32, body: &[u8]) -> Vec<u8> {
    let payload = frame_envelope::wrap(idx, body);
    let len = payload.len().min(u32::MAX as usize) as u32;
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&payload);
    out
}

/// Split path writes these three slices. Built from the index and length, not
/// by splitting `envelope_header` — that would make the split assertion a tautology.
pub fn split_parts(idx: u32, body: &[u8]) -> ([u8; 4], [u8; 4], &[u8]) {
    let wire_len = ((ENVELOPE_LEN + body.len()) as u32).to_be_bytes();
    let index = idx.to_be_bytes();
    (wire_len, index, body)
}

pub fn assemble_split(idx: u32, body: &[u8]) -> Vec<u8> {
    let (len, index, body) = split_parts(idx, body);
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&len);
    out.extend_from_slice(&index);
    out.extend_from_slice(body);
    out
}

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

    /// Three independent constructions of the same wire. The write paths call
    /// `assemble_copy` / `split_parts` / `chunked_chunks`; if a path changes what
    /// it writes without updating its assembler, this fails against the others.
    #[test]
    fn all_send_paths_are_the_same_wire() {
        for (idx, body) in [
            (0u32, b"".as_slice()),
            (1, b"x"),
            (7, b"htj2k-codestream-bytes"),
            (u32::MAX, &[0xAB; 4096]),
        ] {
            let copy = assemble_copy(idx, body);
            let split = assemble_split(idx, body);
            let chunked = assemble_chunked(idx, body);
            assert_eq!(copy, chunked, "chunked, idx {idx}, {} B", body.len());
            assert_eq!(copy, split, "split, idx {idx}, {} B", body.len());
        }
    }
}
