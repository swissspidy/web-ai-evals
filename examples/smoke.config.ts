import { defineConfig } from '@web-ai-evals/runner';
import { extraction, sentiment } from '../suites/index.ts';

/**
 * Smoke test: the deterministic mock backend in Playwright's bundled Chromium,
 * headless. Runs anywhere (CI included) and exercises the whole pipeline.
 */
export default defineConfig({
  name: 'smoke',
  browsers: [{ id: 'chromium', channel: 'chromium', headless: true, proxy: false }],
  backends: [
    { id: 'mock', kind: 'mock', options: { delayMs: 1 } },
    { id: 'mock-unavailable', kind: 'mock', options: { unavailable: true } },
  ],
  suites: [{ ...sentiment, limit: 12 }, { ...extraction, limit: 5 }],
  run: { outDir: '../results/smoke', timeoutMs: 10_000, retries: 0 },
});
