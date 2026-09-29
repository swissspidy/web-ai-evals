import type { Example, ExampleInput, TaskDefinition } from './types.js';

export class DatasetError extends Error {}

/** Parse a JSONL dataset. Blank lines and lines starting with `//` are skipped. */
export function parseJsonl(text: string, source = 'dataset'): Example[] {
  const examples: Example[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) return;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch (err) {
      throw new DatasetError(`${source}:${i + 1}: invalid JSON (${(err as Error).message})`);
    }
    const example = validateExample(value, `${source}:${i + 1}`, examples.length);
    if (seen.has(example.id)) throw new DatasetError(`${source}:${i + 1}: duplicate id "${example.id}"`);
    seen.add(example.id);
    examples.push(example);
  });
  return examples;
}

function validateExample(value: unknown, where: string, index: number): Example {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DatasetError(`${where}: each line must be a JSON object`);
  }
  const obj = value as Record<string, unknown>;
  const id = obj.id === undefined ? String(index + 1) : String(obj.id);
  const input = obj.input;
  if (typeof input !== 'string') {
    if (!input || typeof input !== 'object' || typeof (input as ExampleInput).text !== 'string') {
      throw new DatasetError(`${where}: "input" must be a string or an object with a string "text"`);
    }
  }
  return { id, input: input as Example['input'], expected: obj.expected, meta: obj.meta as Example['meta'] };
}

/** Normalize an example's input and fill task-level defaults (labels, languages). */
export function resolveInput(example: Example, task: TaskDefinition): ExampleInput {
  const base: ExampleInput = typeof example.input === 'string' ? { text: example.input } : { ...example.input };
  if (!base.labels && task.labels) base.labels = task.labels;
  if (!base.sourceLanguage && task.sourceLanguage) base.sourceLanguage = task.sourceLanguage;
  if (!base.targetLanguage && task.targetLanguage) base.targetLanguage = task.targetLanguage;
  if (!base.schema && task.responseSchema) base.schema = task.responseSchema;
  return base;
}
