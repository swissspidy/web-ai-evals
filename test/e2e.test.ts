import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunFile } from '@web-ai-evals/core';
import { classification } from '@web-ai-evals/scorers';
import { resolveConfig, runEvals } from '@web-ai-evals/runner';

/**
 * End-to-end: the real runner, server, page runtime and Playwright Chromium
 * (headless), with the deterministic mock backend. Set WAE_CHROMIUM_EXECUTABLE
 * when Playwright's bundled browser is not installed at the expected path.
 */
describe('runner e2e (mock backend)', () => {
  it('runs a suite, handles errors, timeouts and unavailability, and writes a run file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-e2e-'));
    const config = resolveConfig(
      {
        name: 'e2e',
        browsers: [{ id: 'chromium', channel: 'chromium', headless: true, proxy: false }],
        backends: [
          { id: 'mock', kind: 'mock', options: { delayMs: 1, failOn: ['s002'], hangOn: ['s003'] } },
          { id: 'off', kind: 'mock', options: { unavailable: true } },
        ],
        suites: [
          {
            id: 'sentiment',
            dataset: path.resolve('suites/sentiment/data.jsonl'),
            limit: 6,
            task: { type: 'classify', labels: ['positive', 'negative', 'neutral'] },
            scorers: [classification()],
          },
        ],
        run: { outDir: dir, profilesDir: path.join(dir, 'profiles'), port: 0, timeoutMs: 1500, retries: 1 },
      },
      process.cwd(),
    );
    const { run, file } = await runEvals(config, { log: () => {} });
    const saved = JSON.parse(await readFile(file, 'utf8')) as RunFile;
    expect(saved.runId).toBe(run.runId);
    expect(run.cells.map((c) => c.key)).toEqual(['sentiment/mock/chromium', 'sentiment/off/chromium']);

    const mock = run.cells[0];
    expect(mock.load.status).toBe('ok');
    expect(mock.summary.total).toBe(6);
    const byId = Object.fromEntries(mock.results.map((r) => [r.exampleId, r]));
    expect(byId.s001.status).toBe('ok');
    expect(byId.s001.phase).toBe('cold');
    expect(byId.s004.phase).toBe('warm');
    expect(byId.s001.timings.ttftMs).toBeGreaterThanOrEqual(0);
    expect(byId.s002).toMatchObject({ status: 'error', attempts: 2 });
    expect(byId.s003).toMatchObject({ status: 'timeout', attempts: 2 });
    // Examples after a timeout still run.
    expect(byId.s004.status).toBe('ok');
    expect(mock.environment.browser.version).toMatch(/^\d+\./);
    expect(mock.environment.crossOriginIsolated).toBe(true);
    expect(mock.summary.errors).toBe(1);
    expect(mock.summary.timeouts).toBe(1);

    const off = run.cells[1];
    expect(off.load.status).toBe('unavailable');
    expect(off.summary.unavailable).toBe(6);
    expect(off.summary.scores).toEqual({});
  });
});
