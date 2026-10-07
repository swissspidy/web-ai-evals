import { matchLabel } from '../../core/index.js';
import type { BackendAdapter } from './types.js';

/**
 * Deterministic backend for tests and dry runs. Streams words with a fixed
 * delay. Classification picks the first label mentioned in the text;
 * everything else echoes the input (or `options.output`).
 */
export const mockAdapter: BackendAdapter = {
  kind: 'mock',
  tasks: ['generate', 'summarize', 'write', 'rewrite', 'translate', 'classify', 'extract'],
  async availability(spec) {
    if (spec.options?.unavailable) return { availability: 'unavailable', reason: 'mock configured as unavailable' };
    return { availability: 'available' };
  },
  async load(spec, _task, ctx) {
    // Simulate a backend that fails its first loads, e.g. while a model is still installing.
    const failLoads = Number(spec.options?.failLoads ?? 0);
    const attempt = (loadAttempts.get(spec.id) ?? 0) + 1;
    loadAttempts.set(spec.id, attempt);
    if (attempt <= failLoads) throw new Error(String(spec.options?.loadError ?? 'mock load failure'));
    const loadDelay = Number(spec.options?.loadDelayMs ?? 0);
    for (let i = 1; i <= 4; i++) {
      await sleep(loadDelay / 4, ctx.signal);
      ctx.onProgress({ progress: i / 4 });
    }
    const delay = Number(spec.options?.delayMs ?? 2);
    return {
      info: { model: spec.model ?? 'mock', details: { delayMs: delay } },
      async run(request, rctx) {
        if (spec.options?.failOn && (spec.options.failOn as string[]).includes(request.exampleId)) {
          throw new Error(`mock failure for ${request.exampleId}`);
        }
        if (spec.options?.hangOn && (spec.options.hangOn as string[]).includes(request.exampleId)) {
          await sleep(1e9, rctx.signal);
        }
        const { input } = request;
        let output: string;
        if (request.task.type === 'classify') {
          output = matchLabel(input.text, input.labels ?? []) ?? input.labels?.[0] ?? '';
        } else {
          output = (spec.options?.output as string | undefined) ?? input.text;
        }
        const words = output.split(/(?<=\s)/);
        for (const w of words) {
          await sleep(delay, rctx.signal);
          rctx.onChunk(w);
        }
        return { output, outputTokens: words.length, tokenCountSource: 'reported' };
      },
      async dispose() {},
    };
  },
};

const loadAttempts = new Map<string, number>();

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });
}
