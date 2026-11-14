//! The optimal-quality series beside the exact one, coded as ingest.py's `lossy` codes it:
//! docs/av1/payload-format.md §Optimal quality and §Depth cut.

use crate::htj2k::{Frame, Shape};
use anyhow::{bail, ensure, Context, Result};
use std::io::Write;
use std::process::{Command, Stdio};

pub const DEFAULT_Q: &str = "8";
pub const DEFAULT_G: u64 = 8;
const AOM: &str = "3.15.1";
const AOMENC: &str = env!("INGEST_AOMENC");
const CUT_DEPTH: u32 = 10;

extern "C" {
    fn av1_decode(units: *const u8, len: usize, out: *mut i32, cap: usize, shape: *mut Shape) -> i32;
}

/// What every frame's payload header and the metadata's `lossy` say.
#[derive(Debug, PartialEq)]
pub struct Form {
    pub q: u32,
    pub g: usize,
    pub bits: u32,
    pub depth: u32,
    pub signed: bool,
    pub offset: i32,
    /// The source's bits stored when coded as its depth cut.
    pub cut: Option<u32>,
}

/// Unsigned D over 10 is always the cut; grey of up to 10 bits after the offset at its own depth; nothing else.
pub fn form(f: &Frame, min: i32, max: i32, q: u32, g: usize) -> Result<Form> {
    ensure!(f.comps == 1, "optimal quality is grey only");
    if !f.signed && f.bits > CUT_DEPTH {
        return Ok(Form { q, g, bits: CUT_DEPTH, depth: CUT_DEPTH, signed: false, offset: 0, cut: Some(f.bits) });
    }
    let offset = if min < 0 { -min } else { 0 };
    let bits = (32 - ((max + offset) as u32).leading_zeros()).max(1);
    ensure!(
        bits <= CUT_DEPTH,
        "signed samples of {bits} bits after the offset: no optimal-quality form over {CUT_DEPTH} bits (docs/av1/payload-format.md §Optimal quality)"
    );
    let depth = if bits <= 8 { 8 } else { CUT_DEPTH };
    Ok(Form { q, g, bits, depth, signed: f.signed, offset, cut: None })
}

pub fn pinned() -> Result<()> {
    let help = Command::new(AOMENC).arg("--help").output().with_context(|| format!("run {AOMENC}"))?;
    let text = String::from_utf8_lossy(&help.stdout);
    ensure!(text.contains(&format!("AV1 Encoder v{AOM}")), "{AOMENC} is not libaom {AOM} (ingest/tools.sh)");
    Ok(())
}

/// A source sample as the value the encoder is given.
pub fn coded(form: &Form, v: i32) -> i32 {
    match form.cut {
        Some(d) => ((v + (1 << (d - CUT_DEPTH - 1))) >> (d - CUT_DEPTH)).min((1 << CUT_DEPTH) - 1),
        None => v + form.offset,
    }
}

/// One group's frames, already `coded`, as Y4M at the form's depth with neutral chroma, which --monochrome drops.
fn y4m(w: u32, h: u32, depth: u32, frames: &[Vec<i32>]) -> Vec<u8> {
    let tag = if depth == 8 { String::new() } else { format!("p{depth}") };
    let mut out = format!("YUV4MPEG2 W{w} H{h} F25:1 Ip A1:1 C420{tag}\n").into_bytes();
    let chroma = 2 * w.div_ceil(2) as usize * h.div_ceil(2) as usize;
    let sample = |out: &mut Vec<u8>, v: i32| match depth {
        8 => out.push(v as u8),
        _ => out.extend((v as u16).to_le_bytes()),
    };
    for px in frames {
        out.extend(b"FRAME\n");
        px.iter().for_each(|&v| sample(&mut out, v));
        (0..chroma).for_each(|_| sample(&mut out, 1 << (depth - 1)));
    }
    out
}

/// ingest.py's `lossy_args`.
fn args(form: &Form) -> Vec<String> {
    let (q, g, d) = (form.q, form.g, form.depth);
    let group = if g == 1 { vec!["--kf-max-dist=0".into()] } else { vec![format!("--kf-min-dist={g}"), format!("--kf-max-dist={g}")] };
    let fixed = "--ivf --disable-warning-prompt --good --cpu-used=6 --threads=1 --passes=1 --tune=psnr --end-usage=q";
    let rate = format!("--cq-level={q} --min-q={q} --max-q={q} --deltaq-mode=0 --aq-mode=0 --denoise-noise-level=0");
    let after = format!("--monochrome --profile=0 --bit-depth={d} --input-bit-depth={d}");
    let words = |s: &str| s.split(' ').map(String::from).collect::<Vec<_>>();
    [words(fixed), words(&rate), words("--lag-in-frames=0 --auto-alt-ref=0"), group, words(&after)].concat()
}

fn ivf_units(raw: &[u8]) -> Result<Vec<Vec<u8>>> {
    let (mut pos, mut units) = (32, Vec::new());
    while pos < raw.len() {
        let head = raw.get(pos..pos + 12).context("a cut IVF frame header")?;
        let n = u32::from_le_bytes(head[..4].try_into().unwrap()) as usize;
        units.push(raw.get(pos + 12..pos + 12 + n).context("a cut IVF frame")?.to_vec());
        pos += 12 + n;
    }
    Ok(units)
}

/// The 16-byte payload header, one frame a payload: docs/av1/payload-format.md §Payload.
fn payload(form: &Form, unit: &[u8]) -> Vec<u8> {
    let head = [1, form.bits as u8, form.depth as u8, 0, form.signed as u8, 0, 0, 0];
    [&head[..], &(form.offset as u32).to_le_bytes(), &1u32.to_le_bytes(), &(unit.len() as u32).to_le_bytes(), unit].concat()
}

/// One group, one encoder run; each frame decoded from the group's keyframe on, at the form's depth and size.
pub fn group(f: &Frame, form: &Form, frames: &[Vec<i32>]) -> Result<Vec<Vec<u8>>> {
    let mut aomenc = Command::new(AOMENC)
        .args(["-q", "-o", "-", &format!("--limit={}", frames.len())])
        .args(args(form))
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("run {AOMENC}"))?;
    let input = y4m(f.w, f.h, form.depth, frames);
    let mut stdin = aomenc.stdin.take().unwrap();
    let feed = std::thread::spawn(move || stdin.write_all(&input));
    let out = aomenc.wait_with_output()?;
    feed.join().expect("the encoder's feed panicked")?;
    ensure!(out.status.success(), "aomenc: {}", String::from_utf8_lossy(&out.stderr).trim());
    let units = ivf_units(&out.stdout)?;
    ensure!(units.len() == frames.len(), "{} units for {} frames", units.len(), frames.len());
    let mut stream = Vec::new();
    for (j, unit) in units.iter().enumerate() {
        stream.extend(unit);
        let mut out = vec![0i32; f.len()];
        let mut shape = Shape::default();
        // SAFETY: av1_decode reads `stream` and writes at most `out.len()` samples into `out`.
        let r = unsafe { av1_decode(stream.as_ptr(), stream.len(), out.as_mut_ptr(), out.len(), &mut shape) };
        ensure!(r == 0, "frame {j} of its group: av1 decode from the keyframe failed ({r})");
        let got = (shape.w, shape.h, shape.planes, shape.bits);
        if got != (f.w as i32, f.h as i32, 1, form.depth as i32) {
            bail!("frame {j} of its group decoded from the keyframe as (w, h, planes, bits) {got:?}");
        }
    }
    Ok(units.iter().map(|u| payload(form, u)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grey(bits: u32, signed: bool) -> Frame {
        Frame { w: 5, h: 3, comps: 1, bits, signed }
    }

    /// Unsigned D over 10 is coded as its 10-bit cut, whatever its range; D 10 and under at its own depth.
    #[test]
    fn unsigned_over_ten_bits_is_always_cut() {
        let cut = form(&grey(12, false), 0, 900, 8, 8).unwrap();
        assert_eq!((cut.bits, cut.depth, cut.offset, cut.cut), (10, 10, 0, Some(12)));
        let own = form(&grey(10, false), 0, 1023, 8, 8).unwrap();
        assert_eq!((own.bits, own.depth, own.cut), (10, 10, None));
        let eight = form(&grey(8, false), 0, 200, 8, 8).unwrap();
        assert_eq!((eight.bits, eight.depth), (8, 8));
    }

    /// A signed source is coded shifted by its offset at the smallest of 8 and 10 bits holding it, and refused over 10.
    #[test]
    fn signed_is_offset_and_refused_over_ten_bits() {
        let s8 = form(&grey(8, true), -128, 127, 8, 1).unwrap();
        assert_eq!((s8.bits, s8.depth, s8.offset, s8.signed, s8.cut), (8, 8, 128, true, None));
        let s10 = form(&grey(12, true), -300, 400, 8, 1).unwrap();
        assert_eq!((s10.bits, s10.depth, s10.offset), (10, 10, 300));
        let e = form(&grey(12, true), -2048, 2047, 8, 1).unwrap_err().to_string();
        assert!(e.contains("signed") && e.contains("12 bits"), "{e}");
    }

    /// RGB has no optimal-quality form.
    #[test]
    fn rgb_is_refused() {
        let rgb = Frame { w: 5, h: 3, comps: 3, bits: 8, signed: false };
        assert!(form(&rgb, 0, 255, 8, 1).unwrap_err().to_string().contains("grey only"));
    }

    /// The cut rounds half up and clamps at 1023; an uncut value is shifted by the offset.
    #[test]
    fn the_cut_rounds_half_up_and_clamps() {
        let cut = form(&grey(12, false), 0, 4095, 8, 1).unwrap();
        assert_eq!([0, 1, 2, 5, 6, 4092, 4093, 4095].map(|v| coded(&cut, v)), [0, 0, 1, 1, 2, 1023, 1023, 1023]);
        let s = form(&grey(8, true), -128, 127, 8, 1).unwrap();
        assert_eq!(coded(&s, -128), 0);
    }

    /// Y4M as ingest.py's write_y4m writes grey: a C420 header, then each frame's luma and two mid-grey chroma planes.
    #[test]
    fn y4m_is_luma_and_neutral_chroma() {
        let out = y4m(3, 3, 10, &[vec![0, 1, 2, 3, 4, 5, 6, 7, 1023]]);
        let head = b"YUV4MPEG2 W3 H3 F25:1 Ip A1:1 C420p10\nFRAME\n";
        assert_eq!(&out[..head.len()], head);
        let body = &out[head.len()..];
        assert_eq!(body.len(), 9 * 2 + 2 * 4 * 2);
        assert_eq!(&body[16..18], &1023u16.to_le_bytes());
        assert!(body[18..].chunks(2).all(|c| c == 512u16.to_le_bytes()));
        assert!(y4m(2, 1, 8, &[vec![7, 9]]).starts_with(b"YUV4MPEG2 W2 H1 F25:1 Ip A1:1 C420\nFRAME\n\x07\x09\x80\x80"));
    }

    /// G 1 makes every frame a keyframe; G over 1 fixes the keyframe distance at G.
    #[test]
    fn the_group_sets_the_keyframe_distance() {
        let one = args(&form(&grey(8, false), 0, 255, 8, 1).unwrap());
        assert!(one.contains(&"--kf-max-dist=0".into()) && !one.iter().any(|a| a.starts_with("--kf-min-dist")));
        let eight = args(&form(&grey(8, false), 0, 255, 24, 8).unwrap());
        for a in ["--kf-min-dist=8", "--kf-max-dist=8", "--cq-level=24", "--min-q=24", "--max-q=24", "--bit-depth=8"] {
            assert!(eight.contains(&a.into()), "{a} not in {eight:?}");
        }
    }

    /// The header is version 1, bits, depth, split 0, flags, three zero bytes, the offset and a frame count of 1.
    #[test]
    fn the_payload_header() {
        let s = form(&grey(8, true), -128, 127, 8, 1).unwrap();
        let p = payload(&s, b"xyz");
        assert_eq!(p, [&[1, 8, 8, 0, 1, 0, 0, 0, 128, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0][..], b"xyz"].concat());
    }

    /// An IVF file's frames, each after its 12-byte header, in order.
    #[test]
    fn ivf_frames_in_order() {
        let mut raw = vec![0u8; 32];
        for unit in [&b"ab"[..], b"cde"] {
            raw.extend((unit.len() as u32).to_le_bytes());
            raw.extend([0u8; 8]);
            raw.extend(unit);
        }
        assert_eq!(ivf_units(&raw).unwrap(), [b"ab".to_vec(), b"cde".to_vec()]);
        raw.pop();
        assert!(ivf_units(&raw).is_err());
    }
}
