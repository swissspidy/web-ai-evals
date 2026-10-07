import { defineConfig } from 'web-ai-evals';
import { sentiment } from './suites/index.ts';

/**
 * Milestone 1: the sentiment suite on the Prompt API (Gemini Nano) in
 * Playwright-launched Google Chrome with a persistent profile.
 *
 * On machines without a supported GPU, set WAE_FORCE_CPU=1 to force the
 * on-device model's CPU backend (needs >= 16 GB RAM and >= 4 cores).
 */
export default defineConfig({
  name: 'Milestone 1: Prompt API sentiment',
  browsers: [
    {
      id: 'chrome',
      channel: 'chrome',
      headless: false,
      presets: process.env.WAE_FORCE_CPU ? ['force-cpu'] : [],
    },
  ],
  backends: [{ id: 'gemini-nano', kind: 'prompt-api' }],
  suites: [sentiment],
  run: { timeoutMs: 120_000, retries: 1 },
});
