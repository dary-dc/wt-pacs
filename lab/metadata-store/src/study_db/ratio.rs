//! `--mode ce-ratio`: zstd on a series' metadata as one stream, its groups as received against the converted-enhanced
//! instance, as pre-registered in lab/metadata-store/README.md §Compression of the converted-enhanced layout.

use super::run::{stats, thread_cpu_ms, INPUTS, SERIES};
use super::{shared, Package};
use crate::group;
use anyhow::{ensure, Result};
use std::path::Path;
use std::time::Instant;

const LEVELS: [i32; 3] = [1, 3, 19];
/// Bytes of each series' frames coded HTJ2K-lossless: README §Repetition, "pixels in HTJ2K".
const CODED_FRAMES: [(&str, u64); 5] =
    [("ct", 41_184_983), ("pt", 7_707_320), ("mr", 25_959_791), ("mg", 3_480_592), ("us", 78_499_765)];
/// Uplink in bit/s of #156's link classes: README §Compression of the converted-enhanced layout.
pub const LINKS: [(&str, f64); 3] = [("fiber", 100e6), ("4G/5G", 19e6), ("rural ADSL", 1e6)];

#[derive(Clone, Copy, PartialEq)]
enum Layout {
    Groups,
    Converted,
}

impl Layout {
    fn name(self) -> &'static str {
        match self {
            Layout::Groups => "groups",
            Layout::Converted => "converted enhanced",
        }
    }
}

/// Each part as `[u32 LE length][bytes]`.
fn framed(parts: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for part in parts {
        out.extend_from_slice(&(part.len() as u32).to_le_bytes());
        out.extend_from_slice(part);
    }
    out
}

/// The series' metadata as one stream: the exam and series groups, then every instance group and private group, or
/// the converted instance in their place.
fn stream(layout: Layout, p: &Package) -> Result<Vec<u8>> {
    let mut parts: Vec<&[u8]> = vec![&p.exam, &p.series];
    let converted;
    match layout {
        Layout::Groups => {
            for i in &p.instances {
                parts.extend([i.group.as_slice(), i.private.as_slice()]);
            }
        }
        Layout::Converted => {
            converted = group::write(&shared::converted(p)?);
            parts.push(&converted);
        }
    }
    Ok(framed(&parts))
}

pub fn send_ms(bytes: u64, bits_per_second: f64) -> f64 {
    bytes as f64 * 8.0 / bits_per_second * 1e3
}

struct Arm {
    layout: Layout,
    level: i32,
    raw: Vec<u8>,
    compressed: Vec<u8>,
}

pub fn run(packages: &Path, rounds: usize) -> Result<()> {
    println!("{}", serde_json::json!({"zstd": zstd::zstd_safe::version_string(), "links_up_bit_s": LINKS}));
    for (input, suffix) in INPUTS {
        for (name, coded) in SERIES.iter().zip(CODED_FRAMES) {
            ensure!(*name == coded.0, "the coded frames are listed out of order");
            let path = packages.join(format!("{name}{suffix}.tar"));
            let p = super::unpack(&std::fs::read(&path)?)?;
            let mut layouts = vec![Layout::Groups];
            if shared::applies(&p.modality) {
                let reference = std::fs::read(packages.join(format!("{name}{suffix}.ce")))?;
                ensure!(group::write(&shared::converted(&p)?) == reference, "{name}{suffix}: converted differs from #154's");
                layouts.push(Layout::Converted);
            }
            let mut arms = Vec::new();
            for &layout in &layouts {
                let raw = stream(layout, &p)?;
                for level in LEVELS {
                    let compressed = zstd::bulk::compress(&raw, level)?;
                    ensure!(zstd::bulk::decompress(&compressed, raw.len())? == raw, "{name}: level {level} does not round-trip");
                    arms.push(Arm { layout, level, raw: raw.clone(), compressed });
                }
            }

            let mut times = vec![(Vec::new(), Vec::new(), Vec::new()); arms.len()];
            for round in 0..rounds {
                for k in 0..arms.len() {
                    let a = (round + k) % arms.len();
                    let (arm, out) = (&arms[a], &mut times[a]);
                    let (wall, cpu) = (Instant::now(), thread_cpu_ms());
                    let c = zstd::bulk::compress(&arm.raw, arm.level)?;
                    out.0.push(thread_cpu_ms() - cpu);
                    out.2.push(wall.elapsed().as_secs_f64() * 1e3);
                    let cpu = thread_cpu_ms();
                    let d = zstd::bulk::decompress(&c, arm.raw.len())?;
                    out.1.push(thread_cpu_ms() - cpu);
                    ensure!(c == arm.compressed && d == arm.raw, "{name}: a round differs");
                }
            }

            let groups_raw = arms[0].raw.len() as u64;
            for (arm, (compress, decompress, wall)) in arms.iter().zip(times) {
                let (raw, packed) = (arm.raw.len() as u64, arm.compressed.len() as u64);
                let saving = |from: u64| -> serde_json::Value {
                    LINKS.iter().map(|(link, rate)| (link.to_string(), serde_json::json!(send_ms(from, *rate) - send_ms(packed, *rate)))).collect()
                };
                println!(
                    "{}",
                    serde_json::json!({
                        "input": input, "series": name, "instances": p.instances.len(), "package_tar": std::fs::metadata(&path)?.len(),
                        "layout": arm.layout.name(), "level": arm.level, "raw": raw, "compressed": packed,
                        "ratio": raw as f64 / packed as f64,
                        "compress_cpu_ms": stats(compress), "decompress_cpu_ms": stats(decompress), "compress_wall_ms": stats(wall),
                        "coded_frames": coded.1,
                        "share_raw": raw as f64 / (raw + coded.1) as f64,
                        "share_compressed": packed as f64 / (packed + coded.1) as f64,
                        "saving_ms": saving(raw), "saving_from_groups_raw_ms": saving(groups_raw),
                    })
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::tests::package;
    use super::super::unpack;
    use super::*;

    fn parts(mut rest: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        while !rest.is_empty() {
            let n = u32::from_le_bytes(rest[..4].try_into().unwrap()) as usize;
            out.push(rest[4..4 + n].to_vec());
            rest = &rest[4 + n..];
        }
        out
    }

    /// The groups' stream holds the exam group, the series group, then each instance's group and private group, in order.
    #[test]
    fn the_groups_stream_holds_every_group_once() {
        let p = unpack(&package(3)).unwrap();
        let mut want = vec![p.exam.clone(), p.series.clone()];
        for i in &p.instances {
            want.extend([i.group.clone(), i.private.clone()]);
        }
        assert_eq!(parts(&stream(Layout::Groups, &p).unwrap()), want);
    }

    /// The converted stream holds the exam group, the series group and the converted instance, and nothing else.
    #[test]
    fn the_converted_stream_holds_the_converted_instance() {
        let p = unpack(&package(3)).unwrap();
        let ce = group::write(&shared::converted(&p).unwrap());
        assert_eq!(parts(&stream(Layout::Converted, &p).unwrap()), vec![p.exam.clone(), p.series.clone(), ce]);
    }

    /// A send time is bytes × 8 over the link's bit rate: 125 000 bytes take one second at 1 Mbit/s.
    #[test]
    fn send_time_is_bits_over_rate() {
        assert_eq!(send_ms(125_000, 1e6), 1000.0);
        assert_eq!(LINKS.iter().find(|l| l.0 == "rural ADSL").unwrap().1, 1e6);
    }
}
