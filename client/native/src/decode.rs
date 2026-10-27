//! A frame's samples as the browser's `decodeFrame` hands them on: a codestream through OpenJPH, an AV1 payload
//! through dav1d and the payload's merge. `docs/native/README.md` §8.4, `docs/av1/payload-format.md`.

use anyhow::{bail, ensure, Context, Result};
use std::ffi::{c_char, c_int, CStr};
use std::sync::Once;

/// `ingest/coded-frames/decode.cpp`'s: `planes` samples interleaved per pixel, a stream's coded order.
#[repr(C)]
#[derive(Default)]
struct Shape {
    w: i32,
    h: i32,
    planes: i32,
    bits: i32,
    signed: i32,
}

type Decode = unsafe extern "C" fn(*const u8, usize, *mut i32, usize, *mut Shape) -> c_int;

extern "C" {
    fn av1_decode(unit: *const u8, len: usize, out: *mut i32, cap: usize, shape: *mut Shape) -> c_int;
    fn htj2k_decode(codestream: *const u8, len: usize, out: *mut i32, cap: usize, shape: *mut Shape) -> c_int;
    fn av1_threads(n: c_int);
    fn decoder_versions() -> *const c_char;
}

/// "dav1d X, openjph Y", as linked.
pub fn versions() -> String {
    // SAFETY: a pointer to a NUL-terminated static buffer.
    unsafe { CStr::from_ptr(decoder_versions()) }.to_string_lossy().into_owned()
}

pub struct Decoder {
    av1: bool,
    samples: Vec<i32>,
}

impl Decoder {
    /// AV1 when the series' metadata says `"codec": "av1"`, HTJ2K otherwise, as `decoder.js` chooses.
    pub fn new(metadata: &str) -> Result<Self> {
        static THREADS: Once = Once::new();
        // SAFETY: a plain store, made once and before any decode.
        THREADS.call_once(|| unsafe { av1_threads(0) });
        let metadata: serde_json::Value = serde_json::from_str(metadata).context("metadata JSON")?;
        Ok(Self { av1: metadata["codec"] == "av1", samples: Vec::new() })
    }

    pub fn decode(&mut self, bytes: &[u8]) -> Result<Vec<u8>> {
        if self.av1 {
            self.payload(bytes)
        } else {
            self.codestream(bytes)
        }
    }

    /// Unclamped, unlike `htj2k_decoder.cpp`'s `pack`: a reversible codestream decodes in range. `docs/native/README.md` §8.4.
    fn codestream(&mut self, bytes: &[u8]) -> Result<Vec<u8>> {
        let (shape, n) = self.alone(htj2k_decode, bytes).context("undecodable: htj2k")?;
        Ok(narrow(self.samples[..n].iter().copied(), shape.bits > 8))
    }

    /// Sample = ((top << split) | low) − offset; R, G, B from planes G, B, R, or through the inverse RCT.
    fn payload(&mut self, bytes: &[u8]) -> Result<Vec<u8>> {
        let p = parse(bytes).context("undecodable: av1 payload")?;
        let (top, low) = units(p.frame, p.split).context("undecodable: av1 payload")?;
        let (pic, n) = self.alone(av1_decode, top).context("undecodable: dav1d")?;
        let three = pic.planes == 3;
        let plain_rgb = p.bits == 8 && p.depth == 8 && p.split == 0 && !p.signed;
        let refused = if pic.bits != p.depth {
            format!("top stream {}-bit, header says {}", pic.bits, p.depth)
        } else if p.rct && !three {
            format!("top stream of {} planes under rct, not three", pic.planes)
        } else if !p.rct && three && !plain_rgb {
            "three planes without rct".into()
        } else {
            String::new()
        };
        ensure!(refused.is_empty(), "undecodable: av1 payload: {refused}");
        let top_samples = &self.samples[..n];
        let mut out: Vec<i32> = if p.rct {
            let rgb = |s: &[i32]| {
                let (b, r) = (s[1] - 256, s[2] - 256);
                let g = s[0] - ((b + r) >> 2);
                [r + g, g, b + g]
            };
            top_samples.chunks_exact(3).flat_map(rgb).collect()
        } else if three {
            top_samples.chunks_exact(3).flat_map(|s| [s[2], s[0], s[1]]).collect()
        } else {
            top_samples.iter().map(|&v| v << p.split).collect()
        };
        if let Some(low) = low {
            let (lp, n) = self.alone(av1_decode, low).context("undecodable: dav1d")?;
            ensure!(lp.bits == 8, "undecodable: av1 payload: low stream {}-bit, not 8", lp.bits);
            ensure!(
                lp.planes == 1 && (lp.w, lp.h) == (pic.w, pic.h),
                "undecodable: av1 payload: a low picture of {}x{}x{} under {}x{}",
                lp.w,
                lp.h,
                lp.planes,
                pic.w,
                pic.h
            );
            out.iter_mut().zip(&self.samples[..n]).for_each(|(v, low)| *v |= low);
        }
        if !p.rct {
            out.iter_mut().for_each(|v| *v = v.wrapping_sub(p.offset));
        }
        Ok(narrow(out.into_iter(), p.bits > 8))
    }

    /// One unit or codestream decoded alone into `samples`, which grows to the first frame's size; its shape and length.
    fn alone(&mut self, decode: Decode, bytes: &[u8]) -> Result<(Shape, usize)> {
        loop {
            let mut shape = Shape::default();
            // SAFETY: both buffers outlive the call, which writes at most `samples.len()` values.
            let r = unsafe { decode(bytes.as_ptr(), bytes.len(), self.samples.as_mut_ptr(), self.samples.len(), &mut shape) };
            let n = shape.w as usize * shape.h as usize * shape.planes as usize;
            match r {
                0 => return Ok((shape, n)),
                -2 if n > self.samples.len() => self.samples.resize(n, 0),
                -3 => bail!("a layout neither grey nor 4:4:4"),
                r => bail!("decode failed ({r})"),
            }
        }
    }
}

/// As the browser's typed array holds them: a byte a sample, or two little-endian over 8 bits.
fn narrow(samples: impl Iterator<Item = i32>, wide: bool) -> Vec<u8> {
    if wide {
        samples.flat_map(|v| (v as u16).to_le_bytes()).collect()
    } else {
        samples.map(|v| v as u8).collect()
    }
}

struct Payload<'a> {
    bits: i32,
    depth: i32,
    split: i32,
    signed: bool,
    rct: bool,
    offset: i32,
    frame: &'a [u8],
}

/// One frame's payload, every refusal `av1-payload.js` makes, by its words.
fn parse(bytes: &[u8]) -> Result<Payload<'_>> {
    ensure!(bytes.len() >= 16, "{} bytes, under the 16-byte header", bytes.len());
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let [version, bits, depth, split, flags] = [0, 1, 2, 3, 4].map(|i| bytes[i] as i32);
    let (signed, rct, offset, count) = (flags & 1 != 0, flags & 2 != 0, u32_at(8), u32_at(12));
    let container = |b: i32| if b <= 8 { 8 } else if b <= 10 { 10 } else { 12 };
    ensure!(version == 1, "version {version}, not 1");
    ensure!(flags & !3 == 0, "unknown flag bits {flags:#x}");
    ensure!(bytes[5..8] == [0; 3], "pad bytes not zero");
    ensure!([8, 10, 12].contains(&depth), "depth {depth}, not 8, 10 or 12");
    ensure!(split <= 8, "split {split}, over 8");
    ensure!(bits <= 16, "bits {bits}, over 16");
    ensure!(!rct || split == 0, "rct with split {split}");
    ensure!(offset == 0 || signed, "offset {offset} without signed");
    ensure!(rct || bits <= depth + split, "bits {bits} over depth {depth} + split {split}");
    let fits = container(bits - split);
    ensure!(rct || depth == fits, "depth {depth} for a top of {} bits, not {fits}", bits - split);
    ensure!(count == 1, "{count} frames, 1 expected");
    ensure!(bytes.len() >= 20, "frame lengths overrun the payload");
    let len = u32_at(16) as usize;
    ensure!(len <= bytes.len() - 20, "frame 0 overruns the payload");
    ensure!(len == bytes.len() - 20, "{} bytes past the last frame", bytes.len() - 20 - len);
    Ok(Payload { bits, depth, split, signed, rct, offset: offset as i32, frame: &bytes[20..] })
}

/// A split frame is `[u32le top length][top unit][low unit]`.
fn units(frame: &[u8], split: i32) -> Result<(&[u8], Option<&[u8]>)> {
    if split == 0 {
        return Ok((frame, None));
    }
    let n = frame.get(..4).map_or(0, |n| u32::from_le_bytes(n.try_into().unwrap()) as usize);
    ensure!(n >= 1 && n < frame.len().saturating_sub(4), "not a split frame ({} bytes)", frame.len());
    Ok((&frame[4..4 + n], Some(&frame[4 + n..])))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verify::{exact, Exact};
    use std::path::{Path, PathBuf};

    fn contract() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../client/contract")
    }

    fn golden(name: &str) -> Vec<u8> {
        std::fs::read(contract().join("av1/payloads").join(format!("{name}.av1"))).expect(name)
    }

    fn av1() -> Decoder {
        Decoder::new(r#"{"codec": "av1"}"#).unwrap()
    }

    /// **Every committed frame digest holds natively.** Both HTJ2K contract codestreams and every AV1 golden and
    /// matrix payload with a `NAME.xxh3` decode here to samples whose XXH3-64 is that digest, as the browser's
    /// frame check computes it: 109 frames. `docs/FIXTURES.md` §Frame digests.
    #[test]
    fn every_committed_frame_decodes_to_its_digest() {
        let (mut htj2k, mut av1) = (Decoder::new("{}").unwrap(), av1());
        let mut checked = 0;
        for dir in ["frames", "av1/payloads/plain", "av1/payloads/optimized", "av1/payloads/grey420", "av1/payloads/matrix"] {
            let mut digests: Vec<_> = std::fs::read_dir(contract().join(dir)).unwrap().map(|e| e.unwrap().path()).collect();
            digests.retain(|p| p.extension().is_some_and(|e| e == "xxh3"));
            for digest in digests {
                let want = u64::from_str_radix(std::fs::read_to_string(&digest).unwrap().trim(), 16).unwrap();
                let (decoder, coded) = match digest.with_extension("j2c") {
                    j2c if j2c.exists() => (&mut htj2k, j2c),
                    _ => (&mut av1, digest.with_extension("av1")),
                };
                let samples = decoder.decode(&std::fs::read(&coded).unwrap()).unwrap_or_else(|e| panic!("{}: {e:#}", coded.display()));
                assert_eq!(exact(&samples, Some(want)), Exact::True, "{}", coded.display());
                checked += 1;
            }
        }
        assert_eq!(checked, 109);
    }

    /// Every header and stream case `av1.test.mjs` refuses is refused here by the same words, before or after
    /// dav1d; and the decoder that refused them still decodes the next payload exactly.
    #[test]
    fn a_malformed_payload_is_refused_by_name() {
        let edit = |name: &str, edits: &[(usize, u8)]| {
            let mut b = golden(name);
            edits.iter().for_each(|&(at, v)| b[at] = v);
            b
        };
        let u32_at = |at: usize, v: u32| {
            let mut b = golden("optimized/g12");
            b[at..at + 4].copy_from_slice(&v.to_le_bytes());
            b
        };
        let g12 = "optimized/g12";
        let cases = [
            (golden(g12)[..15].to_vec(), "under the 16-byte header"),
            (edit(g12, &[(0, 2)]), "version 2, not 1"),
            (edit(g12, &[(4, 4)]), "unknown flag bits 0x4"),
            (edit(g12, &[(6, 1)]), "pad bytes not zero"),
            (edit(g12, &[(2, 9)]), "depth 9, not 8, 10 or 12"),
            (edit(g12, &[(3, 9)]), "split 9, over 8"),
            (edit(g12, &[(1, 17)]), "bits 17, over 16"),
            (edit(g12, &[(4, 2)]), "rct with split 2"),
            (u32_at(8, 5), "offset 5 without signed"),
            (edit(g12, &[(1, 13)]), "bits 13 over depth 10 + split 2"),
            (edit(g12, &[(1, 8), (3, 0)]), "depth 10 for a top of 8 bits, not 8"),
            (u32_at(12, 2), "2 frames, 1 expected"),
            (u32_at(16, 1_000_000), "frame 0 overruns the payload"),
            ([golden(g12), vec![0]].concat(), "1 bytes past the last frame"),
            (edit("plain/g8", &[(1, 10), (2, 10)]), "top stream 8-bit, header says 10"),
            (edit("plain/g12", &[(3, 1), (2, 12)]), "not a split frame"),
            (edit("plain/g10", &[(4, 2)]), "top stream of 1 planes under rct, not three"),
            (edit("plain/c8", &[(4, 1)]), "three planes without rct"),
            (edit("optimized/c8", &[(4, 0), (1, 10)]), "three planes without rct"),
        ];
        let mut decoder = av1();
        for (bytes, want) in cases {
            let got = decoder.decode(&bytes).map(|_| "decoded".to_string()).unwrap_or_else(|e| format!("{e:#}"));
            assert!(got.contains(want), "want {want:?}, got {got:?}");
        }
        let want = std::fs::read_to_string(contract().join("av1/payloads/optimized/g12.xxh3")).unwrap();
        let samples = decoder.decode(&golden(g12)).unwrap();
        assert_eq!(exact(&samples, u64::from_str_radix(want.trim(), 16).ok()), Exact::True);
    }
}
