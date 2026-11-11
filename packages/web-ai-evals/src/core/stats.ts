import type { Distribution } from './types.js';

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function distribution(values: Array<number | undefined>): Distribution | undefined {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const sum = xs.reduce((a, b) => a + b, 0);
  return {
    n: xs.length,
    mean: sum / xs.length,
    p50: quantile(xs, 0.5),
    p90: quantile(xs, 0.9),
    p95: quantile(xs, 0.95),
    min: xs[0],
    max: xs[xs.length - 1],
  };
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}
