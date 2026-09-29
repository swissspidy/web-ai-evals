import {
  parseJsonl,
  resolveInput,
  SCHEMA_VERSION,
  type BackendSpec,
  type CellResult,
  type DatasetRef,
  type Example,
  type ExampleResult,
  type LoadReport,
  type RunFile,
} from '@web-ai-evals/core';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig, SuiteConfig } from './config.js';
import { hostInfo } from './host.js';
import { scoreResults, summarize } from './scoring.js';
import { startRuntimeServer } from './server.js';
import { BrowserSession } from './session.js';
import { TOOL } from './version.js';

export interface RunFilter {
  browsers?: string[];
  backends?: string[];
  suites?: string[];
  limit?: number;
}

export interface LoadedSuite {
  suite: SuiteConfig;
  ref: DatasetRef;
  examples: Example[];
  byId: Map<string, Example>;
}

export async function loadSuite(suite: SuiteConfig, baseDir: string, limit?: number): Promise<LoadedSuite> {
  const file = path.resolve(baseDir, suite.dataset);
  const text = await readFile(file, 'utf8');
  let examples = parseJsonl(text, suite.dataset);
  const max = limit ?? suite.limit;
  if (max !== undefined) examples = examples.slice(0, max);
  return {
    suite,
    examples,
    byId: new Map(examples.map((e) => [e.id, e])),
    ref: {
      id: suite.id,
      path: path.relative(process.cwd(), file),
      sha256: createHash('sha256').update(text).digest('hex'),
      examples: examples.length,
      license: suite.license,
    },
  };
}

function backendsFor(config: ResolvedConfig, suite: SuiteConfig, filter: RunFilter): BackendSpec[] {
  let list = suite.backends ? config.backends.filter((b) => suite.backends!.includes(b.id)) : config.backends;
  if (filter.backends?.length) list = list.filter((b) => filter.backends!.includes(b.id));
  return list;
}

function placeholderResults(examples: Example[], status: ExampleResult['status'], error?: string): ExampleResult[] {
  return examples.map((e) => ({ exampleId: e.id, phase: 'warm', repeat: 1, status, error, attempts: 0, timings: { totalMs: 0 }, scores: {} }));
}

export interface RunEvalsOptions {
  filter?: RunFilter;
  log?: (msg: string) => void;
  /** Called after each cell with the partial run file (already written to disk). */
  onCell?: (cell: CellResult, run: RunFile) => void;
}

/** Run a resolved config. Writes `<outDir>/<runId>.json` after every cell. */
export async function runEvals(config: ResolvedConfig, options: RunEvalsOptions = {}): Promise<{ run: RunFile; file: string }> {
  const log = options.log ?? ((m: string) => console.error(m));
  const filter = options.filter ?? {};
  const suites = await Promise.all(
    config.suites.filter((s) => !filter.suites?.length || filter.suites.includes(s.id)).map((s) => loadSuite(s, config.baseDir, filter.limit)),
  );
  const browsers = config.browsers.filter((b) => !filter.browsers?.length || filter.browsers.includes(b.id));
  if (!suites.length) throw new Error('no suites selected');
  if (!browsers.length) throw new Error('no browsers selected');

  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${randomUUID().slice(0, 6)}`;
  const run: RunFile = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    name: config.name,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    tool: TOOL,
    host: hostInfo(),
    cells: [],
    notes: config.notes,
  };
  await mkdir(config.run.outDir, { recursive: true });
  const file = path.join(config.run.outDir, `${runId}.json`);
  const save = async () => {
    run.finishedAt = new Date().toISOString();
    await writeFile(file, JSON.stringify(run, null, 2));
  };

  const server = await startRuntimeServer(config.run.port);
  try {
    // One browser at a time, one backend at a time: no GPU contention between measurements.
    for (const browser of browsers) {
      log(`launching ${browser.id} (${browser.channel}${browser.headless ? ', headless' : ''})`);
      let session: BrowserSession;
      try {
        session = await BrowserSession.open({ browser, profilesDir: config.run.profilesDir, serverUrl: server.url, log });
      } catch (err) {
        log(`could not launch ${browser.id}: ${(err as Error).message.split('\n')[0]}`);
        run.notes = [...(run.notes ?? []), `browser ${browser.id} failed to launch: ${(err as Error).message.split('\n')[0]}`];
        continue;
      }
      try {
        for (const loaded of suites) {
          for (const spec of backendsFor(config, loaded.suite, filter)) {
            const cell = await runCell(session, config, loaded, spec, log);
            run.cells.push(cell);
            await save();
            options.onCell?.(cell, run);
          }
        }
      } finally {
        await session.close();
      }
    }
  } finally {
    await server.close();
  }
  await save();
  return { run, file };
}

export async function runCell(
  session: BrowserSession,
  config: ResolvedConfig,
  loaded: LoadedSuite,
  spec: BackendSpec,
  log: (msg: string) => void,
): Promise<CellResult> {
  const { suite, examples, byId } = loaded;
  const task = suite.task;
  const key = `${suite.id}/${spec.id}/${session.options.browser.id}`;
  log(`▶ ${key}: ${examples.length} examples`);
  const opts = config.run;

  const load: LoadReport = await session.load(spec, task, { timeoutMs: opts.loadTimeoutMs });
  let results: ExampleResult[];
  if (load.status !== 'ok') {
    results = placeholderResults(examples, load.status === 'unavailable' ? 'unavailable' : 'error', load.error);
  } else {
    results = [];
    const request = (e: Example) => ({ exampleId: e.id, task, input: resolveInput(e, task), generation: spec.generation });
    for (const e of examples.slice(0, opts.warmup)) await session.run(request(e), { timeoutMs: opts.timeoutMs });
    let first = opts.warmup === 0;
    for (let repeat = 1; repeat <= opts.repeats; repeat++) {
      for (const [i, e] of examples.entries()) {
        const res = await session.run(request(e), { timeoutMs: opts.timeoutMs, retries: opts.retries });
        results.push({
          exampleId: e.id,
          phase: first ? 'cold' : 'warm',
          repeat,
          status: res.status,
          output: res.output,
          error: res.error,
          attempts: res.attempts,
          timings: res.timings,
          memory: res.memory,
          scores: {},
          extra: res.extra,
        });
        first = false;
        if ((i + 1) % 10 === 0 || i === examples.length - 1) log(`  ${key}: ${i + 1}/${examples.length} (repeat ${repeat})`);
      }
    }
    if (opts.coldStarts > 0 && examples.length) {
      load.coldStarts = [];
      for (let i = 0; i < opts.coldStarts; i++) {
        await session.unload();
        await session.resetPage();
        const again = await session.load(spec, task, { timeoutMs: opts.loadTimeoutMs });
        if (again.status !== 'ok') break;
        const res = await session.run(request(examples[0]), { timeoutMs: opts.timeoutMs });
        load.coldStarts.push({ loadMs: again.loadMs ?? NaN, firstTtftMs: res.timings.ttftMs, firstTotalMs: res.timings.totalMs });
      }
    }
  }

  const environment = await session.environment(spec, load.model);
  await session.unload();
  await scoreResults(results, byId, task, suite.scorers);
  const summary = summarize(results, byId, task, suite.scorers);
  const primary = suite.scorers[0].name;
  log(
    `✔ ${key}: ${summary.ok}/${summary.total} ok` +
      (summary.scores[primary] !== undefined ? `, ${primary}=${summary.scores[primary].toFixed(3)}` : '') +
      (summary.ttftMs ? `, ttft p50=${summary.ttftMs.p50.toFixed(0)} ms` : '') +
      (load.status !== 'ok' ? ` (${load.status}: ${load.error ?? ''})` : ''),
  );
  return {
    key,
    dataset: loaded.ref,
    task,
    backend: spec,
    environment,
    load,
    results,
    summary,
    scorers: suite.scorers.map((s) => s.name),
  };
}

/** Re-score a stored run with the scorers from a config (no browser needed). */
export async function rescoreRun(run: RunFile, config: ResolvedConfig): Promise<RunFile> {
  for (const cell of run.cells) {
    const suite = config.suites.find((s) => s.id === cell.dataset.id);
    if (!suite) continue;
    const loaded = await loadSuite(suite, config.baseDir);
    if (loaded.ref.sha256 !== cell.dataset.sha256) {
      console.error(`warning: dataset ${suite.id} changed since the run (sha256 differs); rescoring by example id`);
    }
    await scoreResults(cell.results, loaded.byId, cell.task, suite.scorers);
    cell.summary = summarize(cell.results, loaded.byId, cell.task, suite.scorers);
    cell.scorers = suite.scorers.map((s) => s.name);
  }
  return run;
}
