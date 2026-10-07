import { matchLabel, renderPrompt } from '../../core/index.js';
import type { BackendAdapter, LoadedBackend } from './types.js';
import { errorMessage } from './types.js';

/**
 * Transformers.js (ONNX Runtime Web) on WebGPU or Wasm.
 * https://huggingface.co/docs/transformers.js
 *
 * `options.pipeline` selects the pipeline: 'text-generation' (default, chat
 * models), 'summarization', 'translation', 'text2text-generation' or
 * 'zero-shot-classification'.
 */
const loadTransformers = async () => {
  const t = await import('@huggingface/transformers');
  // Serve ONNX Runtime's Wasm from the runner's origin instead of a CDN, when present.
  const local = new URL('./ort/', document.baseURI).href;
  const probe = await fetch(`${local}ort-wasm-simd-threaded.asyncify.wasm`, { method: 'HEAD' }).catch(() => null);
  const wasm = t.env.backends.onnx.wasm;
  if (probe?.ok && wasm) {
    wasm.wasmPaths = {
      mjs: `${local}ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${local}ort-wasm-simd-threaded.asyncify.wasm`,
    };
  }
  return t;
};

const CACHE_NAME = 'transformers-cache';

async function isCached(model: string): Promise<boolean> {
  try {
    if (!(await caches.has(CACHE_NAME))) return false;
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return keys.some((req) => req.url.includes(`/${model}/`) && /\.onnx(_data)?$/.test(new URL(req.url).pathname));
  } catch {
    return false;
  }
}

export const transformersAdapter: BackendAdapter = {
  kind: 'transformers',
  tasks: ['generate', 'summarize', 'write', 'rewrite', 'translate', 'classify', 'extract'],

  async availability(spec) {
    if (!spec.model) return { availability: 'unavailable', reason: 'transformers backend needs a model id' };
    const device = spec.device ?? 'webgpu';
    if (device === 'webgpu') {
      if (!('gpu' in navigator)) return { availability: 'unavailable', reason: 'WebGPU is not available (navigator.gpu missing)' };
      const adapter = await navigator.gpu.requestAdapter().catch(() => null);
      if (!adapter) return { availability: 'unavailable', reason: 'navigator.gpu.requestAdapter() returned null' };
      if (spec.dtype?.includes('f16') && !adapter.features.has('shader-f16')) {
        return { availability: 'unavailable', reason: `dtype ${spec.dtype} needs the shader-f16 GPU feature` };
      }
    }
    if (device === 'webnn' && !('ml' in navigator)) return { availability: 'unavailable', reason: 'WebNN is not available' };
    return { availability: (await isCached(spec.model)) ? 'available' : 'downloadable' };
  },

  async load(spec, _task, ctx): Promise<LoadedBackend> {
    const t = await loadTransformers();
    const kind = (spec.options?.pipeline as string | undefined) ?? 'text-generation';
    const pipe = await (t.pipeline as (...args: unknown[]) => Promise<any>)(kind, spec.model, {
      device: spec.device ?? 'webgpu',
      dtype: spec.dtype ?? 'q4',
      ...(spec.options?.pipelineOptions as Record<string, unknown> | undefined),
      // 'progress_total' aggregates all files; per-file 'progress' events would hit 100% on small files first.
      progress_callback: (p: { status: string; progress?: number; loaded?: number; total?: number; name?: string }) => {
        if (p.status !== 'progress_total' || p.progress === undefined) return;
        ctx.onProgress({ progress: p.progress / 100, loadedBytes: p.loaded, totalBytes: p.total, file: p.name });
      },
    });
    const tokenizer = pipe.tokenizer;
    const countTokens = async (text: string) => {
      try {
        return tokenizer ? (tokenizer.encode(text) as number[]).length : undefined;
      } catch {
        return undefined;
      }
    };

    return {
      info: { model: spec.model, dtype: spec.dtype ?? 'q4', device: spec.device ?? 'webgpu', details: { pipeline: kind, transformersVersion: t.env.version } },
      countTokens,
      async run(request, rctx) {
        const gen = { ...spec.generation, ...request.generation };
        const { input, task } = request;

        if (kind === 'zero-shot-classification') {
          const labels = input.labels ?? task.labels ?? [];
          const res = await pipe(input.text, labels);
          return { output: res.labels[0], extra: { scores: Object.fromEntries(res.labels.map((l: string, i: number) => [l, res.scores[i]])) } };
        }

        let tokens = 0;
        const streamer = tokenizer
          ? new t.TextStreamer(tokenizer, {
              skip_prompt: true,
              skip_special_tokens: true,
              callback_function: (text: string) => rctx.onChunk(text),
              token_callback_function: () => {
                tokens++;
              },
            })
          : undefined;
        const stopping = new t.InterruptableStoppingCriteria();
        const onAbort = () => stopping.interrupt();
        rctx.signal.addEventListener('abort', onAbort, { once: true });
        const genOptions: Record<string, unknown> = {
          max_new_tokens: gen.maxTokens ?? 256,
          do_sample: (gen.temperature ?? 0) > 0,
          temperature: gen.temperature,
          top_k: gen.topK,
          streamer,
          stopping_criteria: stopping,
        };
        try {
          let output: string;
          if (kind === 'text-generation') {
            const messages = [
              ...(task.system ? [{ role: 'system', content: task.system }] : []),
              { role: 'user', content: renderPrompt(task, input) },
            ];
            const res = await pipe(messages, genOptions);
            const generated = res[0].generated_text;
            output = Array.isArray(generated) ? generated.at(-1).content : String(generated);
          } else if (kind === 'translation') {
            const res = await pipe(input.text, { ...genOptions, src_lang: input.sourceLanguage, tgt_lang: input.targetLanguage });
            output = res[0].translation_text;
          } else if (kind === 'summarization') {
            const res = await pipe(input.text, genOptions);
            output = res[0].summary_text;
          } else {
            const res = await pipe(renderPrompt(task, input), genOptions);
            output = res[0].generated_text;
          }
          if (task.type === 'classify' && input.labels) output = matchLabel(output, input.labels) ?? output;
          // The token callback counts every generated token, EOS included.
          return { output, outputTokens: tokens || undefined, tokenCountSource: tokens ? 'reported' : undefined };
        } finally {
          rctx.signal.removeEventListener('abort', onAbort);
        }
      },
      async dispose() {
        await pipe.dispose?.();
      },
    };
  },
};

export { errorMessage };
