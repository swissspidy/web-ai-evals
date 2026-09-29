import type { BackendKind } from '@web-ai-evals/core';
import { mockAdapter } from './mock.js';
import { promptApiAdapter } from './prompt-api.js';
import { classifierAdapter, rewriterAdapter, summarizerAdapter, translatorAdapter, writerAdapter } from './task-apis.js';
import { transformersAdapter } from './transformers.js';
import type { BackendAdapter } from './types.js';
import { webllmAdapter } from './webllm.js';

export const adapters: Record<BackendKind, BackendAdapter> = {
  'prompt-api': promptApiAdapter,
  summarizer: summarizerAdapter,
  writer: writerAdapter,
  rewriter: rewriterAdapter,
  translator: translatorAdapter,
  classifier: classifierAdapter,
  webllm: webllmAdapter,
  transformers: transformersAdapter,
  mock: mockAdapter,
};

export type { BackendAdapter, LoadedBackend } from './types.js';
