import { describe, expect, it } from 'vitest';
import { distribution, extractJson, matchLabel, parseJsonl, renderPrompt, resolveInput } from 'web-ai-evals';

describe('parseJsonl', () => {
  it('parses examples, skips blanks and comments, defaults ids', () => {
    const ex = parseJsonl('{"input":"a","expected":"x"}\n\n// note\n{"id":"b","input":{"text":"b"}}\n');
    expect(ex).toEqual([
      { id: '1', input: 'a', expected: 'x', meta: undefined },
      { id: 'b', input: { text: 'b' }, expected: undefined, meta: undefined },
    ]);
  });
  it('reports line numbers for bad lines and duplicate ids', () => {
    expect(() => parseJsonl('{"input":"a"}\n{oops', 'd.jsonl')).toThrow('d.jsonl:2');
    expect(() => parseJsonl('{"id":"x","input":"a"}\n{"id":"x","input":"b"}')).toThrow('duplicate id "x"');
    expect(() => parseJsonl('{"input":3}')).toThrow('"input" must be');
  });
});

describe('prompts', () => {
  it('fills task defaults and renders templates', () => {
    const task = { type: 'translate' as const, sourceLanguage: 'en', targetLanguage: 'de' };
    const input = resolveInput({ id: '1', input: 'Hello' }, task);
    expect(input).toEqual({ text: 'Hello', sourceLanguage: 'en', targetLanguage: 'de' });
    expect(renderPrompt(task, input)).toContain('from English to German');
    expect(renderPrompt({ type: 'generate', prompt: '{{text}} / {{unknown}}' }, input)).toBe('Hello / {{unknown}}');
  });
  it('matches labels in free-form answers', () => {
    const labels = ['positive', 'negative', 'neutral'];
    expect(matchLabel('Positive.', labels)).toBe('positive');
    expect(matchLabel('**negative**', labels)).toBe('negative');
    expect(matchLabel('The sentiment is neutral, not negative.', labels)).toBe('neutral');
    expect(matchLabel('no idea', labels)).toBeUndefined();
  });
  it('extracts JSON from fenced or chatty output', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Sure! {"a": {"b": 2}} Hope this helps')).toBe('{"a": {"b": 2}}');
  });
});

describe('distribution', () => {
  it('computes percentiles ignoring undefined and NaN', () => {
    const d = distribution([1, 2, 3, 4, undefined, NaN, 5])!;
    expect(d.n).toBe(5);
    expect(d.p50).toBe(3);
    expect(d.min).toBe(1);
    expect(d.max).toBe(5);
    expect(d.mean).toBe(3);
    expect(distribution([])).toBeUndefined();
  });
});
