//! `lab/av1/metrics/quality.py` `sigma` in integers, equal bit for bit: docs/av1/noise-point.md §T3.

const EDGE_SHARE: f64 = 0.10;

/// Noise σ of one grey frame, `w` × `h` samples row-major; `inside` marks the in-window samples. NaN when no sample
/// one step from the border is kept.
pub fn sigma(samples: &[i32], w: usize, h: usize, inside: Option<&[bool]>) -> f64 {
    sigma_and_kept(samples, w, h, inside).0
}

/// σ and how many samples the estimate averaged.
pub fn sigma_and_kept(samples: &[i32], w: usize, h: usize, inside: Option<&[bool]>) -> (f64, u64) {
    assert_eq!(samples.len(), w * h);
    assert!(inside.is_none_or(|m| m.len() == w * h));
    let (count, lap_sum) = by_gradient(samples, w, h, inside);
    let n: u64 = count.iter().sum();
    if n == 0 {
        return (f64::NAN, 0);
    }
    let cut = quantile(&count, n, 1.0 - EDGE_SHARE);
    let (mut kept, mut sum) = (0u64, 0i64);
    for (_, (&c, &s)) in count.iter().zip(&lap_sum).enumerate().take_while(|(g, _)| *g as f64 <= cut) {
        kept += c;
        sum += s;
    }
    let s = (std::f64::consts::PI / 2.0).sqrt() * (sum as f64 / kept as f64) / 6.0;
    ((s * s - 1.0 / 12.0).max(0.0).sqrt(), kept)
}

/// Over the samples one step inside the border: by gradient |Sobel₀| + |Sobel₁|, how many there are and the sum of
/// their |Laplacian|.
fn by_gradient(x: &[i32], w: usize, h: usize, inside: Option<&[bool]>) -> (Vec<u64>, Vec<i64>) {
    let (mut count, mut lap_sum) = (Vec::new(), Vec::new());
    for y in 1..h.saturating_sub(1) {
        let (up, row, down) = (&x[(y - 1) * w..y * w], &x[y * w..(y + 1) * w], &x[(y + 1) * w..(y + 2) * w]);
        for i in 1..w.saturating_sub(1) {
            if inside.is_some_and(|m| !m[y * w + i]) {
                continue;
            }
            let smooth = |r: &[i32]| r[i - 1] + 2 * r[i] + r[i + 1];
            let second = |r: &[i32]| r[i - 1] - 2 * r[i] + r[i + 1];
            let slope = |r: &[i32]| r[i + 1] - r[i - 1];
            let lap = second(up) - 2 * second(row) + second(down);
            let grad = (smooth(down) - smooth(up)).unsigned_abs() + (slope(up) + 2 * slope(row) + slope(down)).unsigned_abs();
            let g = grad as usize;
            if g >= count.len() {
                count.resize(g + 1, 0);
                lap_sum.resize(g + 1, 0);
            }
            count[g] += 1;
            lap_sum[g] += lap.unsigned_abs() as i64;
        }
    }
    (count, lap_sum)
}

/// `np.quantile(grad, q)`, method `linear`, from the gradients' histogram: NumPy 2.4's virtual index and `_lerp`.
fn quantile(count: &[u64], n: u64, q: f64) -> f64 {
    let virtual_index = (n - 1) as f64 * q;
    let j = virtual_index.floor();
    if virtual_index >= (n - 1) as f64 {
        return rank(count, n - 1);
    }
    let (a, b) = (rank(count, j as u64), rank(count, j as u64 + 1));
    let t = virtual_index - j;
    let d = b - a;
    if t >= 0.5 {
        b - d * (1.0 - t)
    } else {
        a + d * t
    }
}

/// The gradient at 0-based rank `k` in ascending order.
fn rank(count: &[u64], k: u64) -> f64 {
    let mut below = 0;
    for (g, &c) in count.iter().enumerate() {
        below += c;
        if below > k {
            return g as f64;
        }
    }
    unreachable!("rank {k} of {below}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIZES: [(usize, usize); 3] = [(16, 12), (64, 48), (203, 151)];
    const NOISE: [f64; 3] = [0.3, 3.0, 30.0];

    /// Frame `i` of `golden.py`: a step edge and a ramp under Irwin–Hall noise from SplitMix64, half of them masked.
    fn frame(i: usize) -> (Vec<i32>, Vec<bool>, usize, usize) {
        let (w, h) = SIZES[i % 3];
        let (noise, masked) = (NOISE[i / 4], (i / 2) % 2 == 1);
        let mut state = i as u64 + 1;
        let (mut v, mut inside) = (Vec::new(), Vec::new());
        for y in 0..h {
            for x in 0..w {
                let mut u = 0.0;
                for _ in 0..12 {
                    state = state.wrapping_add(0x9E3779B97F4A7C15);
                    let mut z = state;
                    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
                    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
                    u += ((z ^ (z >> 31)) >> 11) as f64;
                }
                let level = (2000 + if 2 * x >= w { 300 } else { 0 } + 3 * y) as f64;
                v.push(((level + (u * 2f64.powi(-53) - 6.0) * noise + 0.5).floor() as i32).clamp(0, 4095));
                inside.push(!masked || ((x + y) % 7 != 0 && 4 * x < 3 * w));
            }
        }
        (v, inside, w, h)
    }

    /// σ equals `quality.sigma`'s on every golden frame, bit for bit (the bits `golden.py` prints).
    #[test]
    fn equals_quality_sigma_on_the_golden_frames() {
        const PINNED: [u64; 12] = [
            0x0000000000000000,
            0x0000000000000000,
            0x0000000000000000,
            0x0000000000000000,
            0x40070d73fbd7a226,
            0x4007ff9982712062,
            0x40094f979609bc5c,
            0x40088af6c25e1364,
            0x403e14ad9e9a0672,
            0x40436821e8d44816,
            0x403d13f03e50ac42,
            0x403e2ef04d6e1967,
        ];
        for (i, &bits) in PINNED.iter().enumerate() {
            let (v, inside, w, h) = frame(i);
            let masked = (i / 2) % 2 == 1;
            let got = sigma(&v, w, h, masked.then_some(&inside[..]));
            assert_eq!(got.to_bits(), bits, "frame {i}: {got} against {}", f64::from_bits(bits));
        }
    }

    /// A frame with no sample one step inside its border has no σ.
    #[test]
    fn a_frame_too_small_has_none() {
        assert!(sigma(&[1, 2, 3, 4], 2, 2, None).is_nan());
    }
}
