import { describe, expect, it } from 'vitest';
import type { Example, TaskDefinition } from '@web-ai-evals/core';
import { chrF, classification, contains, exactMatch, jsonFieldMatch, jsonSchema, jsonValid, rougeL } from '@web-ai-evals/scorers';

const task: TaskDefinition = { type: 'generate' };
const ctx = (output: string, expected: unknown, extra: Partial<Example> = {}) => {
  const example: Example = { id: '1', input: 'x', expected, ...extra };
  return { example, input: { text: 'x' }, task, output };
};
const val = async (r: unknown) => (typeof r === 'number' ? r : (r as { score: number }).score);

describe('text scorers', () => {
  it('exact and contains normalize case and punctuation', async () => {
    expect(await val(exactMatch().score(ctx('Berlin!', 'berlin')))).toBe(1);
    expect(await val(exactMatch().score(ctx('Berlin, Germany', 'berlin')))).toBe(0);
    expect(await val(contains().score(ctx('It is Berlin, Germany', ['Munich', 'berlin'])))).toBe(1);
  });
  it('rougeL is 1 for identical text and between 0 and 1 otherwise', async () => {
    expect(await val(rougeL().score(ctx('the cat sat on the mat', 'the cat sat on the mat')))).toBeCloseTo(1);
    const partial = await val(rougeL().score(ctx('the cat sat', 'the cat sat on the mat')));
    expect(partial).toBeGreaterThan(0.5);
    expect(partial).toBeLessThan(1);
  });
  it('chrF rewards close translations', async () => {
    const same = await val(chrF().score(ctx('Das Museum ist montags geschlossen.', 'Das Museum ist montags geschlossen.')));
    const close = await val(chrF().score(ctx('Das Museum ist am Montag geschlossen.', 'Das Museum ist montags geschlossen.')));
    const far = await val(chrF().score(ctx('Ich mag Äpfel.', 'Das Museum ist montags geschlossen.')));
    expect(same).toBeCloseTo(1);
    expect(close).toBeGreaterThan(far);
  });
});

describe('json scorers', () => {
  const schema = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] };
  it('validates JSON and schemas, tolerating code fences', async () => {
    expect(await val(jsonValid().score(ctx('```json\n{"n":1}\n```', undefined)))).toBe(1);
    expect(await val(jsonValid({ strict: true }).score(ctx('```json\n{"n":1}\n```', undefined)))).toBe(0);
    expect(await val(jsonSchema(schema).score(ctx('{"n": 2}', undefined)))).toBe(1);
    expect(await val(jsonSchema(schema).score(ctx('{"n": "2"}', undefined)))).toBe(0);
  });
  it('scores field-level matches', async () => {
    const expected = { name: 'Ana', guests: 2, city: 'Porto' };
    expect(await val(jsonFieldMatch().score(ctx('{"name":"ana","guests":2,"city":"Lisbon"}', expected)))).toBeCloseTo(2 / 3);
    expect(await val(jsonFieldMatch().score(ctx('not json', expected)))).toBe(0);
  });
});

describe('classification', () => {
  it('computes accuracy per example and macro F1 in aggregate', async () => {
    const scorer = classification({ labels: ['a', 'b'] });
    expect(await val(scorer.score(ctx('A.', 'a')))).toBe(1);
    const items = [
      { gold: 'a', out: 'a' },
      { gold: 'a', out: 'b' },
      { gold: 'b', out: 'b' },
      { gold: 'b', out: undefined },
    ].map(({ gold, out }, i) => ({ example: { id: String(i), input: 'x', expected: gold }, input: { text: 'x' }, output: out, score: undefined }));
    const agg = scorer.aggregate!(items);
    // a: P=1 R=.5 F1=.667; b: P=.5 R=.5 F1=.5
    expect(agg.macroF1).toBeCloseTo((2 / 3 + 0.5) / 2);
    expect(agg.invalidLabelRate).toBeCloseTo(0.25);
  });
});
