/** Nearest-rank percentiles — plan §10 / §14.1. */

/** Rank = ceil(p/100 × N), clamped to [1, N]; value = sorted[rank - 1]. */
export function nearestRank(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const n = sortedAsc.length;
  const rank = Math.min(n, Math.max(1, Math.ceil((p / 100) * n)));
  return sortedAsc[rank - 1];
}

export function distributionStats(values: number[]): {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  total: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
} {
  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      min: 0,
      max: 0,
      total: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((s, v) => s + v, 0);
  const mean = round2(total / sorted.length);
  const median = round2(nearestRank(sorted, 50));
  return {
    count: sorted.length,
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    total,
    p50: round2(nearestRank(sorted, 50)),
    p75: round2(nearestRank(sorted, 75)),
    p90: round2(nearestRank(sorted, 90)),
    p95: round2(nearestRank(sorted, 95)),
    p99: round2(nearestRank(sorted, 99)),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
