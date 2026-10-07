import { renderPrompt } from '../../core/index.js';
import type { AvailabilityReport, BackendSpec, TaskDefinition } from '../../core/index.js';
import { errorMessage, g, pipeStream, type BackendAdapter, type LoadedBackend } from './types.js';

/**
 * Prompt API (`LanguageModel`): Gemini Nano in Chrome, Phi-4-mini in Edge.
 * https://github.com/webmachinelearning/prompt-api
 */
function coreOptions(spec: BackendSpec, task: TaskDefinition) {
  const outputLanguage =
    (spec.options?.outputLanguage as string | undefined) ??
    (task.type === 'translate' ? task.targetLanguage : undefined) ??
    'en';
  const inputLanguages = (spec.options?.inputLanguages as string[] | undefined) ?? [
    ...new Set(['en', task.sourceLanguage, outputLanguage].filter(Boolean) as string[]),
  ];
  return {
    expectedInputs: [{ type: 'text', languages: inputLanguages }],
    expectedOutputs: [{ type: 'text', languages: [outputLanguage] }],
  };
}

export const promptApiAdapter: BackendAdapter = {
  kind: 'prompt-api',
  tasks: ['generate', 'summarize', 'write', 'rewrite', 'translate', 'classify', 'extract'],

  async availability(spec, task): Promise<AvailabilityReport> {
    if (typeof g.LanguageModel === 'undefined') {
      return { availability: 'unavailable', reason: 'LanguageModel global is not defined (Prompt API not enabled)' };
    }
    try {
      const availability = await g.LanguageModel.availability(coreOptions(spec, task));
      return { availability, reason: availability === 'unavailable' ? 'LanguageModel.availability() returned "unavailable"' : undefined };
    } catch (err) {
      return { availability: 'unavailable', reason: errorMessage(err) };
    }
  },

  async load(spec, task, ctx): Promise<LoadedBackend> {
    const initialPrompts = task.system ? [{ role: 'system', content: task.system }] : undefined;
    const createOptions: Record<string, unknown> = {
      ...coreOptions(spec, task),
      ...(spec.options?.create as Record<string, unknown> | undefined),
      initialPrompts,
      signal: ctx.signal,
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', (e) => ctx.onProgress({ progress: (e as ProgressEvent).loaded }));
      },
    };
    const gen = spec.generation ?? {};
    if (gen.samplingMode) createOptions.samplingMode = gen.samplingMode;
    // topK/temperature are extension-only on the web; pass them only when explicitly requested.
    if (spec.options?.passSamplingParams && gen.temperature !== undefined) createOptions.temperature = gen.temperature;
    if (spec.options?.passSamplingParams && gen.topK !== undefined) createOptions.topK = gen.topK;

    const base = await g.LanguageModel.create(createOptions);
    const contextWindow = base.contextWindow ?? base.inputQuota;
    const measure = (s: typeof base, text: string): Promise<number> =>
      typeof s.measureContextUsage === 'function' ? s.measureContextUsage(text) : s.measureInputUsage(text);

    return {
      info: {
        details: { contextWindow, samplingMode: base.samplingMode ?? undefined, topK: base.topK, temperature: base.temperature },
      },
      async run(request, rctx) {
        // Each example gets a fresh context: clone the base session (system prompt included).
        const t = performance.now();
        const session = await base.clone({ signal: rctx.signal });
        const cloneMs = performance.now() - t;
        try {
          const prompt = renderPrompt(request.task, request.input);
          const opts: Record<string, unknown> = { signal: rctx.signal };
          const schema = request.input.schema ?? request.task.responseSchema;
          if (schema && spec.options?.responseConstraint !== false) opts.responseConstraint = schema;
          const output = await pipeStream(session.promptStreaming(prompt, opts), rctx);
          return { output, extra: { cloneMs } };
        } finally {
          session.destroy();
        }
      },
      async countTokens(text) {
        try {
          return await measure(base, text);
        } catch {
          return undefined;
        }
      },
      async dispose() {
        base.destroy();
      },
    };
  },
};
