import { renderPrompt } from '../../core/index.js';
import type { BackendAdapter, LoadedBackend } from './types.js';
import { errorMessage } from './types.js';

/**
 * WebLLM (MLC) on WebGPU. https://github.com/mlc-ai/web-llm
 * Loaded lazily: the bundle is large and only needed when a WebLLM backend runs.
 */
const loadWebLLM = () => import('@mlc-ai/web-llm');

export const webllmAdapter: BackendAdapter = {
  kind: 'webllm',
  tasks: ['generate', 'summarize', 'write', 'rewrite', 'translate', 'classify', 'extract'],

  async availability(spec) {
    if (!spec.model) return { availability: 'unavailable', reason: 'webllm backend needs a model id' };
    if (!('gpu' in navigator)) return { availability: 'unavailable', reason: 'WebGPU is not available (navigator.gpu missing)' };
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
    if (!adapter) return { availability: 'unavailable', reason: 'navigator.gpu.requestAdapter() returned null' };
    try {
      const webllm = await loadWebLLM();
      const record = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === spec.model);
      if (!record && !spec.options?.appConfig) {
        return { availability: 'unavailable', reason: `model "${spec.model}" is not in WebLLM prebuiltAppConfig` };
      }
      // Some f16 records (e.g. gemma3-1b-it-q4f16_1) do not declare shader-f16 although they need it.
      const required = new Set(record?.required_features ?? []);
      if (/q\df16/.test(spec.model)) required.add('shader-f16');
      const missing = [...required].filter((f) => !adapter.features.has(f as GPUFeatureName));
      if (missing.length) return { availability: 'unavailable', reason: `GPU adapter lacks required features: ${missing.join(', ')}` };
      const cached = await webllm.hasModelInCache(spec.model).catch(() => false);
      return { availability: cached ? 'available' : 'downloadable' };
    } catch (err) {
      return { availability: 'unavailable', reason: errorMessage(err) };
    }
  },

  async load(spec, task, ctx): Promise<LoadedBackend> {
    const webllm = await loadWebLLM();
    const model = spec.model!;
    const engine = await webllm.CreateMLCEngine(model, {
      appConfig: spec.options?.appConfig as never,
      initProgressCallback: (report) => ctx.onProgress({ progress: report.progress, text: report.text }),
    });
    const record = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === model);
    return {
      info: {
        model,
        modelVersion: webllm.modelVersion,
        dtype: /-(q\d+f\d+(?:_\d+)?)-MLC/.exec(model)?.[1],
        device: 'webgpu',
        details: { vramRequiredMB: record?.vram_required_MB, modelLib: record?.model_lib, lowResourceRequired: record?.low_resource_required },
      },
      async run(request, rctx) {
        await engine.resetChat();
        const messages: { role: 'system' | 'user'; content: string }[] = [];
        if (request.task.system) messages.push({ role: 'system', content: request.task.system });
        messages.push({ role: 'user', content: renderPrompt(request.task, request.input) });
        const gen = { ...spec.generation, ...request.generation };
        const schema = request.input.schema ?? request.task.responseSchema;
        const onAbort = () => engine.interruptGenerate();
        rctx.signal.addEventListener('abort', onAbort, { once: true });
        try {
          const stream = await engine.chat.completions.create({
            messages,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: gen.maxTokens ?? 256,
            temperature: gen.temperature ?? 0,
            top_p: gen.topP,
            response_format: schema && spec.options?.responseFormat !== false ? { type: 'json_object', schema: JSON.stringify(schema) } : undefined,
          });
          let output = '';
          let usage: Record<string, unknown> | undefined;
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? '';
            if (delta) {
              output += delta;
              rctx.onChunk(delta);
            }
            if (chunk.usage) usage = chunk.usage as unknown as Record<string, unknown>;
          }
          return {
            output,
            outputTokens: usage?.completion_tokens as number | undefined,
            inputTokens: usage?.prompt_tokens as number | undefined,
            tokenCountSource: usage ? 'reported' : undefined,
            extra: usage?.extra ? { webllm: usage.extra } : undefined,
          };
        } finally {
          rctx.signal.removeEventListener('abort', onAbort);
        }
      },
      async dispose() {
        await engine.unload();
      },
    };
  },
};
