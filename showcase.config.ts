import { defineConfig } from 'web-ai-evals';
import { allSuites } from './suites/index.ts';

/**
 * The side-by-side showcase: built-in models (Gemini Nano in Chrome,
 * Phi-4-mini in Edge) against in-page runtimes (Gemma via WebLLM, a
 * Transformers.js model on WebGPU and on Wasm), on the same suites.
 *
 * Run on a machine with a GPU:  pnpm wae run --config showcase.config.ts
 * Each backend only runs where it can; unavailable cells are reported with the reason.
 *
 * Environment switches (all optional):
 *   WAE_FORCE_CPU=1       force Chrome's on-device model onto its CPU backend
 *   WAE_UNSAFE_WEBGPU=1   enable WebGPU on Linux / software adapters
 *   WAE_BROWSERS=chrome   comma-separated subset of browser ids
 *   WAE_LIMIT=10          only the first N examples per suite (also: --limit)
 *   WAE_WEBLLM_DIAG=1     WebLLM Gemma 3 diagnostics: logprobs and a Gemma 2 control
 */
const presets = [
  ...(process.env.WAE_FORCE_CPU ? ['force-cpu'] : []),
  ...(process.env.WAE_UNSAFE_WEBGPU ? ['unsafe-webgpu'] : []),
];

const browsers = [
  { id: 'chrome', channel: 'chrome' as const, presets },
  { id: 'edge', channel: 'msedge-dev' as const, presets },
  // Same Chrome with chrome://flags/#gemma4-for-built-in-ai on, in its own profile, so the
  // built-in APIs run Gemma 4 instead of Gemini Nano. Needs a GPU (see docs/browser-automation.md).
  { id: 'chrome-gemma4', channel: 'chrome' as const, presets: [...presets, 'gemma4'] },
].filter((b) => !process.env.WAE_BROWSERS || process.env.WAE_BROWSERS.split(',').includes(b.id));

const generation = { maxTokens: 256, temperature: 0 };
// WAE_WEBLLM_DIAG=1 records each answer's first tokens with their top-5 alternatives. WebLLM
// computes those after temperature, so diagnostics decode at temperature 1 with top_p at its
// 1e-5 minimum: still the most likely token every step, but with real probabilities.
const webllmDiag = process.env.WAE_WEBLLM_DIAG ? { logprobs: 5 } : {};
const webllmGeneration = process.env.WAE_WEBLLM_DIAG ? { ...generation, temperature: 1, topP: 1e-5 } : generation;

export default defineConfig({
  name: 'Built-in AI vs in-page runtimes',
  browsers,
  backends: [
    { id: 'gemini-nano', kind: 'prompt-api', browsers: ['chrome'] },
    { id: 'phi-4-mini', kind: 'prompt-api', browsers: ['edge'] },
    { id: 'gemma4-builtin', kind: 'prompt-api', browsers: ['chrome-gemma4'] },
    // WebLLM 0.2.85's record for this model sets a 4096-token context window while the model's own
    // config also sets a 512-token sliding window, and WebLLM refuses both ("Only one of
    // context_window_size and sliding_window_size can be positive"), so turn the sliding window off.
    // Prompts here are under 1k tokens. Keeping the sliding window (attention_sink_size: 0) or
    // using 1k prefill chunks gives the same answers (docs/browser-automation.md).
    {
      id: 'gemma3-1b-webllm',
      kind: 'webllm',
      model: 'gemma3-1b-it-q4f16_1-MLC',
      options: { chatOpts: { sliding_window_size: -1 }, ...webllmDiag },
      generation: webllmGeneration,
      browsers: ['chrome'],
    },
    // With WAE_WEBLLM_DIAG=1: Gemma 2 2B on WebLLM as a control (same chat format, older build).
    ...(process.env.WAE_WEBLLM_DIAG
      ? [
          {
            id: 'gemma2-2b-webllm',
            kind: 'webllm' as const,
            model: 'gemma-2-2b-it-q4f16_1-MLC',
            options: webllmDiag,
            generation: webllmGeneration,
            browsers: ['chrome'],
          },
        ]
      : []),
    {
      id: 'gemma3-1b-tjs-webgpu',
      kind: 'transformers',
      model: 'onnx-community/gemma-3-1b-it-ONNX-GQA',
      device: 'webgpu',
      dtype: 'q4f16',
      generation,
      browsers: ['chrome'],
    },
    // Gemma 3's q4 ONNX export uses GatherBlockQuantized, which ONNX Runtime Web's Wasm
    // backend does not implement, so the CPU (Wasm) comparison uses Qwen2.5-0.5B.
    {
      id: 'qwen2.5-0.5b-tjs-wasm',
      kind: 'transformers',
      model: 'onnx-community/Qwen2.5-0.5B-Instruct',
      device: 'wasm',
      dtype: 'q4',
      generation,
      browsers: ['chrome'],
    },
    // Chrome's task APIs, on the suites they support (others are skipped).
    { id: 'chrome-summarizer', kind: 'summarizer', browsers: ['chrome'] },
    // tl;dr mode (the suite default) returned long Markdown articles on Chrome 154's CPU
    // backend; key-points mode is measured separately.
    { id: 'chrome-summarizer-keypoints', kind: 'summarizer', options: { create: { type: 'key-points' } }, browsers: ['chrome'] },
    { id: 'chrome-translator', kind: 'translator', browsers: ['chrome'] },
  ],
  suites: allSuites.map((s) => ({ ...s, limit: process.env.WAE_LIMIT ? Number(process.env.WAE_LIMIT) : undefined })),
  run: { timeoutMs: 180_000, retries: 1 },
});
