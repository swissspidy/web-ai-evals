import { describe, expect, it } from 'vitest';
import type { CellResult, RunFile } from 'web-ai-evals';
import { diffRuns, renderDiff, renderMarkdown, renderReport } from 'web-ai-evals/report';

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
    const { latestRun } = await import('web-ai-evals');
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

describe('review fixes', () => {
  it('flags cells missing from the after run and metrics present on one side', () => {
    const a = run('a', [cell('chrome', '154', 'v1', 1, 100), cell('chrome-beta', '155', 'v1', 1, 100)]);
    const b = run('b', [cell('chrome', '154', 'v1', 1, 100)]);
    expect(diffRuns(a, b).flags).toEqual(['sentiment/nano/chrome-beta: missing from the after run']);
    const withExtra = cell('chrome', '154', 'v1', 1, 100);
    withExtra.summary.scores.judge = 0.5;
    expect(diffRuns(run('a', [cell('chrome', '154', 'v1', 1, 100)]), run('b', [withExtra])).flags).toEqual([
      'sentiment/nano/chrome: judge added',
    ]);
  });
  it('records headless changes', () => {
    const h = cell('chrome', '154', 'v1', 1, 100);
    h.environment.browser.headless = true;
    const d = diffRuns(run('a', [cell('chrome', '154', 'v1', 1, 100)]), run('b', [h]));
    expect(d.cells[0].envChanges.map((e) => e.field)).toContain('browser.headless');
  });
  it('keeps cells from two runs on the same kind of host apart', () => {
    const html = renderReport([
      run('a', [cell('chrome', '154', 'v1', 1, 100, 'out-from-run-a')]),
      run('b', [cell('chrome', '154', 'v1', 1, 100, 'out-from-run-b')]),
    ]);
    expect(html).toContain('out-from-run-a');
    expect(html).toContain('out-from-run-b');
    expect(html).toContain('#1');
    expect(html).toContain('#2');
  });
  it('escapes pipes in Markdown tables', () => {
    const c = cell('chrome', '154', 'v1', 1, 100);
    c.backend.id = 'a|b';
    expect(renderMarkdown([run('a', [c])])).toContain('| a\\|b |');
  });
});

describe('builtInModelVersions', () => {
  it('reads Nano from OptGuideOnDeviceModel and Gemma 4 from OptGuideManifestModel', async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { builtInModelVersions } = await import('web-ai-evals');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wae-profile-'));
    const manifest = (name: string, version: string) => JSON.stringify({ version: 'x', BaseModelSpec: { name, version } });
    await mkdir(path.join(dir, 'OptGuideOnDeviceModel', '2025.8.21.1028'), { recursive: true });
    await writeFile(path.join(dir, 'OptGuideOnDeviceModel', '2025.8.21.1028', 'manifest.json'), manifest('v3Nano', '2025.08.14.1358'));
    await mkdir(path.join(dir, 'OptGuideManifestModel', 'abc123', '2026.8.7.929'), { recursive: true });
    await writeFile(path.join(dir, 'OptGuideManifestModel', 'abc123', '2026.8.7.929', 'manifest.json'), manifest('gemma4-2b-it', '2026.06.10.0000'));
    await writeFile(
      path.join(dir, 'Local State'),
      JSON.stringify({
        optimization_guide: {
          on_device: { performance_class: 8, model_crash_count: 1 },
          model_execution: {
            manifest_asset_ledger: {
              abc123: { asset_id: 'gemma4_component', requested_version: '2026.8.7.929' },
              def456: { asset_id: 'nano_v3_cpu_component', requested_version: '2025.8.21.1028' },
            },
          },
        },
      }),
    );
    const nano = await builtInModelVersions(dir);
    expect(nano).toMatchObject({ baseModel: 'v3Nano', onDeviceModel: '2025.8.21.1028', activeAsset: 'nano_v3_cpu_component', modelCrashCount: '1' });
    const gemma = await builtInModelVersions(dir, { preferGemma4: true });
    expect(gemma).toMatchObject({ baseModel: 'gemma4-2b-it', baseModelVersion: '2026.06.10.0000', onDeviceModel: '2026.8.7.929', activeAsset: 'gemma4_component' });
    expect(gemma?.installedModels).toBe('v3Nano@2025.8.21.1028, gemma4-2b-it@2026.8.7.929');
    expect(await builtInModelVersions(await mkdtemp(path.join(os.tmpdir(), 'wae-empty-')))).toBeUndefined();
  });
});
