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

/** Bootstrap 95% confidence interval of the mean (deterministic seed). */
export function bootstrapCI(values: number[], iterations = 1000, seed = 1): [number, number] {
  if (values.length < 2) return [NaN, NaN];
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) sum += values[Math.floor(rand() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return [quantile(means, 0.025), quantile(means, 0.975)];
}
