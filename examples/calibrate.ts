/**
 * Programmatic use: pick the best backend on *this* device from a small
 * labeled calibration set. This is the shape of a calibration step for tools
 * like Belay: open one browser session, try candidate backends, measure
 * quality and latency, return a choice.
 *
 *   node examples/calibrate.ts
 */
import { parseJsonl, resolveInput, type BackendSpec, type TaskDefinition } from '@web-ai-evals/core';
import { BrowserSession } from '@web-ai-evals/runner';
import { classification } from '@web-ai-evals/scorers';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const task: TaskDefinition = { type: 'classify', labels: ['positive', 'negative', 'neutral'] };
const candidates: BackendSpec[] = [
  { id: 'gemini-nano', kind: 'prompt-api' },
  { id: 'gemma3-1b-webllm', kind: 'webllm', model: 'gemma3-1b-it-q4f16_1-MLC', generation: { maxTokens: 8 } },
  { id: 'qwen-wasm', kind: 'transformers', model: 'onnx-community/Qwen2.5-0.5B-Instruct', device: 'wasm', dtype: 'q4', generation: { maxTokens: 8 } },
];
const examples = parseJsonl(await readFile(new URL('../suites/sentiment/data.jsonl', import.meta.url), 'utf8')).slice(0, 12);
const scorer = classification();

const session = await BrowserSession.open({
  browser: { id: 'chrome', channel: 'chrome', presets: process.env.WAE_FORCE_CPU ? ['force-cpu'] : [] },
  profilesDir: path.join(os.homedir(), '.cache', 'web-ai-evals', 'profiles'),
});
try {
  const results = [];
  for (const spec of candidates) {
    const load = await session.load(spec, task);
    if (load.status !== 'ok') {
      results.push({ id: spec.id, available: false, reason: load.error });
      continue;
    }
    let correct = 0;
    const latencies: number[] = [];
    for (const example of examples) {
      const input = resolveInput(example, task);
      const res = await session.run({ exampleId: example.id, task, input }, { timeoutMs: 60_000 });
      if (res.status !== 'ok') continue;
      const s = await scorer.score({ example, input, task, output: res.output ?? '' });
      correct += typeof s === 'number' ? s : s.score;
      latencies.push(res.timings.totalMs);
    }
    latencies.sort((a, b) => a - b);
    results.push({ id: spec.id, available: true, accuracy: correct / examples.length, p50Ms: latencies[Math.floor(latencies.length / 2)], loadMs: load.loadMs });
    await session.unload();
  }
  console.table(results);
  // Example policy: the most accurate backend whose median latency is under 3 s.
  const best = results.filter((r) => r.available && (r.p50Ms ?? Infinity) < 3000).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0];
  console.log(best ? `choose ${best.id}` : 'no backend meets the latency budget');
} finally {
  await session.close();
}
