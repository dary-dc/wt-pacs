//! The per-frame check: a frame's samples against its digest. `docs/FIXTURES.md` §Frame digests.

use anyhow::{Context, Result};
use serde_json::Value;

#[derive(Debug, PartialEq)]
pub enum Exact {
    True,
    False,
    Unchecked,
}

/// The metadata's frame digests in index order; `None` when it has none in XXH3-64.
pub fn digests(metadata: &str) -> Result<Option<Vec<u64>>> {
    let metadata: Value = serde_json::from_str(metadata).context("metadata JSON")?;
    let digests = &metadata["digests"];
    if digests["algorithm"] != "xxh3-64" {
        return Ok(None);
    }
    let frames = digests["frames"].as_array().context("digests.frames")?;
    let hex = |d: &Value| u64::from_str_radix(d.as_str()?, 16).ok();
    frames.iter().map(|d| hex(d).with_context(|| format!("digest {d}"))).collect::<Result<_>>().map(Some)
}

/// `samples` as the decoder hands them on.
pub fn exact(samples: &[u8], digest: Option<u64>) -> Exact {
    match digest {
        Some(digest) if xxhash_rust::xxh3::xxh3_64(samples) == digest => Exact::True,
        Some(_) => Exact::False,
        None => Exact::Unchecked,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The hash is XXH3-64 as Python's `xxhash` 4.0.2 computes it, on every length round XXH3's
    /// paths, over the bytes `client/decode/xxh3.test.mjs` hashes.
    #[test]
    fn the_hash_is_pythons_xxh3_64() {
        let data: Vec<u8> = (0..3 * 16384 + 4099u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
        for (len, want) in [
            (0, 0x2d06800538d394c2),
            (1, 0xc44bdff4074eecdb),
            (240, 0xb714c5fd22744964),
            (241, 0xbc424a2c480dd281),
            (16385, 0x5946e5febebb3b4c),
            (data.len(), 0xedc83c80240dc1ad),
        ] {
            assert_eq!(exact(&data[..len], Some(want)), Exact::True, "{len} bytes");
        }
    }

    /// One flipped bit makes a frame `false`; no digest leaves it `unchecked`.
    #[test]
    fn a_flipped_bit_is_false_and_no_digest_is_unchecked() {
        let mut samples = vec![7u8; 300];
        let digest = xxhash_rust::xxh3::xxh3_64(&samples);
        samples[150] ^= 1;
        assert_eq!(exact(&samples, Some(digest)), Exact::False);
        assert_eq!(exact(&samples, None), Exact::Unchecked);
    }

    /// Digests are read only in XXH3-64, in index order, from their hex; a malformed one is an error.
    #[test]
    fn digests_are_read_only_in_xxh3_64() {
        let read = |json: &str| digests(json).map_err(|e| e.to_string());
        let frames = r#""frames": ["750932eabd34755e", "0000000000000001"]"#;
        assert_eq!(read(&format!(r#"{{"digests": {{"algorithm": "xxh3-64", {frames}}}}}"#)), Ok(Some(vec![0x750932eabd34755e, 1])));
        assert_eq!(read(&format!(r#"{{"digests": {{"algorithm": "md5", {frames}}}}}"#)), Ok(None));
        assert_eq!(read(r#"{"frameCount": 3}"#), Ok(None));
        assert!(read(r#"{"digests": {"algorithm": "xxh3-64", "frames": ["xyz"]}}"#).is_err());
    }
}
