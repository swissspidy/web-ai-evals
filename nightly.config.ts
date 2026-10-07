import { defineConfig } from 'web-ai-evals';
import { extraction, sentiment, summarization } from './suites/index.ts';

/**
 * Nightly drift check for Chrome's built-in model across channels. Kept small
 * so it finishes in a few minutes on a self-hosted machine.
 *
 *   web-ai-evals nightly --config nightly.config.ts --history ~/wae-history --fail-on-flags
 *
 * WAE_CHANNELS overrides the channel list (comma-separated Playwright channels).
 */
const channels = (process.env.WAE_CHANNELS ?? 'chrome,chrome-beta,chrome-canary').split(',') as Array<
  'chrome' | 'chrome-beta' | 'chrome-dev' | 'chrome-canary'
>;
const presets = process.env.WAE_FORCE_CPU ? ['force-cpu'] : [];

export default defineConfig({
  name: 'nightly-built-in',
  browsers: channels.map((channel) => ({ id: channel, channel, presets })),
  backends: [
    { id: 'prompt-api', kind: 'prompt-api' },
    { id: 'summarizer', kind: 'summarizer' },
  ],
  suites: [
    { ...sentiment, limit: 30, backends: ['prompt-api'] },
    { ...extraction, limit: 10, backends: ['prompt-api'] },
    { ...summarization, limit: 6 },
  ],
  run: { timeoutMs: 120_000, retries: 1 },
});
