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
