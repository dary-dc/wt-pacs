//! One frame coded as ingest.py codes it, and decoded back in-process.

use anyhow::{ensure, Result};
use std::ffi::{c_char, c_void, CStr};

#[repr(C)]
#[derive(Default)]
struct Shape {
    w: i32,
    h: i32,
    planes: i32,
    bits: i32,
    signed: i32,
}

extern "C" {
    fn htj2k_encode(samples: *const i32, w: u32, h: u32, comps: u32, bits: u32, out: *mut *mut u8, len: *mut usize) -> i32;
    fn htj2k_decode(bytes: *const u8, len: usize, out: *mut i32, cap: usize, shape: *mut Shape) -> i32;
    fn decoder_versions() -> *const c_char;
    fn free(p: *mut c_void);
}

/// ingest.py's `DECODERS`: libdecode is the one `ingest/coded-frames/build.sh` builds for both ingests.
const DECODERS: &str = "dav1d 1.5.4-0-g54706fc, openjph 0.31.0";

pub fn pinned() -> Result<()> {
    // SAFETY: decoder_versions returns a static NUL-terminated buffer.
    let got = unsafe { CStr::from_ptr(decoder_versions()) }.to_string_lossy();
    ensure!(got == DECODERS, "the in-process decoders are {got}, not {DECODERS} (ingest/coded-frames/build.sh)");
    Ok(())
}

pub struct Frame {
    pub w: u32,
    pub h: u32,
    pub comps: u32,
    pub bits: u32,
    pub signed: bool,
}

impl Frame {
    pub fn len(&self) -> usize {
        (self.w * self.h * self.comps) as usize
    }
}

/// A signed frame is coded shifted by 2^(bits − 1), then its SIZ marked signed: lab/scripts/sign_htj2k.py says why.
pub fn encode(f: &Frame, samples: &[i32]) -> Result<Vec<u8>> {
    assert_eq!(samples.len(), f.len());
    let shift = if f.signed { 1 << (f.bits - 1) } else { 0 };
    let shifted: Vec<i32> = samples.iter().map(|v| v + shift).collect();
    let (mut out, mut len) = (std::ptr::null_mut(), 0usize);
    // SAFETY: `shifted` holds the w·h·comps samples htj2k_encode reads; on success `out` is a malloc'd buffer of
    // `len` bytes, copied and freed here once.
    let mut data = unsafe {
        let r = htj2k_encode(shifted.as_ptr(), f.w, f.h, f.comps, f.bits, &mut out, &mut len);
        ensure!(r == 0, "htj2k encode failed ({r})");
        let data = std::slice::from_raw_parts(out, len).to_vec();
        free(out.cast());
        data
    };
    if f.signed {
        let comps = u16::from_be_bytes([data[40], data[41]]) as usize;
        for c in 0..comps {
            data[42 + 3 * c] |= 0x80;
        }
    }
    Ok(data)
}

/// The codestream decoded alone, its samples interleaved, or why not.
pub fn decode(f: &Frame, data: &[u8]) -> Result<Vec<i32>> {
    let mut out = vec![0i32; f.len()];
    let mut shape = Shape::default();
    // SAFETY: htj2k_decode reads `data` and writes at most `out.len()` samples into `out`.
    let r = unsafe { htj2k_decode(data.as_ptr(), data.len(), out.as_mut_ptr(), out.len(), &mut shape) };
    ensure!(r == 0, "htj2k decode failed ({r})");
    let got = (shape.w, shape.h, shape.planes, shape.bits, shape.signed != 0);
    let want = (f.w as i32, f.h as i32, f.comps as i32, f.bits as i32, f.signed);
    ensure!(got == want, "decoded as (w, h, planes, bits, signed) {got:?}, coded as {want:?}");
    Ok(out)
}
