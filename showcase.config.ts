import { defineConfig } from '@web-ai-evals/runner';
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
 */
const presets = [
  ...(process.env.WAE_FORCE_CPU ? ['force-cpu'] : []),
  ...(process.env.WAE_UNSAFE_WEBGPU ? ['unsafe-webgpu'] : []),
];

const browsers = [
  { id: 'chrome', channel: 'chrome' as const, presets },
  { id: 'edge', channel: 'msedge-dev' as const, presets },
].filter((b) => !process.env.WAE_BROWSERS || process.env.WAE_BROWSERS.split(',').includes(b.id));

const generation = { maxTokens: 256, temperature: 0 };

export default defineConfig({
  name: 'Built-in AI vs in-page runtimes',
  browsers,
  backends: [
    { id: 'gemini-nano', kind: 'prompt-api', browsers: ['chrome'] },
    { id: 'phi-4-mini', kind: 'prompt-api', browsers: ['edge'] },
    { id: 'gemma3-1b-webllm', kind: 'webllm', model: 'gemma3-1b-it-q4f16_1-MLC', generation, browsers: ['chrome'] },
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
