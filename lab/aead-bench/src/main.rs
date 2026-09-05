//! Packet-AEAD throughput at QUIC datagram sizes.
//!
//! Why this exists: swapping the rustls provider moved end-to-end throughput by only
//! ~1–2% (`docs/quic-transport-optimization.md`, arm C). That is either a real result
//! or a broken arm. This measures the AEAD alone, so the end-to-end number can be
//! checked against the share of server CPU that crypto can possibly account for.
//!
//! Run both halves:
//!   cargo run --release -p aead-bench --no-default-features --features ring
//!   cargo run --release -p aead-bench --no-default-features --features aws-lc-rs

#[cfg(all(feature = "ring", not(feature = "aws-lc-rs")))]
use ring as provider;

#[cfg(feature = "aws-lc-rs")]
use aws_lc_rs as provider;

use provider::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_128_GCM, AES_256_GCM, CHACHA20_POLY1305};
use std::time::Instant;

const PROVIDER: &str = if cfg!(feature = "aws-lc-rs") { "aws-lc-rs" } else { "ring" };

/// QUIC datagram payloads: the 1200-byte floor, the DPLMTUD ceiling quinn searches to,
/// and one GSO batch of ten 1452-byte segments as quinn's `MAX_TRANSMIT_SEGMENTS` builds.
const SIZES: [usize; 3] = [1200, 1452, 14520];

fn bench(name: &str, alg: &'static provider::aead::Algorithm, size: usize) {
    let key = LessSafeKey::new(UnboundKey::new(alg, &[0x2b; 32][..alg.key_len()]).unwrap());
    let mut buf = vec![0xAB; size + alg.tag_len()];
    let target = std::time::Duration::from_millis(400);

    // Warm up the branch predictors and the key schedule before timing.
    for _ in 0..1000 {
        seal(&key, &mut buf, size);
    }


    let start = Instant::now();
    let mut iters = 0u64;
    while start.elapsed() < target {
        for _ in 0..1000 {
            seal(&key, &mut buf, size);
        }
        iters += 1000;
    }
    let secs = start.elapsed().as_secs_f64();
    let gbps = (iters as f64 * size as f64 * 8.0) / secs / 1e9;
    // CPU-seconds per GB of payload — directly comparable to `cpu_s_per_gb` in the
    // end-to-end TSVs, which is the whole point of running this.
    let cpu_s_per_gb = secs / (iters as f64 * size as f64 / 1e9);
    println!("{PROVIDER}\t{name}\t{size}\t{gbps:.2}\t{cpu_s_per_gb:.3}");
}

/// One packet seal, in place, tag written after the payload — the shape quinn uses.
#[inline]
fn seal(key: &LessSafeKey, buf: &mut [u8], size: usize) {
    let nonce = Nonce::assume_unique_for_key([1u8; 12]);
    let tag = key
        .seal_in_place_separate_tag(nonce, Aad::empty(), &mut buf[..size])
        .expect("seal");
    let tag = tag.as_ref();
    buf[size..size + tag.len()].copy_from_slice(tag);
    std::hint::black_box(&buf[..1]);
}

fn main() {
    println!("provider\talgorithm\tpayload_bytes\tgbps\tcpu_s_per_gb");
    for size in SIZES {
        bench("aes-128-gcm", &AES_128_GCM, size);
        bench("aes-256-gcm", &AES_256_GCM, size);
        bench("chacha20-poly1305", &CHACHA20_POLY1305, size);
    }
}
