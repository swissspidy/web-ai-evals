import type { AvailabilityReport, BackendKind, BackendSpec, TaskDefinition, TaskType } from '@web-ai-evals/core';
import { errorMessage, g, pipeStream, type BackendAdapter, type LoadedBackend } from './types.js';

/**
 * Writing assistance APIs (Summarizer, Writer, Rewriter).
 * https://github.com/webmachinelearning/writing-assistance-apis
 */
interface WritingApi {
  kind: BackendKind;
  global: string;
  task: TaskType;
  stream: string;
}

const WRITING_APIS: WritingApi[] = [
  { kind: 'summarizer', global: 'Summarizer', task: 'summarize', stream: 'summarizeStreaming' },
  { kind: 'writer', global: 'Writer', task: 'write', stream: 'writeStreaming' },
  { kind: 'rewriter', global: 'Rewriter', task: 'rewrite', stream: 'rewriteStreaming' },
];

function writingOptions(spec: BackendSpec, task: TaskDefinition): Record<string, unknown> {
  const outputLanguage = (spec.options?.outputLanguage as string | undefined) ?? 'en';
  return {
    expectedInputLanguages: (spec.options?.inputLanguages as string[] | undefined) ?? ['en'],
    outputLanguage,
    ...task.apiOptions,
    ...(spec.options?.create as Record<string, unknown> | undefined),
  };
}

function makeWritingAdapter(api: WritingApi): BackendAdapter {
  return {
    kind: api.kind,
    tasks: [api.task],
    async availability(spec, task): Promise<AvailabilityReport> {
      const ctor = g[api.global];
      if (typeof ctor === 'undefined') return { availability: 'unavailable', reason: `${api.global} global is not defined` };
      try {
        return { availability: await ctor.availability(writingOptions(spec, task)) };
      } catch (err) {
        return { availability: 'unavailable', reason: errorMessage(err) };
      }
    },
    async load(spec, task, ctx): Promise<LoadedBackend> {
      const instance = await g[api.global].create({
        ...writingOptions(spec, task),
        signal: ctx.signal,
        monitor(m: EventTarget) {
          m.addEventListener('downloadprogress', (e) => ctx.onProgress({ progress: (e as ProgressEvent).loaded }));
        },
      });
      return {
        info: { details: { inputQuota: instance.inputQuota, ...writingOptions(spec, task) } },
        async run(request, rctx) {
          const opts: Record<string, unknown> = { signal: rctx.signal };
          if (request.input.context) opts.context = request.input.context;
          const output = await pipeStream(instance[api.stream](request.input.text, opts), rctx);
          return { output };
        },
        async countTokens(text) {
          try {
            return await instance.measureInputUsage(text);
          } catch {
            return undefined;
          }
        },
        async dispose() {
          instance.destroy();
        },
      };
    },
  };
}

export const summarizerAdapter = makeWritingAdapter(WRITING_APIS[0]);
export const writerAdapter = makeWritingAdapter(WRITING_APIS[1]);
export const rewriterAdapter = makeWritingAdapter(WRITING_APIS[2]);

/**
 * Translator API. One translator per language pair, created lazily and cached.
 * https://github.com/webmachinelearning/translation-api
 */
export const translatorAdapter: BackendAdapter = {
  kind: 'translator',
  tasks: ['translate'],
  async availability(_spec, task) {
    if (typeof g.Translator === 'undefined') return { availability: 'unavailable', reason: 'Translator global is not defined' };
    if (!task.sourceLanguage || !task.targetLanguage) {
      return { availability: 'unavailable', reason: 'translate task needs sourceLanguage and targetLanguage' };
    }
    try {
      return { availability: await g.Translator.availability({ sourceLanguage: task.sourceLanguage, targetLanguage: task.targetLanguage }) };
    } catch (err) {
      return { availability: 'unavailable', reason: errorMessage(err) };
    }
  },
  async load(_spec, task, ctx) {
    const translators = new Map<string, Promise<any>>();
    const get = (source: string, target: string) => {
      const key = `${source}>${target}`;
      if (!translators.has(key)) {
        const created: Promise<any> = g.Translator.create({
          sourceLanguage: source,
          targetLanguage: target,
          monitor(m: EventTarget) {
            m.addEventListener('downloadprogress', (e) => ctx.onProgress({ progress: (e as ProgressEvent).loaded }));
          },
        });
        // A failed create() must not poison later examples (or retries) for this pair.
        created.catch(() => translators.delete(key));
        translators.set(key, created);
      }
      return translators.get(key)!;
    };
    if (task.sourceLanguage && task.targetLanguage) await get(task.sourceLanguage, task.targetLanguage);
    return {
      info: { details: { sourceLanguage: task.sourceLanguage, targetLanguage: task.targetLanguage } },
      async run(request, rctx) {
        const { sourceLanguage, targetLanguage } = request.input;
        if (!sourceLanguage || !targetLanguage) throw new Error('translate example needs sourceLanguage and targetLanguage');
        const translator = await get(sourceLanguage, targetLanguage);
        const output = await pipeStream(translator.translateStreaming(request.input.text, { signal: rctx.signal }), rctx);
        return { output };
      },
      async dispose() {
        for (const t of translators.values()) (await t.catch(() => undefined))?.destroy?.();
      },
    };
  },
};

/**
 * Classifier API, as implemented by the WebAI Studio extension polyfill
 * (https://github.com/michaelwasserman/classifier-api shape). Chrome has no
 * native implementation as of Chrome 154.
 */
export const classifierAdapter: BackendAdapter = {
  kind: 'classifier',
  tasks: ['classify'],
  async availability(spec, task) {
    if (typeof g.Classifier === 'undefined') {
      return { availability: 'unavailable', reason: 'Classifier global is not defined (install the WebAI Studio extension in the profile)' };
    }
    try {
      return { availability: await g.Classifier.availability(classifierOptions(spec, task)) };
    } catch (err) {
      return { availability: 'unavailable', reason: errorMessage(err) };
    }
  },
  async load(spec, task, ctx) {
    const classifier = await g.Classifier.create({
      ...classifierOptions(spec, task),
      signal: ctx.signal,
      monitor(m: EventTarget) {
        m.addEventListener('downloadprogress', (e) => ctx.onProgress({ progress: (e as ProgressEvent).loaded }));
      },
    });
    return {
      info: { details: { contextWindow: classifier.contextWindow } },
      async run(request, rctx) {
        const result = await classifier.classify(request.input.text, { signal: rctx.signal });
        const answer = result?.label;
        return { output: answer?.label ?? '', extra: { confidence: answer?.confidence, probabilities: answer?.probabilities } };
      },
      async dispose() {
        classifier.destroy?.();
      },
    };
  },
};

function classifierOptions(spec: BackendSpec, task: TaskDefinition) {
  return {
    questions: [
      {
        id: 'label',
        type: 'categorical',
        prompt: (spec.options?.question as string | undefined) ?? 'Which label best describes the text?',
        options: (task.labels ?? []).map((label) => ({ label })),
      },
    ],
    ...(spec.options?.create as Record<string, unknown> | undefined),
  };
}
