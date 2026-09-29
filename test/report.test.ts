import { describe, expect, it } from 'vitest';
import type { CellResult, RunFile } from '@web-ai-evals/core';
import { diffRuns, renderDiff, renderMarkdown, renderReport } from '@web-ai-evals/report';

function cell(browser: string, version: string, modelVersion: string, accuracy: number, ttft: number, output = 'positive'): CellResult {
  const dist = (v: number) => ({ n: 1, mean: v, p50: v, p90: v, p95: v, min: v, max: v });
  return {
    key: `sentiment/nano/${browser}`,
    dataset: { id: 'sentiment', sha256: 'abc', examples: 1 },
    task: { type: 'classify', labels: ['positive', 'negative'] },
    backend: { id: 'nano', kind: 'prompt-api' },
    environment: {
      browser: { id: browser, name: 'Google Chrome', channel: browser, version, userAgent: 'ua', headless: false },
      os: { platform: 'linux', release: '6', arch: 'x64' },
      hardware: { cores: 4 },
      webgpu: false,
      crossOriginIsolated: true,
      backend: { kind: 'prompt-api', model: 'v3Nano', modelVersion },
      flags: [],
    },
    load: { status: 'ok', availabilityBefore: { availability: 'available' }, downloaded: false, loadMs: 1000 },
    results: [{ exampleId: 'e1', phase: 'cold', repeat: 1, status: 'ok', output, attempts: 1, timings: { totalMs: ttft + 10, ttftMs: ttft }, scores: { accuracy } }],
    summary: { total: 1, ok: 1, errors: 0, timeouts: 0, unavailable: 0, scores: { accuracy }, aggregates: {}, ttftMs: dist(ttft), totalMs: dist(ttft + 10) },
    scorers: ['accuracy'],
  };
}

function run(id: string, cells: CellResult[]): RunFile {
  return {
    schemaVersion: 1,
    runId: id,
    startedAt: '2026-09-29T00:00:00Z',
    finishedAt: '2026-09-29T00:01:00Z',
    tool: { name: 't', version: '0' },
    host: { platform: 'linux', release: '6', arch: 'x64', cores: 4, memoryBytes: 1 },
    cells,
  };
}

describe('diffRuns', () => {
  it('flags model version changes, score changes and latency changes', () => {
    const a = run('a', [cell('chrome', '154', '2025.1', 1, 100)]);
    const b = run('b', [cell('chrome', '155', '2025.2', 0.5, 300, 'negative')]);
    const d = diffRuns(a, b);
    expect(d.cells).toHaveLength(1);
    expect(d.flags.join('\n')).toContain('backend.modelVersion changed: 2025.1 → 2025.2');
    expect(d.flags.join('\n')).toContain('accuracy regressed');
    expect(d.flags.join('\n')).toContain('ttftMs.p50 changed ×3.00');
    expect(d.cells[0].changedOutputs).toHaveLength(1);
    // Browser version alone is recorded but not flagged by default.
    expect(d.cells[0].envChanges.map((e) => e.field)).toContain('browser.version');
  });
  it('compares two browsers within one run', () => {
    const r = run('a', [cell('chrome', '154', 'v1', 1, 100), cell('chrome-canary', '156', 'v2', 1, 100)]);
    const d = diffRuns(r, r, { browsers: { before: 'chrome', after: 'chrome-canary' } });
    expect(d.cells).toHaveLength(1);
    expect(d.flags).toEqual(['sentiment/nano (chrome → chrome-canary): backend.modelVersion changed: v1 → v2']);
  });
  it('reports no flags for identical runs', () => {
    const r = run('a', [cell('chrome', '154', 'v1', 1, 100)]);
    expect(diffRuns(r, r).flags).toEqual([]);
  });
});

describe('rendering', () => {
  it('renders self-contained HTML with escaped content', () => {
    const html = renderReport([run('a', [cell('chrome', '154', 'v1', 1, 100, '<script>alert(1)</script>')])], { title: 'T' });
    expect(html).toContain('<title>T</title>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script[^>]+src=/);
    const diff = renderDiff(diffRuns(run('a', [cell('chrome', '154', 'v1', 1, 100)]), run('b', [cell('chrome', '154', 'v2', 1, 100)])));
    expect(diff).toContain('need attention');
    expect(renderMarkdown([run('a', [cell('chrome', '154', 'v1', 1, 100)])])).toContain('| nano |');
  });
});

describe('latestRun', () => {
  it('finds the newest run with the same config name', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { latestRun } = await import('@web-ai-evals/runner');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-hist-'));
    const mk = (id: string, name: string) => ({ ...run(id, [cell('chrome', '154', 'v1', 1, 100)]), name });
    await writeFile(path.join(dir, '2026-09-01.json'), JSON.stringify(mk('old', 'n')));
    await writeFile(path.join(dir, '2026-09-02.json'), JSON.stringify(mk('mid', 'n')));
    await writeFile(path.join(dir, '2026-09-03.json'), JSON.stringify(mk('other', 'x')));
    await writeFile(path.join(dir, '2026-09-04.json'), JSON.stringify(mk('new', 'n')));
    expect((await latestRun(dir, 'n', path.join(dir, '2026-09-04.json')))?.run.runId).toBe('mid');
    expect((await latestRun(dir, 'x'))?.run.runId).toBe('other');
  });
});

describe('diff thresholds', () => {
  it('uses a relative threshold for unbounded metrics like word counts', () => {
    const withWords = (words: number) => {
      const c = cell('chrome', '154', 'v1', 1, 100);
      c.summary.scores.words = words;
      c.scorers.push('words');
      return c;
    };
    expect(diffRuns(run('a', [withWords(41)]), run('b', [withWords(42.3)])).flags).toEqual([]);
    expect(diffRuns(run('a', [withWords(40)]), run('b', [withWords(60)])).flags.join()).toContain('words improved');
  });
});
