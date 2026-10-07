import type { Example, ExampleInput, TaskDefinition } from '../core/index.js';

export interface ScoreContext {
  example: Example;
  input: ExampleInput;
  task: TaskDefinition;
  output: string;
}

export interface ScoreResult {
  score: number;
  detail?: unknown;
}

export interface AggregateItem {
  example: Example;
  input: ExampleInput;
  output: string | undefined;
  score: number | undefined;
}

export interface Scorer {
  /** Key used in results; must be unique within a suite. */
  name: string;
  /** Per-example score, normalized to 0..1 where possible. */
  score(ctx: ScoreContext): number | ScoreResult | Promise<number | ScoreResult>;
  /** Optional dataset-level metrics (e.g. macro F1), keyed by metric name. */
  aggregate?(items: AggregateItem[]): Record<string, number>;
}

/** Wrap a plain function as a scorer. */
export function custom(name: string, fn: Scorer['score'], aggregate?: Scorer['aggregate']): Scorer {
  return { name, score: fn, aggregate };
}

export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Expected values can be a single reference or an array of acceptable references. */
export function references(expected: unknown): string[] {
  if (expected === undefined || expected === null) return [];
  if (Array.isArray(expected)) return expected.map((e) => (typeof e === 'string' ? e : JSON.stringify(e)));
  return [typeof expected === 'string' ? expected : JSON.stringify(expected)];
}
