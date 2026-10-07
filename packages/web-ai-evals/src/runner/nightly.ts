import type { RunFile } from '../core/index.js';
import { diffRuns, renderDiff, renderDiffMarkdown, renderMarkdown, renderReport, type DiffOptions, type RunDiff } from '../report/index.js';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from './config.js';
import { runEvals } from './run.js';

export interface NightlyOptions {
  /** Directory that keeps run files across nights. Default: the config's outDir. */
  historyDir?: string;
  /** Browser id the channel comparison is made against. Default: the first browser. */
  baseline?: string;
  diff?: DiffOptions;
  log?: (msg: string) => void;
}

export interface NightlyResult {
  run: RunFile;
  file: string;
  previous?: string;
  /** Today vs the previous nightly run: the drift signal. */
  drift?: RunDiff;
  /** Baseline channel vs each other channel in today's run: informational. */
  channels: RunDiff[];
  markdown: string;
}

/** Newest run file in `dir` with the same config name, excluding `exclude`. */
export async function latestRun(dir: string, name: string | undefined, exclude?: string): Promise<{ file: string; run: RunFile } | undefined> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort().reverse();
  for (const f of files) {
    const file = path.join(dir, f);
    if (exclude && path.resolve(file) === path.resolve(exclude)) continue;
    try {
      const run = JSON.parse(await readFile(file, 'utf8')) as RunFile;
      if (run.schemaVersion === 1 && run.name === name && run.cells.length) return { file, run };
    } catch {
      /* skip unreadable files */
    }
  }
  return undefined;
}

/**
 * Nightly drift check: run the config, compare with the previous night (same
 * config name) and compare channels with each other. Writes run JSON, an HTML
 * report, diff pages and a Markdown summary into the history directory.
 */
export async function runNightly(config: ResolvedConfig, options: NightlyOptions = {}): Promise<NightlyResult> {
  const historyDir = options.historyDir ? path.resolve(options.historyDir) : config.run.outDir;
  await mkdir(historyDir, { recursive: true });
  const { run, file } = await runEvals({ ...config, run: { ...config.run, outDir: historyDir } }, { log: options.log });
  await writeFile(file.replace(/\.json$/, '.html'), renderReport([run]));

  const prev = await latestRun(historyDir, run.name, file);
  const drift = prev ? diffRuns(prev.run, run, options.diff) : undefined;
  if (drift) await writeFile(file.replace(/\.json$/, '.diff.html'), renderDiff(drift, { title: `Nightly drift: ${run.name ?? ''}` }));

  const browsers = [...new Set(run.cells.map((c) => c.environment.browser.id))];
  const baseline = options.baseline ?? browsers[0];
  const channels = browsers.filter((b) => b !== baseline).map((b) => diffRuns(run, run, { ...options.diff, browsers: { before: baseline, after: b } }));

  const md = [
    renderMarkdown([run]),
    '## Drift since the previous nightly run',
    '',
    drift ? renderDiffMarkdown(drift) : '_No previous run to compare with._',
    '',
    '## Channel comparison (informational)',
    '',
    ...channels.map((d) => renderDiffMarkdown(d).replace(/^# .*$/m, `### ${baseline} vs ${d.cells[0]?.key.match(/→ ([^)]+)\)/)?.[1] ?? ''}`)),
  ].join('\n');
  await writeFile(file.replace(/\.json$/, '.md'), md);
  return { run, file, previous: prev?.file, drift, channels, markdown: md };
}
