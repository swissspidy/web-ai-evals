#!/usr/bin/env node
import type { RunFile } from '@web-ai-evals/core';
import { diffRuns, renderDiff, renderDiffMarkdown, renderMarkdown, renderReport } from '@web-ai-evals/report';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { rescoreRun, runEvals } from './run.js';
import { startRuntimeServer } from './server.js';
import { BrowserSession } from './session.js';

const HELP = `web-ai-evals — run and compare LLM evals inside real browsers

Usage:
  web-ai-evals run --config evals.config.ts [--browsers a,b] [--backends a,b] [--suites a,b] [--limit N] [--no-report]
  web-ai-evals doctor --config evals.config.ts [--browsers a,b]
  web-ai-evals report <run.json...> [--out report.html] [--title T] [--markdown]
  web-ai-evals diff <before.json> [after.json] [--browsers before:after] [--out diff.html]
                    [--score-threshold 0.05] [--latency-ratio 1.5] [--markdown] [--fail-on-flags]
  web-ai-evals rescore --config evals.config.ts <run.json> [--out run.json]
  web-ai-evals serve [--port 47831]

run      Runs every suite × backend × browser in the config and writes results/<runId>.json
         plus an HTML report next to it.
doctor   Launches each browser and prints its environment and each backend's availability.
diff     Compares two runs (or two browsers inside one run) and flags model/browser
         version changes, score changes and latency changes. --fail-on-flags exits 2.
rescore  Re-applies the config's scorers to a stored run without a browser.
`;

const list = (v: unknown) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
const readRun = async (f: string) => JSON.parse(await readFile(f, 'utf8')) as RunFile;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      browsers: { type: 'string' },
      backends: { type: 'string' },
      suites: { type: 'string' },
      limit: { type: 'string' },
      out: { type: 'string', short: 'o' },
      title: { type: 'string' },
      markdown: { type: 'boolean' },
      'no-report': { type: 'boolean' },
      'fail-on-flags': { type: 'boolean' },
      'score-threshold': { type: 'string' },
      'latency-ratio': { type: 'string' },
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (!command || values.help || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  switch (command) {
    case 'run': {
      const config = await loadConfig(values.config ?? 'evals.config.ts');
      const { run, file } = await runEvals(config, {
        filter: { browsers: list(values.browsers), backends: list(values.backends), suites: list(values.suites), limit: values.limit ? Number(values.limit) : undefined },
      });
      console.error(`results: ${file}`);
      if (!values['no-report']) {
        const html = file.replace(/\.json$/, '.html');
        await writeFile(html, renderReport([run]));
        console.error(`report:  ${html}`);
      }
      if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, renderMarkdown([run]), { flag: 'a' });
      return run.cells.length ? 0 : 1;
    }

    case 'doctor': {
      const config = await loadConfig(values.config ?? 'evals.config.ts');
      const server = await startRuntimeServer(config.run.port);
      try {
        for (const browser of config.browsers.filter((b) => !list(values.browsers) || list(values.browsers)!.includes(b.id))) {
          let session: BrowserSession;
          try {
            session = await BrowserSession.open({ browser, profilesDir: config.run.profilesDir, serverUrl: server.url });
          } catch (err) {
            console.log(`✖ ${browser.id}: ${(err as Error).message.split('\n')[0]}`);
            continue;
          }
          try {
            const env = await session.pageEnvironment();
            console.log(`\n${browser.id} — ${session.browser.version} (${browser.headless ? 'headless' : 'headful'})`);
            console.log(`  profile:  ${session.browser.profileDir}`);
            console.log(`  WebGPU:   ${env.gpu ? [env.gpu.vendor, env.gpu.architecture, env.gpu.description].filter(Boolean).join(' / ') + (env.gpu.isFallbackAdapter ? ' (fallback)' : '') : 'no adapter'}`);
            console.log(`  built-in: ${Object.entries(env.builtInApis).map(([k, v]) => `${k}${v ? '' : ' ✖'}`).join(', ')}`);
            console.log(`  isolated: ${env.crossOriginIsolated}`);
            for (const suite of config.suites) {
              for (const spec of config.backends.filter((b) => (!suite.backends || suite.backends.includes(b.id)) && (!b.browsers || b.browsers.includes(browser.id)))) {
                const a = await session.availability(spec, suite.task);
                console.log(`  ${a.availability === 'unavailable' ? '✖' : a.availability === 'available' ? '✔' : '↓'} ${suite.id}/${spec.id}: ${a.availability}${a.reason ? ` — ${a.reason}` : ''}`);
              }
            }
          } finally {
            await session.close();
          }
        }
      } finally {
        await server.close();
      }
      return 0;
    }

    case 'report': {
      if (!positionals.length) throw new Error('report needs at least one run file');
      const runs = await Promise.all(positionals.map(readRun));
      const out = values.out ?? positionals[0].replace(/\.json$/, values.markdown ? '.md' : '.html');
      await writeFile(out, values.markdown ? renderMarkdown(runs) : renderReport(runs, { title: values.title }));
      console.error(`report: ${out}`);
      return 0;
    }

    case 'diff': {
      if (!positionals.length) throw new Error('diff needs one or two run files');
      const before = await readRun(positionals[0]);
      const after = positionals[1] ? await readRun(positionals[1]) : before;
      const pair = values.browsers?.split(':');
      if (!positionals[1] && pair?.length !== 2) throw new Error('with a single run, pass --browsers before:after');
      const diff = diffRuns(before, after, {
        browsers: pair?.length === 2 ? { before: pair[0], after: pair[1] } : undefined,
        scoreThreshold: values['score-threshold'] ? Number(values['score-threshold']) : undefined,
        latencyRatio: values['latency-ratio'] ? Number(values['latency-ratio']) : undefined,
      });
      process.stdout.write(renderDiffMarkdown(diff) + '\n');
      if (values.out) {
        await writeFile(values.out, values.markdown ? renderDiffMarkdown(diff) : renderDiff(diff, { title: values.title }));
        console.error(`diff: ${values.out}`);
      }
      if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, renderDiffMarkdown(diff), { flag: 'a' });
      return values['fail-on-flags'] && diff.flags.length ? 2 : 0;
    }

    case 'rescore': {
      const config = await loadConfig(values.config ?? 'evals.config.ts');
      const file = positionals[0];
      if (!file) throw new Error('rescore needs a run file');
      const run = await rescoreRun(await readRun(file), config);
      const out = values.out ?? file;
      await writeFile(out, JSON.stringify(run, null, 2));
      await writeFile(out.replace(/\.json$/, '.html'), renderReport([run]));
      console.error(`rescored: ${out}`);
      return 0;
    }

    case 'serve': {
      const server = await startRuntimeServer(values.port ? Number(values.port) : 47831);
      console.error(`page runtime at ${server.url} (Ctrl+C to stop)`);
      await new Promise(() => {});
      return 0;
    }

    default:
      process.stderr.write(`unknown command "${command}"\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${(err as Error).message}`);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  },
);
