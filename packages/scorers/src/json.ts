import { extractJson } from '@web-ai-evals/core';
import { Ajv, type ValidateFunction } from 'ajv';
import type { Scorer } from './types.js';

function parse(output: string, strict: boolean): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(strict ? output.trim() : extractJson(output)) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** 1 when the output parses as JSON. `strict: false` (default) strips code fences first. */
export function jsonValid(opts: { name?: string; strict?: boolean } = {}): Scorer {
  return {
    name: opts.name ?? 'jsonValid',
    score: ({ output }) => {
      const r = parse(output, opts.strict ?? false);
      return r.ok ? 1 : { score: 0, detail: r.error };
    },
  };
}

/** 1 when the output parses and validates against the schema (explicit, or the example/task schema). */
export function jsonSchema(schema?: Record<string, unknown>, opts: { name?: string; strict?: boolean } = {}): Scorer {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const cache = new Map<string, ValidateFunction>();
  return {
    name: opts.name ?? 'jsonSchema',
    score: ({ output, input, task }) => {
      const s = schema ?? input.schema ?? task.responseSchema;
      if (!s) throw new Error('jsonSchema scorer needs a schema');
      const key = JSON.stringify(s);
      let validate = cache.get(key);
      if (!validate) cache.set(key, (validate = ajv.compile(s)));
      const r = parse(output, opts.strict ?? false);
      if (!r.ok) return { score: 0, detail: r.error };
      return validate(r.value) ? 1 : { score: 0, detail: ajv.errorsText(validate.errors) };
    },
  };
}

function flatten(value: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = Array.isArray(value) ? JSON.stringify([...value].map(norm).sort()) : norm(value);
  }
  return out;
}

function norm(v: unknown): unknown {
  return typeof v === 'string' ? v.trim().toLowerCase() : v;
}

/**
 * Field-level accuracy against `example.expected` (an object): the share of
 * expected leaf fields whose values match (strings compared case-insensitively,
 * arrays as sets).
 */
export function jsonFieldMatch(opts: { name?: string } = {}): Scorer {
  return {
    name: opts.name ?? 'fields',
    score: ({ output, example }) => {
      const expected = flatten(example.expected);
      const keys = Object.keys(expected);
      if (!keys.length) throw new Error('jsonFieldMatch needs an object in example.expected');
      const r = parse(output, false);
      if (!r.ok) return { score: 0, detail: r.error };
      const actual = flatten(r.value);
      const wrong = keys.filter((k) => JSON.stringify(actual[k]) !== JSON.stringify(expected[k]));
      return { score: (keys.length - wrong.length) / keys.length, detail: wrong.length ? { wrong } : undefined };
    },
  };
}
