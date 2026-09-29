import { distribution, mean, resolveInput, type CellSummary, type Example, type ExampleResult, type TaskDefinition } from '@web-ai-evals/core';
import type { Scorer } from '@web-ai-evals/scorers';

/** Score results in place. Scorer exceptions are recorded, not thrown. */
export async function scoreResults(
  results: ExampleResult[],
  examples: Map<string, Example>,
  task: TaskDefinition,
  scorers: Scorer[],
): Promise<void> {
  for (const r of results) {
    r.scores = {};
    r.scoreDetails = undefined;
    if (r.status !== 'ok' || r.output === undefined) continue;
    const example = examples.get(r.exampleId);
    if (!example) continue;
    const input = resolveInput(example, task);
    for (const scorer of scorers) {
      try {
        const res = await scorer.score({ example, input, task, output: r.output });
        if (typeof res === 'number') r.scores[scorer.name] = res;
        else {
          r.scores[scorer.name] = res.score;
          if (res.detail !== undefined) (r.scoreDetails ??= {})[scorer.name] = res.detail;
        }
      } catch (err) {
        (r.scoreDetails ??= {})[scorer.name] = { error: (err as Error).message };
      }
    }
  }
}

/**
 * Summaries count failed examples (error/timeout) as 0 for every scorer, so a
 * backend cannot look better by failing hard examples. A cell that is entirely
 * unavailable has no scores.
 */
export function summarize(
  results: ExampleResult[],
  examples: Map<string, Example>,
  task: TaskDefinition,
  scorers: Scorer[],
): CellSummary {
  const count = (s: ExampleResult['status']) => results.filter((r) => r.status === s).length;
  const attempted = results.filter((r) => r.status !== 'unavailable');
  const scores: Record<string, number> = {};
  const aggregates: Record<string, number> = {};
  if (attempted.length) {
    for (const scorer of scorers) {
      const values = attempted.map((r) => r.scores[scorer.name] ?? 0);
      scores[scorer.name] = mean(values);
      if (scorer.aggregate) {
        // Aggregate over the first repeat so multiple repeats do not skew label counts.
        const firstRepeat = attempted.filter((r) => r.repeat === 1);
        const items = firstRepeat.flatMap((r) => {
          const example = examples.get(r.exampleId);
          if (!example) return [];
          return [{ example, input: resolveInput(example, task), output: r.status === 'ok' ? r.output : undefined, score: r.scores[scorer.name] }];
        });
        try {
          for (const [k, v] of Object.entries(scorer.aggregate(items))) aggregates[`${scorer.name}.${k}`] = v;
        } catch {
          /* aggregate errors leave the aggregate out */
        }
      }
    }
  }
  const ok = results.filter((r) => r.status === 'ok');
  const warm = ok.filter((r) => r.phase === 'warm');
  return {
    total: results.length,
    ok: ok.length,
    errors: count('error'),
    timeouts: count('timeout'),
    unavailable: count('unavailable'),
    scores,
    aggregates,
    ttftMs: distribution(ok.map((r) => r.timings.ttftMs)),
    totalMs: distribution(ok.map((r) => r.timings.totalMs)),
    tokensPerSecond: distribution(ok.map((r) => r.timings.tokensPerSecond)),
    warm: {
      ttftMs: distribution(warm.map((r) => r.timings.ttftMs)),
      totalMs: distribution(warm.map((r) => r.timings.totalMs)),
      tokensPerSecond: distribution(warm.map((r) => r.timings.tokensPerSecond)),
    },
  };
}
